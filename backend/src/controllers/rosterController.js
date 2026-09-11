const { generateDraftRoster } = require('../services/rosterGenerationService');
const { validateRoster } = require('../services/rosterValidationService');
const { computeMonthlyCapacity } = require('../services/monthlyCapacityService');
const { computeMonthlySalesSummary } = require('../services/laborBudgetService');
const laborBudgetRepo = require('../repositories/laborBudgetRepository');
const supabase = require('../config/supabase');
const { success, failure } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

const ROSTER_SHIFTS_SELECT = '*, shift(*, employee(*), actual_hours(*))';

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

  // capacityResult.monthlyGuideline is the number actually enforced as a ceiling by roster generation —
  // the store's manually-entered monthly_labor_hours when set, otherwise this month's FORECASTED sales
  // mapped through the Monthly Labor Hours table (see laborBudgetService.resolveMonthlyLaborHoursGuideline).
  // salesSummary.monthlyGuidelineHours is a separate reporting figure: the same table, but keyed to this
  // month's ACTUAL sales-to-date (sales_report.gross_actual) — useful to compare "what generation planned
  // against" vs. "what the guideline would be given how the month has actually gone so far". Distinct
  // fields on purpose; never merged into one number.
  const [capacityResult, salesSummary] = await Promise.all([
    computeMonthlyCapacity({ storeId, monthKey: month }),
    computeMonthlySalesSummary({ storeId, monthKey: month }),
  ]);
  return success(res, { ...capacityResult, ...salesSummary });
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

/**
 * Reassigns who covers shifts in a roster (and optionally moves the roster's status).
 *
 * SECURITY: every shift update is constrained by `.eq('roster_id', id)` as well as the shift's own
 * id. rosterScope has already proven the caller may touch THIS roster, but it says nothing about
 * the shift ids in the body — without the roster_id filter a Store Manager could PUT their own
 * roster while passing a shift id belonging to another store's roster and have it reassigned,
 * which would defeat rosterScope entirely. A shift id that isn't in this roster now matches zero
 * rows and is reported rather than silently ignored.
 *
 * employee_id is checked the same way: an employee may only be assigned to a shift in a roster
 * belonging to that employee's own store, so a reassignment cannot pull staff across stores.
 */
async function update(req, res) {
  const { status, shifts } = req.body;
  const id = req.params.id;

  // Only touch `status` when the caller actually sent one — this endpoint's main use is
  // reassigning shifts, and those requests carry no status.
  const rosterPatch = status === undefined ? {} : { status };
  const { data: roster, error } = Object.keys(rosterPatch).length
    ? await supabase.from('roster').update(rosterPatch).eq('id', id).select().single()
    : await supabase.from('roster').select('*').eq('id', id).single();
  if (error) throw error;

  if (Array.isArray(shifts) && shifts.length) {
    const employeeIds = [...new Set(shifts.map((s) => s.employeeId).filter(Boolean))];
    if (employeeIds.length) {
      const { data: ownEmployees, error: employeeError } = await supabase
        .from('employee')
        .select('id')
        .eq('store_id', roster.store_id)
        .in('id', employeeIds);
      if (employeeError) throw employeeError;

      const ownEmployeeIds = new Set(ownEmployees.map((e) => e.id));
      const foreign = employeeIds.filter((employeeId) => !ownEmployeeIds.has(employeeId));
      if (foreign.length) {
        return failure(res, `Employee not in this roster's store: ${foreign.join(', ')}`, 403);
      }
    }

    for (const s of shifts) {
      const { data: updated, error: shiftError } = await supabase
        .from('shift')
        .update({ employee_id: s.employeeId })
        .eq('id', s.id)
        .eq('roster_id', id)
        .select('id');
      if (shiftError) throw shiftError;
      if (!updated.length) return failure(res, `Shift ${s.id} does not belong to this roster`, 403);
    }
  }

  await logActivity({
    userId: req.user.id,
    action: 'UPDATE_ROSTER',
    storeId: roster.store_id,
    details: { rosterId: id, status, shiftCount: Array.isArray(shifts) ? shifts.length : 0 },
  });

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

module.exports = { autoGenerate, validate, recordActualHours, listActualHours, capacity, list, getOne, update, remove };
