const supabase = require('../config/supabase');

/**
 * Records actual worked hours for a single shift (clock-in/out or a manual
 * hours entry). Upserts the 1:1 ActualHours row for that shift.
 */
async function recordActualHours({ shiftId, actualHours, clockIn, clockOut, recordedBy }) {
  const { data: shift, error: shiftError } = await supabase.from('shift').select('*').eq('id', shiftId).maybeSingle();
  if (shiftError) throw shiftError;
  if (!shift) throw Object.assign(new Error('Shift not found'), { status: 404 });

  const { data: record, error } = await supabase
    .from('actual_hours')
    .upsert(
      { shift_id: shiftId, actual_hours: actualHours, clock_in: clockIn, clock_out: clockOut, recorded_by: recordedBy },
      { onConflict: 'shift_id' }
    )
    .select()
    .single();
  if (error) throw error;

  return { ...record, plannedHours: shift.planned_hours, isOverPlanned: Number(actualHours) > Number(shift.planned_hours) };
}

/**
 * Summarizes planned vs. actual labor hours for a store over a date range,
 * and compares total actual hours against the labor-hour budget derived
 * from the store's LaborGuideline + forecasted sales for the same period.
 */
async function getStoreLaborSummary({ storeId, from, to }) {
  let shiftQuery = supabase
    .from('shift')
    .select('*, actual_hours(*), employee(*), roster!inner(store_id)')
    .eq('roster.store_id', storeId)
    .order('shift_date', { ascending: true });
  if (from) shiftQuery = shiftQuery.gte('shift_date', from);
  if (to) shiftQuery = shiftQuery.lte('shift_date', to);
  const { data: shifts, error: shiftsError } = await shiftQuery;
  if (shiftsError) throw shiftsError;

  const plannedHours = shifts.reduce((s, sh) => s + Number(sh.planned_hours), 0);
  const actualHours = shifts.reduce((s, sh) => s + (sh.actual_hours ? Number(sh.actual_hours.actual_hours) : 0), 0);

  const { data: guideline, error: guidelineError } = await supabase
    .from('labor_guideline')
    .select('*')
    .eq('store_id', storeId)
    .limit(1)
    .maybeSingle(); // assumes one active guideline per store
  if (guidelineError) throw guidelineError;

  let forecastQuery = supabase.from('sales_forecast').select('*').eq('store_id', storeId);
  if (from) forecastQuery = forecastQuery.gte('forecast_date', from);
  if (to) forecastQuery = forecastQuery.lte('forecast_date', to);
  const { data: forecasts, error: forecastsError } = await forecastQuery;
  if (forecastsError) throw forecastsError;
  const forecastTotal = forecasts.reduce((s, f) => s + Number(f.forecasted_sales), 0);

  const targetProductivity = guideline?.target_productivity ? Number(guideline.target_productivity) : null;
  const allowedHours = targetProductivity && forecastTotal ? Math.round(forecastTotal / targetProductivity) : null;

  const remainingHours = allowedHours !== null ? Math.max(allowedHours - actualHours, 0) : null;
  const laborPercent = allowedHours ? Math.round((actualHours / allowedHours) * 10000) / 100 : null;

  return {
    shifts,
    plannedHours: Math.round(plannedHours * 100) / 100,
    actualHours: Math.round(actualHours * 100) / 100,
    allowedHours,
    remainingHours,
    laborPercent,
    isOverBudget: allowedHours !== null ? actualHours > allowedHours : null,
  };
}

module.exports = { recordActualHours, getStoreLaborSummary };
