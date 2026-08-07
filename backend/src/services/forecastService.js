const supabase = require('../config/supabase');

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

module.exports = { generateForecast, simpleMovingAverage, linearRegression };
