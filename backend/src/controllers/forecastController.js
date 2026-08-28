const { generateForecast, generateHourlyForecast } = require('../services/forecastService');
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

async function getForecast(req, res) {
  const { storeId, from, to } = req.query;
  let query = supabase.from('sales_forecast').select('*').eq('store_id', storeId).order('forecast_date', { ascending: true });
  if (from) query = query.gte('forecast_date', from);
  if (to) query = query.lte('forecast_date', to);
  const { data: forecasts, error } = await query;
  if (error) throw error;
  return success(res, forecasts);
}

module.exports = { createForecast, createHourlyForecast, getForecast };
