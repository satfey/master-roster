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
//      On top of that baseline, a bounded momentum adjustment (see MOMENTUM_WINDOW/MOMENTUM_CAP
//      below) nudges the forecast toward a real, recent rising or falling trend the recency-only
//      average alone tends to lag behind or overshoot around — capped, and only once 2x
//      MOMENTUM_WINDOW samples exist, so it never dominates and never applies to thin history.
//   2. Otherwise, the store's overall daily average across all history (plain, unweighted).
//   3. Otherwise (no history at all for the store), 0 — reported as
//      NO_HISTORY so the caller can see the forecast is not grounded in data.
//
// hourFraction(hour) — what share of a day's sales typically lands in each
// operating hour, built from sales_by_hour.gross_sale. sales_by_hour is
// aggregated per (store, calendar month, hour) — it has no per-date or
// weekday column, in the schema OR the source Excel report (confirmed
// against salesByHourImport/excelParser.js: the file itself is 5 fixed
// columns — Brand Name, Store Id, Store Name, Gross Sale, Hour — report_month
// is a value the uploader supplies, not something parsed from the file).
// So this CANNOT supply a same-weekday effect — not a gap in this function,
// a real absence of the underlying data (confirmed against real data: 21,200
// rows / 563 stores, all monthly-grain, zero date-level rows anywhere).
// Weekday seasonality is applied via the daily total above instead (which
// DOES have real per-date history via sales_report), and this hour shape is
// deliberately one flat store-level "typical hour-of-day curve" applied to
// every date regardless of weekday — building a weekday tier here would mean
// fabricating a distinction the data doesn't support. If Monday-vs-Saturday
// hourly curves are needed later, the smallest change that would unlock it
// is a new import capturing hourly sales at real DATE granularity (e.g. a
// sales_by_hour_daily table/report), not an algorithm change to this
// function — there is nothing here to derive that pattern from today.
//   1. The store's own hour totals, summed across every available month
//      (gross_sale: null rows — an hour not yet reported — excluded first,
//      the same "never treat unreported as zero" rule computeDailyForecast
//      already applies) and normalized to sum to 1 (restricted to operating
//      hours — any sales recorded outside 09:00-22:00 are excluded from the
//      shape as out-of-hours anomalies rather than silently redistributed).
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

// Bounded momentum — applied ONCE, on top of the recency-weighted baseline above, still only
// within the STORE_WEEKDAY_AVERAGE tier. Validated offline via a rolling-origin backtest against
// real store data (Feb-Jul 2026, 82,050 test points) before being implemented here: MAPE 19.85%
// (HL8 baseline alone) -> 18.75% (this exact window/cap), winning 389 stores vs 37 lost, improving
// 5 of 6 evaluated months and all 3 rising/peak-reversal/decline transitions tested. A raw Holt
// linear (level+trend) alternative was tried first and rejected — its compounding recursive update
// produced negative forecasts (11.6% of points) and runaway trend blowups (up to ~3.8M% of level)
// on same-weekday series this short (~26 typical samples). This momentum term is deliberately NOT
// recursive: every call recomputes purely from real reported gross_actual history, never from a
// previous forecast, so there is no accumulation path for it to run away through.
//
// MOMENTUM_ENABLED lets this be switched off in one place without touching the call sites below,
// per "easy to disable internally" — intentionally not a user-facing setting.
const MOMENTUM_ENABLED = true;
const MOMENTUM_WINDOW = 4; // compare the most recent 4 same-weekday samples against the 4 before them
const MOMENTUM_CAP = 0.1; // clamp the resulting adjustment to +/-10% of the baseline

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * (recent MOMENTUM_WINDOW same-weekday samples' average / preceding MOMENTUM_WINDOW samples'
 * average) - 1, clamped to +/-MOMENTUM_CAP. Returns 0 (no adjustment) when there aren't at least
 * 2*MOMENTUM_WINDOW same-weekday samples to form two non-overlapping windows from, or when the
 * older window averages to <= 0 (a degenerate ratio) — both cases fall through to the unchanged
 * HL8 baseline. Sorts ascending by report_date itself (same defensive stance as
 * recencyWeightedAverage above) rather than trusting the caller already did — `dailyHistory`
 * happens to arrive pre-sorted from forecastRepo.findDailySalesHistory today, but this function
 * shouldn't silently depend on that.
 */
function boundedMomentum(sameWeekday) {
  if (sameWeekday.length < MOMENTUM_WINDOW * 2) return 0;
  const sameWeekdayAsc = [...sameWeekday].sort((a, b) => (a.report_date > b.report_date ? 1 : -1));
  const recent = sameWeekdayAsc.slice(-MOMENTUM_WINDOW);
  const older = sameWeekdayAsc.slice(-MOMENTUM_WINDOW * 2, -MOMENTUM_WINDOW);
  const recentAvg = average(recent.map((h) => Number(h.gross_actual)));
  const olderAvg = average(older.map((h) => Number(h.gross_actual)));
  if (olderAvg <= 0) return 0;
  const ratio = recentAvg / olderAvg - 1;
  return Math.max(-MOMENTUM_CAP, Math.min(MOMENTUM_CAP, ratio));
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
    const baseline = recencyWeightedAverage(sameWeekday);
    const momentum = MOMENTUM_ENABLED ? boundedMomentum(sameWeekday) : 0; // 0 below 2*MOMENTUM_WINDOW samples -> value === baseline exactly
    return {
      value: Math.max(0, baseline * (1 + momentum)),
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
    if (row.gross_sale == null) continue; // not-yet-reported hour (data entry lag) — same class of bug as the daily forecast's null handling (93b7416): Number(null) === 0 would silently shrink that hour's share rather than being excluded
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
 * The actual sales -> hourly forecast computation, shared by generateHourlyForecast (persists)
 * and previewHourlyForecast (read-only) — same history load, same hour-shape fallback chain
 * (STORE_HOUR_SHAPE -> CHAIN_HOUR_SHAPE -> UNIFORM_FALLBACK), same per-day computeDailyForecast x
 * hourShape math. Pulled out so the read-only preview can never drift from what actually gets
 * persisted — one computation, two callers.
 */
async function computeHourlyForecastDays({ storeId, dates, startDate }) {
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

  const days = dates.map((date) => {
    const daily = computeDailyForecast(dailyHistory, date);
    const hours = operatingHours.map((hour) => ({ hour, forecastedSales: Math.round(daily.value * hourShape.get(hour)) }));
    return { date, dailyForecast: Math.round(daily.value), dailyForecastSource: daily.source, dailyForecastSamples: daily.samples, hours };
  });

  return { hourShapeSource, days };
}

/**
 * Generates and persists an hourly sales forecast for a store over a date
 * range. Draft/planning input only — never writes roster/shift data itself.
 */
async function generateHourlyForecast({ storeId, startDate, endDate }) {
  const dates = eachDateInRange(startDate, endDate);
  const { hourShapeSource, days } = await computeHourlyForecastDays({ storeId, dates, startDate });

  const modelRun = await forecastRepo.createModelRun('HOURLY-WEEKDAY-SHAPE-V1');

  const forecastRows = [];
  for (const day of days) {
    for (const h of day.hours) {
      forecastRows.push({
        store_id: storeId,
        forecast_date: day.date,
        daypart: hourDaypart(h.hour),
        forecasted_sales: h.forecastedSales,
        model_run_id: modelRun.id,
      });
    }
  }
  await forecastRepo.upsertForecastRows(forecastRows);

  return {
    modelRunId: modelRun.id,
    hourShapeSource,
    totalForecast: Math.round(days.reduce((s, d) => s + d.dailyForecast, 0)),
    days,
  };
}

/**
 * Read-only hourly forecast preview — same computeHourlyForecastDays computation
 * generateHourlyForecast persists, but never creates a forecast_model_run or writes to
 * sales_forecast. Mirrors previewDailyForecast's role: a page that lets someone browse a store's
 * hourly forecast (switching stores, changing the date range) must not leave behind a new model
 * run and a new batch of sales_forecast rows every time it's viewed.
 */
async function previewHourlyForecast({ storeId, startDate, endDate }) {
  const dates = eachDateInRange(startDate, endDate);
  const { hourShapeSource, days } = await computeHourlyForecastDays({ storeId, dates, startDate });

  return {
    storeId,
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
  previewHourlyForecast,
  computeDailyForecast,
  computeHourShape,
  computeMonthlyForecastedSales,
};
