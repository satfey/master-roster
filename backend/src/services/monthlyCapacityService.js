const rosterRepo = require('../repositories/rosterRepository');
const laborBudgetRepo = require('../repositories/laborBudgetRepository');
const { resolveMonthlyLaborHoursGuideline } = require('./laborBudgetService');
const { eachDateInRange, monthRange } = require('../utils/dateRange');

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * The rolling monthly labor-hour picture for a store: guideline, hours
 * used-or-committed to date, and what remains.
 *
 * Per day, ACTUAL overrides PLANNED whenever an actual has been recorded
 * (store_actual_hours is the source of truth once entered); otherwise the
 * day's planned hours are the "committed" figure. Summed across the month,
 * that single per-day substitution is exactly
 * `monthlyGuideline - actualHoursUsedToDate - futureCommittedPlannedHours`
 * without needing to separately decide where "today" falls — a day either
 * has an actual (counts as actual) or it doesn't (counts as planned/future).
 *
 * `excludeDateRange`, when given, drops shifts inside that range from the
 * planned total — used by rosterGenerationService so the shifts about to be
 * regenerated aren't counted against themselves before they're replaced.
 * Actuals are never excluded this way: once entered, they're ground truth
 * regardless of what's being regenerated.
 *
 * The guideline itself (`monthlyGuideline` below) is resolved by
 * laborBudgetService.resolveMonthlyLaborHoursGuideline: the store's own
 * manually-entered labor_guideline.monthly_labor_hours when set, otherwise
 * this month's Sales -> Labor Hours table bracket keyed to FORECASTED
 * monthly sales (there's no actual monthly total yet for a month roster
 * generation is still scheduling). Either way it stays a ceiling only —
 * this function only ever subtracts against it, never fills toward it.
 */
async function computeMonthlyCapacity({ storeId, monthKey, guideline, excludeDateRange }) {
  const { start, end } = monthRange(monthKey);

  const [shifts, actuals, resolvedGuideline] = await Promise.all([
    rosterRepo.findShiftsForStoreInRange(storeId, start, end),
    laborBudgetRepo.findStoreActualHours(storeId, { from: start, to: end }),
    guideline !== undefined ? Promise.resolve(guideline) : rosterRepo.findGuideline(storeId),
  ]);

  const plannedByDate = new Map();
  for (const s of shifts) {
    if (excludeDateRange && s.shift_date >= excludeDateRange.start && s.shift_date <= excludeDateRange.end) continue;
    plannedByDate.set(s.shift_date, (plannedByDate.get(s.shift_date) || 0) + Number(s.planned_hours));
  }
  const actualByDate = new Map(actuals.map((a) => [a.actual_date, Number(a.actual_hours)]));

  const byDate = eachDateInRange(start, end).map((date) => {
    const planned = plannedByDate.get(date) || 0;
    const actual = actualByDate.has(date) ? actualByDate.get(date) : null;
    const variance = actual != null ? round2(actual - planned) : null;
    return { date, plannedHours: round2(planned), actualHours: actual != null ? round2(actual) : null, variance };
  });

  const hoursUsedOrCommitted = round2(byDate.reduce((sum, d) => sum + (d.actualHours != null ? d.actualHours : d.plannedHours), 0));
  const manualMonthlyLaborHours = resolvedGuideline?.monthly_labor_hours != null ? Number(resolvedGuideline.monthly_labor_hours) : null;
  const guidelineResult = await resolveMonthlyLaborHoursGuideline({ storeId, monthKey, manualMonthlyLaborHours });
  const monthlyGuideline = guidelineResult.hours;
  const monthlyGuidelineSource = guidelineResult.source;
  const remainingHours = monthlyGuideline != null ? round2(monthlyGuideline - hoursUsedOrCommitted) : null;

  return { storeId, monthKey, monthlyGuideline, monthlyGuidelineSource, hoursUsedOrCommitted, remainingHours, byDate };
}

module.exports = { computeMonthlyCapacity };
