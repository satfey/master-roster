const { recordActualHours, getStoreLaborSummary } = require('../services/laborService');
const laborBudgetRepo = require('../repositories/laborBudgetRepository');
const rosterRepo = require('../repositories/rosterRepository');
const { previewHourlyForecast } = require('../services/forecastService');
const { computeLaborDemand } = require('../services/laborDemandService');
const { resolveTargetProductivity } = require('../services/laborBudgetService');
const { success, failure } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

async function recordHours(req, res) {
  const { shiftId, actualHours, clockIn, clockOut } = req.body;

  const record = await recordActualHours({
    shiftId,
    actualHours: Number(actualHours),
    clockIn: clockIn ? new Date(clockIn) : null,
    clockOut: clockOut ? new Date(clockOut) : null,
    recordedBy: req.user.id,
  });

  await logActivity({ userId: req.user.id, action: 'RECORD_ACTUAL_HOURS', details: { shiftId, actualHours } });

  return success(
    res,
    record,
    record.isOverPlanned ? 'Warning: actual hours exceed the planned shift hours' : 'Actual hours recorded'
  );
}

/**
 * Read-only hourly labour demand for a date range: how many people each operating hour requires
 * (the sales-independent operational minimum) and the most its forecast sales can justify.
 *
 * This is the SAME computation roster generation and validation are held to — it calls
 * laborDemandService.computeLaborDemand over the real hourly forecast, resolving
 * target_productivity exactly as rosterGenerationService does. It exists so screens can show the
 * real demand curve instead of keeping their own copy of these numbers; it writes nothing.
 */
async function demand(req, res) {
  const { storeId, from, to } = req.query;
  if (!storeId) return failure(res, 'storeId is required', 400);
  if (!from || !to) return failure(res, 'from and to are required (YYYY-MM-DD)', 400);
  if (from > to) return failure(res, 'from must not be after to', 400);

  const guidelineRow = await rosterRepo.findGuideline(storeId);
  const manualTargetProductivity = guidelineRow?.target_productivity != null ? Number(guidelineRow.target_productivity) : null;
  const productivity = await resolveTargetProductivity({ storeId, manualTargetProductivity });

  const forecast = await previewHourlyForecast({ storeId, startDate: from, endDate: to });
  const result = computeLaborDemand({
    days: forecast.days,
    guideline: {
      target_productivity: productivity.value,
      min_staff_per_shift: guidelineRow?.min_staff_per_shift ?? 0,
    },
  });

  return success(res, {
    storeId,
    from,
    to,
    targetProductivity: productivity.value,
    targetProductivitySource: productivity.source,
    days: result.days,
    warnings: result.warnings,
  });
}

async function summary(req, res) {
  const { storeId, from, to } = req.query;
  const data = await getStoreLaborSummary({ storeId, from, to });
  return success(res, data);
}

/**
 * Sales/Budget -> Labor Hours guideline tiers (PHASE 2). Deliberately plain
 * CRUD, no business values seeded — "authorized users can change these
 * without modifying application code," per the requirement. storeId omitted
 * = a global default tier applying to every store without its own override.
 */
async function listTiers(req, res) {
  const { storeId } = req.query;
  const tiers = storeId ? await laborBudgetRepo.findGuidelineTiers(storeId) : await laborBudgetRepo.findAllGuidelineTiers();
  return success(res, tiers);
}

async function createTier(req, res) {
  const { storeId, salesMin, salesMax, allowedLaborHours, weekdayLaborHours, weekendLaborHours, level, standardWorkingHours, minStaffCount } = req.body;
  if (salesMin == null || salesMax == null) return failure(res, 'salesMin and salesMax are required', 400);
  if (allowedLaborHours == null && (weekdayLaborHours == null || weekendLaborHours == null)) {
    return failure(res, 'Provide either allowedLaborHours, or both weekdayLaborHours and weekendLaborHours', 400);
  }
  if (Number(salesMin) >= Number(salesMax)) return failure(res, 'salesMin must be less than salesMax', 400);

  const tier = await laborBudgetRepo.createGuidelineTier({
    storeId: storeId || null,
    salesMin: Number(salesMin),
    salesMax: Number(salesMax),
    allowedLaborHours: allowedLaborHours != null ? Number(allowedLaborHours) : null,
    weekdayLaborHours: weekdayLaborHours != null ? Number(weekdayLaborHours) : null,
    weekendLaborHours: weekendLaborHours != null ? Number(weekendLaborHours) : null,
    level: level != null ? Number(level) : null,
    standardWorkingHours: standardWorkingHours != null ? Number(standardWorkingHours) : null,
    minStaffCount: minStaffCount != null ? Number(minStaffCount) : null,
  });
  await logActivity({ userId: req.user.id, action: 'CREATE_LABOR_HOUR_TIER', storeId: storeId || null, details: tier });
  return success(res, tier, 'Tier created', 201);
}

async function updateTier(req, res) {
  const { salesMin, salesMax, allowedLaborHours, weekdayLaborHours, weekendLaborHours, level, standardWorkingHours, minStaffCount } = req.body;
  const fields = {};
  if (salesMin != null) fields.sales_min = Number(salesMin);
  if (salesMax != null) fields.sales_max = Number(salesMax);
  if (allowedLaborHours != null) fields.allowed_labor_hours = Number(allowedLaborHours);
  if (weekdayLaborHours != null) fields.weekday_labor_hours = Number(weekdayLaborHours);
  if (weekendLaborHours != null) fields.weekend_labor_hours = Number(weekendLaborHours);
  if (level != null) fields.level = Number(level);
  if (standardWorkingHours != null) fields.standard_working_hours = Number(standardWorkingHours);
  if (minStaffCount != null) fields.min_staff_count = Number(minStaffCount);

  const tier = await laborBudgetRepo.updateGuidelineTier(req.params.id, fields);
  await logActivity({ userId: req.user.id, action: 'UPDATE_LABOR_HOUR_TIER', details: tier });
  return success(res, tier, 'Tier updated');
}

async function deleteTier(req, res) {
  await laborBudgetRepo.deleteGuidelineTier(req.params.id);
  await logActivity({ userId: req.user.id, action: 'DELETE_LABOR_HOUR_TIER', details: { id: req.params.id } });
  return success(res, null, 'Tier deleted');
}

module.exports = { demand, recordHours, summary, listTiers, createTier, updateTier, deleteTier };
