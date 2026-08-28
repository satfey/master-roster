const supabase = require('../config/supabase');

/** sales_report.gross_budget for one store/date — the "Sales/Budget level" the tier guideline keys off (never customer_budget, which is a customer-count field, not a currency one — see laborBudgetService.js). */
async function findGrossBudget(storeId, date) {
  const { data, error } = await supabase.from('sales_report').select('gross_budget').eq('store_id', storeId).eq('report_date', date).maybeSingle();
  if (error) throw error;
  return data ? Number(data.gross_budget) : null;
}

async function findGrossBudgetRange(storeId, startDate, endDate) {
  const { data, error } = await supabase
    .from('sales_report')
    .select('report_date, gross_budget')
    .eq('store_id', storeId)
    .gte('report_date', startDate)
    .lte('report_date', endDate);
  if (error) throw error;
  return data;
}

/** Tiers applying to a store: its own overrides (store_id = storeId) plus the global defaults (store_id IS NULL). Empty today — see the Phase 2 migration. */
async function findGuidelineTiers(storeId) {
  const { data, error } = await supabase.from('labor_hour_guideline_tier').select('*').or(`store_id.eq.${storeId},store_id.is.null`).order('sales_min', { ascending: true });
  if (error) throw error;
  return data;
}

async function findAllGuidelineTiers() {
  const { data, error } = await supabase.from('labor_hour_guideline_tier').select('*').order('store_id', { ascending: true }).order('sales_min', { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * level/standardWorkingHours/minStaffCount are the Master-Revise sheet's
 * remaining columns ("Level", "Standard Working Day", "Staff
 * requirement") — optional, informational today, preserved for future
 * roster-generation use. allowedLaborHours is the legacy flat figure for
 * a tier that doesn't distinguish weekday/weekend; weekdayLaborHours /
 * weekendLaborHours take priority over it when set (see matchTier in
 * laborBudgetService.js). At least one of the three should be given, but
 * that's left to the caller/route validation, not enforced here.
 */
async function createGuidelineTier({ storeId, salesMin, salesMax, allowedLaborHours, weekdayLaborHours, weekendLaborHours, level, standardWorkingHours, minStaffCount }) {
  const { data, error } = await supabase
    .from('labor_hour_guideline_tier')
    .insert({
      store_id: storeId ?? null,
      sales_min: salesMin,
      sales_max: salesMax,
      allowed_labor_hours: allowedLaborHours ?? null,
      weekday_labor_hours: weekdayLaborHours ?? null,
      weekend_labor_hours: weekendLaborHours ?? null,
      level: level ?? null,
      standard_working_hours: standardWorkingHours ?? null,
      min_staff_count: minStaffCount ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateGuidelineTier(id, fields) {
  const { data, error } = await supabase.from('labor_hour_guideline_tier').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

async function deleteGuidelineTier(id) {
  const { error } = await supabase.from('labor_hour_guideline_tier').delete().eq('id', id);
  if (error) throw error;
}

/** Upserts one store's actual labor hours for one date (the store+date-level aggregate entry — independent of any single shift; see store_actual_hours in the Phase 2 migration). */
async function upsertStoreActualHours({ storeId, actualDate, actualHours, recordedBy }) {
  const { data, error } = await supabase
    .from('store_actual_hours')
    .upsert({ store_id: storeId, actual_date: actualDate, actual_hours: actualHours, recorded_by: recordedBy ?? null, updated_at: new Date().toISOString() }, { onConflict: 'store_id,actual_date' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function findStoreActualHours(storeId, { from, to } = {}) {
  let query = supabase.from('store_actual_hours').select('*').eq('store_id', storeId).order('actual_date', { ascending: true });
  if (from) query = query.gte('actual_date', from);
  if (to) query = query.lte('actual_date', to);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

module.exports = {
  findGrossBudget,
  findGrossBudgetRange,
  findGuidelineTiers,
  findAllGuidelineTiers,
  createGuidelineTier,
  updateGuidelineTier,
  deleteGuidelineTier,
  upsertStoreActualHours,
  findStoreActualHours,
};
