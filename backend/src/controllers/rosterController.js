const { generateRoster } = require('../services/rosterService');
const { generateDraftRoster } = require('../services/rosterGenerationService');
const { validateRoster } = require('../services/rosterValidationService');
const { computeMonthlyCapacity } = require('../services/monthlyCapacityService');
const laborBudgetRepo = require('../repositories/laborBudgetRepository');
const supabase = require('../config/supabase');
const { success, failure } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

const ROSTER_SHIFTS_SELECT = '*, shift(*, employee(*), actual_hours(*))';

async function generate(req, res) {
  const { storeId, weekStart, forecastedSales, allowedHoursOverride, regenerate } = req.body;

  const roster = await generateRoster({
    storeId,
    weekStart,
    forecastedSales,
    allowedHoursOverride,
    approvedBy: null,
    regenerate: !!regenerate,
  });

  await logActivity({ userId: req.user.id, action: 'GENERATE_ROSTER', storeId, details: { rosterId: roster.id, regenerate: !!regenerate } });

  return success(res, roster, 'Roster generated', 201);
}

async function autoGenerate(req, res) {
  const { storeId, startDate, endDate, regenerate } = req.body;
  if (!storeId) return failure(res, 'storeId is required', 400);
  if (!startDate || !endDate) return failure(res, 'startDate and endDate are required', 400);

  const result = await generateDraftRoster({ storeId, startDate, endDate, regenerate: !!regenerate });

  await logActivity({ userId: req.user.id, action: 'AUTO_GENERATE_ROSTER', storeId, details: { rosterIds: result.rosterIds, generatedShifts: result.generatedShifts } });

  return success(res, result, 'Draft roster generated', 201);
}

async function validate(req, res) {
  const { storeId, startDate, endDate } = req.body;
  if (!storeId) return failure(res, 'storeId is required', 400);
  if (!startDate || !endDate) return failure(res, 'startDate and endDate are required', 400);

  const result = await validateRoster({ storeId, startDate, endDate });
  return success(res, result);
}

/**
 * Records (or updates) a store's actual labor hours for one date — a
 * store+date-level total, independent of any single shift (e.g. "an event
 * pushed Friday to 68 actual hours"). Extends the existing per-shift
 * actual-hours capability (PUT /labor) rather than replacing it; both
 * coexist (see store_actual_hours in the Phase 2 migration).
 */
async function recordActualHours(req, res) {
  const { storeId, date, actualHours } = req.body;
  if (!storeId) return failure(res, 'storeId is required', 400);
  if (!date) return failure(res, 'date is required', 400);
  if (actualHours == null || Number.isNaN(Number(actualHours))) return failure(res, 'actualHours is required', 400);

  const record = await laborBudgetRepo.upsertStoreActualHours({ storeId, actualDate: date, actualHours: Number(actualHours), recordedBy: req.user.id });

  await logActivity({ userId: req.user.id, action: 'RECORD_STORE_ACTUAL_HOURS', storeId, details: { date, actualHours } });

  return success(res, record, 'Actual hours recorded');
}

async function listActualHours(req, res) {
  const { storeId, from, to } = req.query;
  if (!storeId) return failure(res, 'storeId is required', 400);

  const records = await laborBudgetRepo.findStoreActualHours(storeId, { from, to });
  return success(res, records);
}

/** Monthly Labor Guideline / Used / Remaining — the top summary block of PHASE 2's frontend response. */
async function capacity(req, res) {
  const { storeId, month } = req.query;
  if (!storeId) return failure(res, 'storeId is required', 400);
  if (!month) return failure(res, 'month is required (YYYY-MM)', 400);

  const result = await computeMonthlyCapacity({ storeId, monthKey: month });
  return success(res, result);
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

module.exports = { generate, autoGenerate, validate, recordActualHours, listActualHours, capacity, list, getOne, update, remove };
