const supabase = require('../config/supabase');
const { runInBatches } = require('../utils/batchQuery');

async function findGuideline(storeId) {
  const { data, error } = await supabase.from('labor_guideline').select('*').eq('store_id', storeId).limit(1).maybeSingle(); // assumes one active guideline per store, matching rosterService/laborService/dashboardService
  if (error) throw error;
  return data;
}

async function findActiveEmployees(storeId) {
  const { data, error } = await supabase.from('employee').select('*').eq('store_id', storeId).eq('is_active', true).order('last_name', { ascending: true });
  if (error) throw error;
  return data;
}

/** Every shift already scheduled for a set of employees within a date range (across ANY roster/week) — used to enforce the employee's monthly hour cap across week boundaries, and to detect overlaps against shifts outside the range currently being (re)generated. */
async function findShiftsForEmployeesInRange(employeeIds, fromDate, toDate) {
  if (!employeeIds.length) return [];
  const shifts = await runInBatches(employeeIds, (batch) =>
    supabase.from('shift').select('*').in('employee_id', batch).gte('shift_date', fromDate).lte('shift_date', toDate)
  );
  return shifts;
}

async function findRosterByStoreAndWeek(storeId, weekStart) {
  const { data, error } = await supabase.from('roster').select('*').eq('store_id', storeId).eq('week_start', weekStart).maybeSingle();
  if (error) throw error;
  return data;
}

/** Creates the week's roster row if it doesn't exist yet, or returns the existing one (regeneration replaces shifts, not the roster row itself — status/approval history is preserved). */
async function findOrCreateRoster({ storeId, weekStart }) {
  const existing = await findRosterByStoreAndWeek(storeId, weekStart);
  if (existing) return existing;

  const { data, error } = await supabase
    .from('roster')
    .insert({ store_id: storeId, week_start: weekStart, status: 'DRAFT', approved_by: null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Deletes only the shifts within [fromDate, toDate] for a roster — a regeneration request may cover only part of a week, and the rest of that week's shifts must survive untouched. */
async function deleteShiftsForRosterInRange(rosterId, fromDate, toDate) {
  const { error } = await supabase.from('shift').delete().eq('roster_id', rosterId).gte('shift_date', fromDate).lte('shift_date', toDate);
  if (error) throw error;
}

async function insertShifts(rows) {
  if (!rows.length) return [];
  const { data, error } = await supabase.from('shift').insert(rows).select();
  if (error) throw error;
  return data;
}

async function findRosterWithShifts(rosterId) {
  const { data, error } = await supabase.from('roster').select('*, shift(*, employee(*))').eq('id', rosterId).single();
  if (error) throw error;
  return data;
}

/** All shifts for a store across a date range, with employee + roster status attached — used by roster validation. */
async function findShiftsForStoreInRange(storeId, fromDate, toDate) {
  const { data, error } = await supabase
    .from('shift')
    .select('*, employee(*), roster!inner(store_id, status)')
    .eq('roster.store_id', storeId)
    .gte('shift_date', fromDate)
    .lte('shift_date', toDate);
  if (error) throw error;
  return data;
}

module.exports = {
  findGuideline,
  findActiveEmployees,
  findShiftsForEmployeesInRange,
  findRosterByStoreAndWeek,
  findOrCreateRoster,
  deleteShiftsForRosterInRange,
  insertShifts,
  findRosterWithShifts,
  findShiftsForStoreInRange,
};
