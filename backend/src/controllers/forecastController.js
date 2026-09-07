const { generateForecast, generateHourlyForecast, computeDailyForecast } = require('../services/forecastService');
const forecastRepo = require('../repositories/forecastRepository');
const { eachDateInRange } = require('../utils/dateRange');
const { success, failure } = require('../utils/apiResponse');
const supabase = require('../config/supabase');

async function createForecast(req, res) {
  const { storeId, days, method } = req.body;
  const result = await generateForecast({ storeId, days, method });
  return success(res, result, 'Forecast generated');
}

async function createHourlyForecast(req, res) {
  const { storeId, startDate, endDate } = req.body;
  if (!storeId) return failure(res, 'storeId is required', 400);
  if (!startDate || !endDate) return failure(res, 'startDate and endDate are required', 400);

  const result = await generateHourlyForecast({ storeId, startDate, endDate });
  return success(res, result, 'Hourly forecast generated');
}

/**
 * Read-only daily forecast preview — computes computeDailyForecast on the fly from real
 * sales_report history and returns it directly, WITHOUT calling generateHourlyForecast's
 * persistence path (no forecast_model_run row, no sales_forecast upsert). generateHourlyForecast
 * is the right call when a roster is actually being generated (its output must be durable and
 * traceable to a model run), but a page that's just letting someone browse a store's forecast
 * shouldn't create a new model run — and therefore a new set of sales_forecast rows — every time
 * it's viewed; repeated views over time is exactly what already left sales_forecast with several
 * accumulated rows per (store, date, hour) from earlier generation calls.
 */
async function previewDailyForecast(req, res) {
  const { storeId, startDate, endDate } = req.query;
  if (!storeId) return failure(res, 'storeId is required', 400);
  if (!startDate || !endDate) return failure(res, 'startDate and endDate are required', 400);
  if (startDate > endDate) return failure(res, 'startDate must not be after endDate', 400);

  const history = await forecastRepo.findDailySalesHistory(storeId, { before: startDate });
  const days = eachDateInRange(startDate, endDate).map((date) => {
    const daily = computeDailyForecast(history, date);
    return { date, forecastedSales: Math.round(daily.value), source: daily.source, samples: daily.samples };
  });
  return success(res, { storeId, days });
}

async function getForecast(req, res) {
  const { storeId, from, to } = req.query;
  let query = supabase.from('sales_forecast').select('*').eq('store_id', storeId).order('forecast_date', { ascending: true });
  if (from) query = query.gte('forecast_date', from);
  if (to) query = query.lte('forecast_date', to);
  const { data: forecasts, error } = await query;
  if (error) throw error;
  return success(res, forecasts);
}

module.exports = { createForecast, createHourlyForecast, getForecast, previewDailyForecast };
