const supabase = require('../config/supabase');
const { getAllowedStoreIds } = require('../middleware/storeScope');
const { withDisplayStoreId } = require('../utils/storeDisplay');

/**
 * Builds the productivity dashboard payload for a single store: sales
 * actual/forecast, planned/actual labor hours, labor %, and productivity
 * (sales generated per actual labor hour).
 *
 * This computes live from SalesRecord/SalesForecast/Shift/ActualHours rather
 * than reading KpiSnapshot, so it's always current. A scheduled job could
 * write daily KpiSnapshot rows from this same calculation if you want cached
 * historical snapshots later.
 */
async function getStoreProductivity({ storeId, from, to }) {
  let salesQuery = supabase.from('sales_record').select('*').eq('store_id', storeId).order('sales_date', { ascending: true });
  let forecastQuery = supabase
    .from('sales_forecast')
    .select('*')
    .eq('store_id', storeId)
    .order('forecast_date', { ascending: true });
  let shiftQuery = supabase.from('shift').select('*, actual_hours(*), roster!inner(store_id)').eq('roster.store_id', storeId);
  if (from) {
    salesQuery = salesQuery.gte('sales_date', from);
    forecastQuery = forecastQuery.gte('forecast_date', from);
    shiftQuery = shiftQuery.gte('shift_date', from);
  }
  if (to) {
    salesQuery = salesQuery.lte('sales_date', to);
    forecastQuery = forecastQuery.lte('forecast_date', to);
    shiftQuery = shiftQuery.lte('shift_date', to);
  }

  const [
    { data: salesRecords, error: salesError },
    { data: forecasts, error: forecastError },
    { data: shifts, error: shiftsError },
    { data: guideline, error: guidelineError },
  ] = await Promise.all([
    salesQuery,
    forecastQuery,
    shiftQuery,
    supabase.from('labor_guideline').select('*').eq('store_id', storeId).limit(1).maybeSingle(), // assumes one active guideline per store
  ]);
  if (salesError) throw salesError;
  if (forecastError) throw forecastError;
  if (shiftsError) throw shiftsError;
  if (guidelineError) throw guidelineError;

  const salesActual = salesRecords.reduce((s, r) => s + Number(r.amount), 0);
  const forecastTotal = forecasts.reduce((s, r) => s + Number(r.forecasted_sales), 0);
  const plannedHours = shifts.reduce((s, sh) => s + Number(sh.planned_hours), 0);
  const actualHours = shifts.reduce((s, sh) => s + (sh.actual_hours ? Number(sh.actual_hours.actual_hours) : 0), 0);

  const targetProductivity = guideline?.target_productivity ? Number(guideline.target_productivity) : null;
  const allowedHours = targetProductivity && forecastTotal ? Math.round(forecastTotal / targetProductivity) : null;
  const remainingHours = allowedHours !== null ? Math.max(allowedHours - actualHours, 0) : null;
  const laborPercent = allowedHours ? Math.round((actualHours / allowedHours) * 10000) / 100 : null;
  const productivity = actualHours > 0 ? Math.round((salesActual / actualHours) * 100) / 100 : 0;

  return {
    storeId, // this IS store.id, the canonical Store ID (e.g. "1001") — not a UUID
    salesActual: Math.round(salesActual),
    forecastSales: Math.round(forecastTotal),
    plannedHours: Math.round(plannedHours * 100) / 100,
    actualHours: Math.round(actualHours * 100) / 100,
    allowedHours,
    remainingHours,
    laborPercent,
    productivity,
    series: { salesRecords, forecasts },
  };
}

/**
 * Company / multi-store dashboard, scoped by role (Store Manager -> own
 * store, Area Coach -> assigned stores, Executive/Admin -> everything).
 */
async function getCompanyDashboard(user) {
  const allowedStoreIds = getAllowedStoreIds(user);
  let storeQuery = supabase.from('store').select('*');
  if (allowedStoreIds) storeQuery = storeQuery.in('id', allowedStoreIds);
  const { data: stores, error } = await storeQuery;
  if (error) throw error;

  const results = await Promise.all(
    stores.map(async (store) => {
      const productivity = await getStoreProductivity({ storeId: store.id });
      return { store: withDisplayStoreId(store), ...productivity };
    })
  );

  const ranked = [...results].sort((a, b) => b.productivity - a.productivity);

  return {
    stores: results,
    topPerformingStore: ranked[0] || null,
    worstPerformingStore: ranked[ranked.length - 1] || null,
  };
}

module.exports = { getStoreProductivity, getCompanyDashboard };
