const { generateRoster } = require('../services/rosterService');
const supabase = require('../config/supabase');
const { success, failure } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

const ROSTER_SHIFTS_SELECT = '*, shift(*, employee(*), actual_hours(*))';

async function generate(req, res) {
  const { storeId, weekStart, forecastedSales, allowedHoursOverride } = req.body;

  const roster = await generateRoster({
    storeId,
    weekStart,
    forecastedSales,
    allowedHoursOverride,
    approvedBy: null,
  });

  await logActivity({ userId: req.user.id, action: 'GENERATE_ROSTER', storeId, details: { rosterId: roster.id } });

  return success(res, roster, 'Roster generated', 201);
}

async function list(req, res) {
  const { storeId } = req.query;
  const { data: rosters, error } = await supabase
    .from('roster')
    .select(ROSTER_SHIFTS_SELECT)
    .eq('store_id', storeId)
    .order('week_start', { ascending: false });
  if (error) throw error;
  return success(res, rosters);
}

async function getOne(req, res) {
  const { data: roster, error } = await supabase
    .from('roster')
    .select(ROSTER_SHIFTS_SELECT)
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) throw error;
  if (!roster) return failure(res, 'Roster not found', 404);
  return success(res, roster);
}

async function update(req, res) {
  const { status, shifts } = req.body;
  const id = req.params.id;

  const { data: roster, error } = await supabase.from('roster').update({ status }).eq('id', id).select().single();
  if (error) throw error;

  if (Array.isArray(shifts)) {
    for (const s of shifts) {
      const { error: shiftError } = await supabase.from('shift').update({ employee_id: s.employeeId }).eq('id', s.id);
      if (shiftError) throw shiftError;
    }
  }

  return success(res, roster, 'Roster updated');
}

async function remove(req, res) {
  const id = req.params.id;
  const { error: shiftError } = await supabase.from('shift').delete().eq('roster_id', id);
  if (shiftError) throw shiftError;
  const { error } = await supabase.from('roster').delete().eq('id', id);
  if (error) throw error;

  await logActivity({ userId: req.user.id, action: 'DELETE_ROSTER', details: { rosterId: id } });

  return success(res, null, 'Roster deleted');
}

module.exports = { generate, list, getOne, update, remove };
