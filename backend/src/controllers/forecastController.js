const { generateForecast } = require('../services/forecastService');
const { success } = require('../utils/apiResponse');
const supabase = require('../config/supabase');

async function createForecast(req, res) {
  const { storeId, days, method } = req.body;
  const result = await generateForecast({ storeId, days, method });
  return success(res, result, 'Forecast generated');
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

module.exports = { createForecast, getForecast };
