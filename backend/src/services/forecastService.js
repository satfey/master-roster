const supabase = require('../config/supabase');
const forecastRepo = require('../repositories/forecastRepository');
const { operatingHourList, hourDaypart } = require('./storeOperatingHours');
const { weekdayOf, eachDateInRange, monthRange } = require('../utils/dateRange');

function simpleMovingAverage(history, windowSize = 7) {
  if (history.length === 0) return 0;
  const window = history.slice(-windowSize);
  const sum = window.reduce((acc, h) => acc + Number(h.amount), 0);
  return sum / window.length;
}

function linearRegression(history, daysAhead = 1) {
  const n = history.length;
  if (n === 0) return 0;
  if (n === 1) return Number(history[0].amount);

  const xs = history.map((_, i) => i);
  const ys = history.map((h) => Number(h.amount));

  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (xs[i] - xMean) * (ys[i] - yMean);
    denominator += (xs[i] - xMean) ** 2;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;
  const nextX = n - 1 + daysAhead;
  return Math.max(slope * nextX + intercept, 0);
}

/**
 * Builds a daily forecast for the next `days` days for a store using SMA or
 * Linear Regression, records a ForecastModelRun, and persists SalesForecast rows.
 */
async function generateForecast({ storeId, days = 7, method = 'SMA', lookbackDays = 30 }) {
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  const { data: history, error: historyError } = await supabase
    .from('sales_record')
    .select('amount')
    .eq('store_id', storeId)
    .gte('sales_date', since.toISOString().slice(0, 10))
    .order('sales_date', { ascending: true });
  if (historyError) throw historyError;

  const modelVersion = method === 'LINEAR_REGRESSION' ? 'LINREG-30D' : 'SMA-7';
  const { data: modelRun, error: modelRunError } = await supabase
    .from('forecast_model_run')
    .insert({ model_version: modelVersion, accuracy_score: null })
    .select()
    .single();
  if (modelRunError) throw modelRunError;

  const results = [];
  const workingHistory = history.map((h) => ({ amount: h.amount }));

  for (let d = 1; d <= days; d++) {
    const forecastDate = new Date();
    forecastDate.setDate(forecastDate.getDate() + d);
    forecastDate.setHours(0, 0, 0, 0);
    const forecastDateStr = forecastDate.toISOString().slice(0, 10);

    const forecastValue =
      method === 'LINEAR_REGRESSION' ? linearRegression(workingHistory, d) : simpleMovingAverage(workingHistory, 7);

    const rounded = Math.round(forecastValue);
    results.push({ date: forecastDate, forecastedSales: rounded });
    workingHistory.push({ amount: forecastValue });

    const { error: upsertError } = await supabase.from('sales_forecast').upsert(
      {
        store_id: storeId,
        forecast_date: forecastDateStr,
        daypart: 'FULL_DAY',
        forecasted_sales: rounded,
        model_run_id: modelRun.id,
      },
      { onConflict: 'store_id,forecast_date,daypart,model_run_id' }
    );
    if (upsertError) throw upsertError;
  }

  const weeklyTotal = results.reduce((sum, r) => sum + r.forecastedSales, 0);

  return { method, modelRunId: modelRun.id, daily: results, weeklyTotal: Math.round(weeklyTotal) };
}

// --- Hourly forecast (store + date + hour) -------------------------------
//
// Methodology (a transparent statistical baseline, not ML):
//
//   forecasted_sales(date, hour) = dailyForecast(date) x hourFraction(hour)
//
// dailyForecast(date) — a weekday-aware total for the day, built from
// sales_report.gross_actual (the only table with true per-day granularity):
//   1. Same store + same weekday, recency-weighted average, if at least MIN_WEEKDAY_SAMPLES
//      historical occurrences of that weekday exist — more recent occurrences count more (see
//      RECENCY_HALF_LIFE_SAMPLES below), so a genuine recent shift is picked up without a handful
//      of old samples permanently outvoting it, while still using the full history available.
//   2. Otherwise, the store's overall daily average across all history (plain, unweighted).
//   3. Otherwise (no history at all for the store), 0 — reported as
//      NO_HISTORY so the caller can see the forecast is not grounded in data.
//
// hourFraction(hour) — what share of a day's sales typically lands in each
// operating hour, built from sales_by_hour.gross_sale. sales_by_hour is
// aggregated per (store, calendar month, hour) — it has no per-date
// granularity, so it cannot itself supply a same-weekday effect; that's why
// weekday seasonality is applied via the daily total above instead, and this
// shape is a store-level "typical hour-of-day curve":
//   1. The store's own hour totals, summed across every available month and
//      normalized to sum to 1 (restricted to operating hours — any sales
//      recorded outside 09:00-22:00 are excluded from the shape as
//      out-of-hours anomalies rather than silently redistributed).
//   2. Otherwise, the same normalization across every store's hour totals
//      (a chain-wide average shape).
//   3. Otherwise (literally no hourly history anywhere), an equal 1/13 share
//      per operating hour — the explicit last-resort fallback; this is the
//      only path that ever divides sales equally across hours.
//
// Storage: reuses sales_forecast (see storeOperatingHours.js for why no
// schema change was needed) — one row per (store, date, hour) with
// daypart = 'HOUR_09'..'HOUR_21', under one forecast_model_run per
// generateHourlyForecast() call. Existing daypart = 'FULL_DAY' rows written
// by generateForecast() above are untouched.

const MIN_WEEKDAY_SAMPLES = 2;

// Recency weighting for the STORE_WEEKDAY_AVERAGE tier only — STORE_DAILY_AVERAGE and NO_HISTORY
// stay plain, unweighted fallbacks (see computeDailyForecast). Same-weekday samples are inherently
// weekly-spaced (each one is ~7 days after the previous), so "occurrences back" and "days back" are
// equivalent up to a constant factor here; ranking by occurrence rather than calendar days keeps
// this immune to irregular gaps (e.g. an unreported week just doesn't shift the ranking of the
// samples that do exist).
//
// RECENCY_HALF_LIFE_SAMPLES = 8 (~2 months, since one same-weekday sample lands per week): a
// same-weekday sample 8 occurrences older than the most recent one carries half its weight.
// Grounded in the real data (574 stores, checked directly): the median store has 180 days of
// history and 26 same-weekday samples. At n=26, the oldest sample's weight is
// 0.5^(25/8) ≈ 0.10 — meaningfully discounted (the most recent ~2 months dominates) but never
// zeroed out, so the other ~4 months of real signal still contributes. At the MIN_WEEKDAY_SAMPLES
// floor (n=2) the two weights are 1.0 and 0.5^(1/8) ≈ 0.917 — barely different, so with few
// samples this degrades gracefully to ~a plain average: the same formula that gives real recency
// preference at n=26 self-moderates at n=2, with no extra special-casing needed.
const RECENCY_HALF_LIFE_SAMPLES = 8;
const RECENCY_DECAY_RATE = Math.pow(0.5, 1 / RECENCY_HALF_LIFE_SAMPLES);

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Weighted average of `rows` (each needs report_date + gross_actual), weighting more recent report_dates more heavily via RECENCY_DECAY_RATE — see the comment above. */
function recencyWeightedAverage(rows) {
  const sorted = [...rows].sort((a, b) => (a.report_date < b.report_date ? 1 : -1)); // most recent first
  let weightedSum = 0;
  let weightTotal = 0;
  sorted.forEach((row, rank) => {
    const weight = RECENCY_DECAY_RATE ** rank;
    weightedSum += Number(row.gross_actual) * weight;
    weightTotal += weight;
  });
  return weightTotal > 0 ? weightedSum / weightTotal : 0;
}

/**
 * Weekday-aware daily total forecast for one date, from sales_report history (see fallback
 * hierarchy above). `gross_actual` is null for a date that simply hasn't been reported yet (data
 * entry lag — never means "zero sales"), so those rows are excluded up front: including them
 * would silently average in a phantom 0 (Number(null) === 0) for every not-yet-reported day, and
 * would also inflate `samples`/the MIN_WEEKDAY_SAMPLES check with days that carry no real signal.
 */
function computeDailyForecast(dailyHistory, targetDate) {
  const reported = dailyHistory.filter((h) => h.gross_actual != null);
  const weekday = weekdayOf(targetDate);
  const sameWeekday = reported.filter((h) => weekdayOf(h.report_date) === weekday);

  if (sameWeekday.length >= MIN_WEEKDAY_SAMPLES) {
    return {
      value: recencyWeightedAverage(sameWeekday),
      source: 'STORE_WEEKDAY_AVERAGE',
      samples: sameWeekday.length,
    };
  }
  if (reported.length > 0) {
    return {
      value: average(reported.map((h) => Number(h.gross_actual))),
      source: 'STORE_DAILY_AVERAGE',
      samples: reported.length,
    };
  }
  return { value: 0, source: 'NO_HISTORY', samples: 0 };
}

/** Normalized hour-of-day distribution (Map<hour, fraction>, summing to 1) from a set of {hour, gross_sale} rows, or null if there's no usable data (caller falls back). */
function computeHourShape(hourlyRows, operatingHours) {
  const sums = new Map();
  for (const row of hourlyRows) {
    if (!operatingHours.includes(row.hour)) continue; // exclude out-of-hours anomalies, never let them skew the shape
    sums.set(row.hour, (sums.get(row.hour) || 0) + Number(row.gross_sale));
  }
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  const fractions = new Map();
  for (const hour of operatingHours) fractions.set(hour, (sums.get(hour) || 0) / total);
  return fractions;
}

/**
 * Generates and persists an hourly sales forecast for a store over a date
 * range. Draft/planning input only — never writes roster/shift data itself.
 */
async function generateHourlyForecast({ storeId, startDate, endDate }) {
  const dates = eachDateInRange(startDate, endDate);
  const operatingHours = operatingHourList();

  const dailyHistory = await forecastRepo.findDailySalesHistory(storeId, { before: startDate });

  let hourShapeSource = 'STORE_HOUR_SHAPE';
  let hourShape = computeHourShape(await forecastRepo.findHourlySalesHistory(storeId), operatingHours);

  if (!hourShape) {
    hourShapeSource = 'CHAIN_HOUR_SHAPE';
    hourShape = computeHourShape(await forecastRepo.findAllHourlySalesHistory(), operatingHours);
  }
  if (!hourShape) {
    hourShapeSource = 'UNIFORM_FALLBACK';
    hourShape = new Map(operatingHours.map((h) => [h, 1 / operatingHours.length]));
  }

  const modelRun = await forecastRepo.createModelRun('HOURLY-WEEKDAY-SHAPE-V1');

  const forecastRows = [];
  const days = dates.map((date) => {
    const daily = computeDailyForecast(dailyHistory, date);
    const hours = operatingHours.map((hour) => {
      const forecastedSales = Math.round(daily.value * hourShape.get(hour));
      forecastRows.push({
        store_id: storeId,
        forecast_date: date,
        daypart: hourDaypart(hour),
        forecasted_sales: forecastedSales,
        model_run_id: modelRun.id,
      });
      return { hour, forecastedSales };
    });
    return { date, dailyForecast: Math.round(daily.value), dailyForecastSource: daily.source, dailyForecastSamples: daily.samples, hours };
  });

  await forecastRepo.upsertForecastRows(forecastRows);

  return {
    modelRunId: modelRun.id,
    hourShapeSource,
    totalForecast: Math.round(days.reduce((s, d) => s + d.dailyForecast, 0)),
    days,
  };
}

/**
 * A store's total FORECASTED sales for one calendar month — the same
 * weekday-aware per-day forecast used by generateHourlyForecast (see
 * computeDailyForecast above), summed across every date in the month,
 * against one frozen history snapshot (as-of the month's start, so the
 * result doesn't shift depending on which sub-range of the month a caller
 * happens to be generating). Used to size the Monthly Labor Hours guideline
 * (see laborBudgetService.resolveMonthlyLaborHoursGuideline) for a month
 * that hasn't happened yet — unlike labor_guideline reporting, which sums
 * real sales_report.gross_actual for a month already in progress or past,
 * roster generation always targets future dates, so there's no actual
 * monthly total to sum yet.
 */
async function computeMonthlyForecastedSales({ storeId, monthKey }) {
  const { start, end } = monthRange(monthKey);
  const dailyHistory = await forecastRepo.findDailySalesHistory(storeId, { before: start });
  const total = eachDateInRange(start, end).reduce((sum, date) => sum + computeDailyForecast(dailyHistory, date).value, 0);
  return Math.round(total);
}

module.exports = {
  generateForecast,
  simpleMovingAverage,
  linearRegression,
  generateHourlyForecast,
  computeDailyForecast,
  computeHourShape,
  computeMonthlyForecastedSales,
};
