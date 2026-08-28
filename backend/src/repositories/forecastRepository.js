const supabase = require('../config/supabase');

/** Daily actuals for a store — the source for day-of-week / daily-total seasonality (sales_report.report_date has real per-day granularity; sales_by_hour.report_month does not). */
async function findDailySalesHistory(storeId, { before } = {}) {
  let query = supabase
    .from('sales_report')
    .select('report_date, gross_actual')
    .eq('store_id', storeId)
    .order('report_date', { ascending: true });
  if (before) query = query.lt('report_date', before);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/** Hour-of-day sales history for a store — one row per (month, hour), i.e. the month's total sales that occurred in that hour bucket. Used only for the *shape* of the hourly distribution, not for day-of-week effects. */
async function findHourlySalesHistory(storeId) {
  const { data, error } = await supabase
    .from('sales_by_hour')
    .select('report_month, hour, gross_sale')
    .eq('store_id', storeId)
    .order('report_month', { ascending: true });
  if (error) throw error;
  return data;
}

/** Fallback source when a store has no sales_by_hour history of its own — every store's hourly history, used to build a chain-wide average shape. */
async function findAllHourlySalesHistory() {
  const { data, error } = await supabase.from('sales_by_hour').select('store_id, hour, gross_sale');
  if (error) throw error;
  return data;
}

async function createModelRun(modelVersion) {
  const { data, error } = await supabase.from('forecast_model_run').insert({ model_version: modelVersion, accuracy_score: null }).select().single();
  if (error) throw error;
  return data;
}

/** Upserts a batch of sales_forecast rows (daily FULL_DAY or hourly, see forecastService). */
async function upsertForecastRows(rows) {
  if (!rows.length) return [];
  const { data, error } = await supabase
    .from('sales_forecast')
    .upsert(rows, { onConflict: 'store_id,forecast_date,daypart,model_run_id' })
    .select();
  if (error) throw error;
  return data;
}

/** Reads forecast rows for a store across a date range, optionally restricted to hourly rows (daypart = a 2-digit hour string) or the daily FULL_DAY row. */
async function findForecastRows({ storeId, startDate, endDate, hourly = true }) {
  let query = supabase
    .from('sales_forecast')
    .select('*')
    .eq('store_id', storeId)
    .gte('forecast_date', startDate)
    .lte('forecast_date', endDate);
  query = hourly ? query.neq('daypart', 'FULL_DAY') : query.eq('daypart', 'FULL_DAY');
  const { data, error } = await query.order('forecast_date', { ascending: true });
  if (error) throw error;
  return data;
}

module.exports = {
  findDailySalesHistory,
  findHourlySalesHistory,
  findAllHourlySalesHistory,
  createModelRun,
  upsertForecastRows,
  findForecastRows,
};
