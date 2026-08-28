const laborBudgetRepo = require('../repositories/laborBudgetRepository');
const { weekdayOf } = require('../utils/dateRange');

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

module.exports = { resolveSalesLevel, matchTier, computeDailyLaborHoursBudget, computeLaborCostBudget, isWeekendDate };
