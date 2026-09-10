const laborBudgetRepo = require('../repositories/laborBudgetRepository');
const whrTargetRepo = require('../repositories/whrTargetRepository');
const { weekdayOf, monthRange } = require('../utils/dateRange');
const { computeMonthlyForecastedSales } = require('./forecastService');

/**
 * Weekend = Saturday/Sunday (ISO weekday 6/0) — not explicitly specified
 * by the business guideline that introduced the weekday/weekend split;
 * this is a stated assumption, flagged for confirmation, not a silent
 * guess. Change this single function if the definition differs (e.g.
 * Friday-Sunday).
 */
function isWeekendDate(date) {
  const day = weekdayOf(date);
  return day === 0 || day === 6;
}

/**
 * "Sales/Budget level" for a store/date, per Phase 2's confirmed field
 * mapping: sales_report.gross_budget (the store's planned sales figure —
 * NOT sales_report.customer_budget, which is a customer/docket-COUNT field,
 * values in the hundreds, not a currency figure, and numerically does not
 * match the business reference's tier ranges), falling back to the Phase 1
 * hourly-forecast daily total when no budget has been entered for that date.
 */
async function resolveSalesLevel({ storeId, date, forecastValue = null }) {
  const grossBudget = await laborBudgetRepo.findGrossBudget(storeId, date);
  if (grossBudget != null) return { value: grossBudget, source: 'GROSS_BUDGET' };
  if (forecastValue != null) return { value: forecastValue, source: 'FORECAST' };
  return { value: null, source: null };
}

/**
 * Store-specific tiers take priority over global (store_id IS NULL) ones
 * when both are configured; within a pool, the first range containing
 * salesLevel wins. A matched tier's hours come from weekday_labor_hours /
 * weekend_labor_hours (the day-specific split) when set, falling back to
 * the legacy flat allowed_labor_hours for a tier that doesn't distinguish
 * weekday/weekend.
 */
function matchTier(tiers, salesLevel, { isWeekend = false } = {}) {
  if (salesLevel == null) return null;
  const storeTiers = tiers.filter((t) => t.store_id != null);
  const globalTiers = tiers.filter((t) => t.store_id == null);
  const pool = storeTiers.length ? storeTiers : globalTiers;
  const match = pool.find((t) => salesLevel >= Number(t.sales_min) && salesLevel <= Number(t.sales_max));
  if (!match) return null;

  const daySpecificHours = isWeekend ? match.weekend_labor_hours : match.weekday_labor_hours;
  const allowedLaborHours = daySpecificHours != null ? Number(daySpecificHours) : match.allowed_labor_hours != null ? Number(match.allowed_labor_hours) : null;

  return {
    allowedLaborHours,
    tierId: match.id,
    tierSource: storeTiers.length ? 'STORE_TIER' : 'GLOBAL_TIER',
    dayType: isWeekend ? 'WEEKEND' : 'WEEKDAY',
    // Master-Revise's remaining columns — informational today (not yet used
    // to shape shift generation beyond allowedLaborHours), carried through
    // for when that's needed.
    level: match.level ?? null,
    standardWorkingHours: match.standard_working_hours != null ? Number(match.standard_working_hours) : null,
    minStaffCount: match.min_staff_count != null ? Number(match.min_staff_count) : null,
  };
}

/**
 * The day's labor-hours budget from the Sales/Budget -> Labor Hours tier
 * guideline. allowedLaborHours is null when no tier is configured/matches —
 * the table starts empty (no values were invented), so this is the expected
 * result until tiers are added via the tier CRUD API. Callers (see
 * rosterGenerationService) fall back to the existing target_productivity-
 * derived sizing whenever this is null, so nothing regresses in the
 * meantime.
 */
async function computeDailyLaborHoursBudget({ storeId, date, forecastValue = null }) {
  const [salesLevel, tiers] = await Promise.all([resolveSalesLevel({ storeId, date, forecastValue }), laborBudgetRepo.findGuidelineTiers(storeId)]);
  const tierMatch = matchTier(tiers, salesLevel.value, { isWeekend: isWeekendDate(date) });
  return {
    salesLevel: salesLevel.value,
    salesLevelSource: salesLevel.source,
    allowedLaborHours: tierMatch ? tierMatch.allowedLaborHours : null,
    tierSource: tierMatch ? tierMatch.tierSource : null,
    dayType: tierMatch ? tierMatch.dayType : null,
    level: tierMatch ? tierMatch.level : null,
    standardWorkingHours: tierMatch ? tierMatch.standardWorkingHours : null,
    minStaffCount: tierMatch ? tierMatch.minStaffCount : null,
  };
}

/**
 * laborBudget = salesLevel x (target_col_percent / 100) — target_col_percent
 * is already stored and compared as a plain percentage number elsewhere in
 * this codebase (rosterValidationService compares it directly against a
 * laborCostPercent like 17.8), so it's divided by 100 here too. The
 * spec's literal "customer_budget x target_col_percent" formula would be
 * 100x too large under that convention; this applies the same /100 Phase 1
 * already relies on.
 */
function computeLaborCostBudget({ salesLevel, guideline }) {
  const targetColPercent = guideline?.target_col_percent != null ? Number(guideline.target_col_percent) : null;
  if (salesLevel == null || targetColPercent == null) return null;
  return Math.round(salesLevel * (targetColPercent / 100) * 100) / 100;
}

/**
 * Monthly Sales/Budget -> Monthly Labor Hours guideline (the given business
 * table, exactly 30x each bracket's daily "Standard Working Hours" figure).
 * A planning/budget CEILING, never a fill target — see getMonthlyLaborGuideline.
 */
const MONTHLY_LABOR_GUIDELINE_TIERS = [
  { min: 0, max: 250000, hours: 840 },
  { min: 250001, max: 330000, hours: 780 },
  { min: 330001, max: 410000, hours: 810 },
  { min: 410001, max: 500000, hours: 840 },
  { min: 500001, max: 540000, hours: 990 },
  { min: 540001, max: 620000, hours: 1020 },
  { min: 620001, max: 660000, hours: 1050 },
  { min: 660001, max: 700000, hours: 1080 },
  { min: 700001, max: 780000, hours: 1140 },
  { min: 780001, max: 870000, hours: 1290 },
  { min: 870001, max: 950000, hours: 1290 },
  { min: 950001, max: 1500000, hours: 1290 },
];

/**
 * Maps a store's monthly sales figure to its Monthly Labor Hours guideline
 * bracket — a planning CEILING for the month, never a number the roster
 * generator tries to fill. rosterGenerationService never imports this
 * function (or computeMonthlySalesSummary/resolveMonthlyLaborHoursGuideline)
 * directly — it only ever sees the single resolved hours number, via
 * monthlyCapacityService.computeMonthlyCapacity, applied exactly the same
 * way the pre-existing manually-entered labor_guideline.monthly_labor_hours
 * already was: a hard cap on discretionary (productivity-justified) extra
 * staffing, never a target that coverage/opening/closing get padded toward.
 *
 * `monthlySales` above 1,500,000 (the table's own top bound) has no given
 * rule — this is reported as out-of-range (`withinRange: false, hours:
 * null`), never guessed at by extrapolating the table.
 */
function getMonthlyLaborGuideline(monthlySales) {
  if (monthlySales == null || monthlySales < 0) return { hours: null, withinRange: false };
  const tier = MONTHLY_LABOR_GUIDELINE_TIERS.find((t) => monthlySales >= t.min && monthlySales <= t.max);
  if (!tier) return { hours: null, withinRange: false }; // > 1,500,000 — outside the given table
  return { hours: tier.hours, withinRange: true };
}

/**
 * The Monthly Labor Hours figure monthlyCapacityService actually applies as
 * roster generation's outer monthly cap:
 *   1. The store's own manually-entered labor_guideline.monthly_labor_hours,
 *      when set — an explicit human override always wins.
 *   2. Otherwise, the Monthly Sales -> Monthly Labor Hours table above,
 *      keyed to this month's FORECASTED sales (computeMonthlyForecastedSales)
 *      — generation always targets dates that haven't happened yet, so
 *      there's no actual monthly sales total to sum the way
 *      computeMonthlySalesSummary does for reporting on a month already
 *      under way.
 * Still just a ceiling either way (see getMonthlyLaborGuideline) — this
 * function only decides WHICH number feeds that ceiling, never how it's
 * enforced.
 */
async function resolveMonthlyLaborHoursGuideline({ storeId, monthKey, manualMonthlyLaborHours }) {
  if (manualMonthlyLaborHours != null) {
    return { hours: Number(manualMonthlyLaborHours), source: 'MANUAL', monthlySales: null, guidelineWithinRange: null };
  }
  const monthlySales = await computeMonthlyForecastedSales({ storeId, monthKey });
  const guideline = getMonthlyLaborGuideline(monthlySales);
  return { hours: guideline.hours, source: 'SALES_FORECAST', monthlySales, guidelineWithinRange: guideline.withinRange };
}

/**
 * The target_productivity roster generation actually feeds into
 * laborDemandService (the productivity-floor ceiling driving how many extra
 * staff a busy hour can justify — see maxJustifiedHeadcount):
 *   1. The store's own manually-entered labor_guideline.target_productivity,
 *      when set — an explicit human override always wins.
 *   2. Otherwise, this store's most recent REAL reported productivity from
 *      WHR Target Import (whr_target_monthly) — the store's own actual
 *      historical performance is a far better basis for "how many people
 *      does an hour of this store's sales justify" than the alternative
 *      (nothing at all — every real store checked has no labor_guideline
 *      row, so target_productivity has never had ANY value to work with
 *      before WHR Target existed).
 * Returns { value: null, source: null } when neither exists — callers must
 * keep behaving exactly as they do today for a store with no data at all
 * (laborDemandService already floors to the operational minimum in that
 * case), not invent a number.
 */
async function resolveTargetProductivity({ storeId, manualTargetProductivity }) {
  if (manualTargetProductivity != null) {
    return { value: Number(manualTargetProductivity), source: 'MANUAL' };
  }
  const latest = await whrTargetRepo.findLatestProductivity(storeId);
  if (latest?.productivity != null) {
    return { value: latest.productivity, source: 'WHR_TARGET_HISTORY', reportMonth: latest.reportMonth };
  }
  return { value: null, source: null };
}

/**
 * A store's total sales for one month (SUM(sales_report.gross_actual),
 * grouped by store_id + the given month), mapped through the Monthly Labor
 * Hours guideline table above. Reuses findGrossBudgetRange as-is (same
 * table, same date-range query, gross_actual is just one more column on
 * the existing select) — no duplicate sales query.
 */
async function computeMonthlySalesSummary({ storeId, monthKey }) {
  const { start, end } = monthRange(monthKey);
  const rows = await laborBudgetRepo.findGrossBudgetRange(storeId, start, end);
  const monthlySales = rows.reduce((sum, r) => sum + (r.gross_actual != null ? Number(r.gross_actual) : 0), 0);
  const guideline = getMonthlyLaborGuideline(monthlySales);
  return {
    storeId,
    monthKey,
    monthlySales: Math.round(monthlySales * 100) / 100,
    monthlyGuidelineHours: guideline.hours,
    guidelineWithinRange: guideline.withinRange,
  };
}

module.exports = {
  resolveSalesLevel,
  matchTier,
  computeDailyLaborHoursBudget,
  computeLaborCostBudget,
  isWeekendDate,
  getMonthlyLaborGuideline,
  computeMonthlySalesSummary,
  resolveMonthlyLaborHoursGuideline,
  resolveTargetProductivity,
};
