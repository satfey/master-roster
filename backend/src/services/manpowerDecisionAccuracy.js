const { computeHourlyLaborDemand } = require('./laborDemandService');
const { computeDailyForecast, computeHourShape } = require('./forecastService');
const { OPERATING_HOURS, CLOSING_COVERAGE_STAFF_COUNT, operatingHourList } = require('./storeOperatingHours');

/**
 * Turns "was the sales forecast accurate" into the question Master Roster actually exists to
 * answer: "when that forecast is used to size manpower hour by hour, does it tell you to
 * increase/keep/decrease staff correctly?" Every headcount number here comes from the real
 * production sizing rule (laborDemandService.computeHourlyLaborDemand) and the real forecast
 * (forecastService.computeDailyForecast) — nothing here re-derives a new "sales -> manpower"
 * formula; this module only ever composes those two existing pure functions for evaluation.
 *
 * GROUND TRUTH FOR "ACTUAL REQUIRED HEADCOUNT": production has no per-(date, hour) actual sales
 * anywhere (confirmed earlier this project: sales_by_hour is aggregated per store+calendar month,
 * not per date — there is no table, import, or report that carries real hourly sales tied to a
 * specific date). So the "actual hourly sales" used here is a PROXY: the real reported DAILY
 * actual (sales_report.gross_actual) redistributed across hours using the store's own real
 * historical hour-of-day shape (computeHourShape) — the exact same shape
 * forecastService.generateHourlyForecast already uses to split a FORECASTED daily total into
 * hours. This is not a new formula: it is production's own existing "daily total x hour shape"
 * model, applied to the real actual daily total instead of the forecast, because that model is
 * the only hourly distribution the codebase has. It is explicitly flagged here, and in every
 * report this module's output feeds, as a proxy — not a claim that per-hour actuals exist.
 *
 * DECISION LABELS (INCREASE / KEEP / DECREASE): computed HOUR-TO-HOUR — comparing an hour's
 * required headcount against the immediately preceding operating hour's, computed from the SAME
 * sales source (both from actual, or both from forecast). This directly answers the real
 * operational question ("should THIS hour add or remove staff compared to the hour before it?"),
 * needs no data beyond what's already computed here, and — unlike comparing forecast-required to
 * actual-required at the same hour, which only ever measures the forecast's static SIZE error —
 * lets "actual_decision" vary meaningfully across all 3 classes, which a real Confusion Matrix
 * requires. The store's opening hour has no preceding operating hour and is left unclassified
 * (classifyDecision returns null for it) rather than compared across the overnight gap to the
 * previous day's closing hour, which would not be a meaningful "hour-to-hour" comparison.
 *
 * OPERATIONAL MINIMUM vs MANDATORY CLOSING: computeHourlyLaborDemand's own maxJustifiedHeadcount
 * is ALREADY max(productivity-justified headcount, operational minimum) — the operational-minimum
 * floor is inherent to the production function, not added here. The one additional hard constraint
 * production enforces that computeHourlyLaborDemand does NOT itself encode is the mandatory closing
 * pair (storeOperatingHours.CLOSING_COVERAGE_STAFF_COUNT, currently 2) — applied identically to
 * both the actual and forecast sides by applyMandatoryCoverageFloor below, so a correctly-floored
 * closing hour never registers as a spurious under/overstaffing error on either side.
 *
 * SCOPE NOT COVERED: rosterGenerationService's full per-day ceiling also reconciles a THIRD term
 * (the monthly labor-hour guideline's share of that day's forecast, "salesShapedHeadcount") on top
 * of computeHourlyLaborDemand's productivity ceiling. Replicating that would require extracting
 * monthly guideline resolution (a separate, stateful, DB-dependent computation spanning
 * laborBudgetService + monthlyCapacityService) — out of proportion for this measurement pass, so
 * this module measures against computeHourlyLaborDemand alone. Flagged here and in every report
 * this feeds, per "report what can't yet be evaluated" rather than silently narrowing scope.
 *
 * ============================================================================================
 * NAME AND DEFINITION OF THIS EVALUATION — read before changing or re-labeling anything below.
 * ============================================================================================
 * This is called MANPOWER DECISION ACCURACY. It is deliberately not called "Optimal Staffing
 * Accuracy", "Optimal Headcount Accuracy", or "Business Decision Accuracy" — none of those claims
 * are made or supportable here.
 *
 * DECISION_DEFINITION_TEXT (the exact, only definition of INCREASE/KEEP/DECREASE used anywhere in
 * this module): "Increase / Keep / Decrease represents the direction of change in required
 * headcount from the previous operating hour to the current operating hour, using the production
 * manpower-sizing rule." There is no percentage threshold anywhere (classifyDecision below
 * compares with plain >, <, ===, never a tolerance band) and no inference of manager intent.
 *
 * DECISION_DEFINITION_DISCLAIMER: this is an evaluation convention, adopted because
 * manager-approved staffing intent is not available anywhere in the system as ground truth — it
 * measures whether the forecast-derived manpower direction agrees with the actual-sales-derived
 * manpower direction; it does NOT prove that either staffing level is globally optimal, and it is
 * not a claim about business policy.
 *
 * PRIMARY KPI POPULATION: a store whose resolved target_productivity is missing/invalid (no
 * labor_guideline row, or a manual/WHR productivity that resolves to a falsy value) has a
 * CONSTANT computeHourlyLaborDemand output at every hour except the mandatory-closing hour
 * (see computeHourlyLaborDemand's own null-productivity fallback: maxJustifiedHeadcount collapses
 * to the sales-independent operational minimum). Evaluating such a store's decisions would not be
 * measuring forecast quality — it would trivially "succeed" because there is nothing demand-driven
 * to get right or wrong. Every record produced for such a store is tagged
 * evaluation_status: 'UNCONFIGURED_PRODUCTIVITY' and MUST be excluded from the primary
 * classification/business KPI (computePrimaryKpi below does this filtering); it is still counted
 * in coverage reporting (computeCoverageSummary) so the gap in labor_guideline configuration is
 * visible rather than hidden inside an inflated accuracy number.
 */

const DECISION_CLASSES = ['INCREASE', 'KEEP', 'DECREASE'];

const EVALUATION_STATUS = { CONFIGURED: 'CONFIGURED', UNCONFIGURED_PRODUCTIVITY: 'UNCONFIGURED_PRODUCTIVITY' };

const DECISION_DEFINITION_TEXT =
  'Increase / Keep / Decrease represents the direction of change in required headcount from the previous operating hour to the current operating hour, using the production manpower-sizing rule.';

const DECISION_DEFINITION_DISCLAIMER =
  'This is an evaluation convention used because manager-approved staffing intent is not available as ground truth. It measures whether the forecast-derived manpower direction agrees with the actual-sales-derived manpower direction; it does not prove that either staffing level is globally optimal.';

/**
 * Reproducibility metadata for this evaluation, so the KPI stays interpretable even if the
 * business definition of "correct staffing decision" changes later — a consumer of these numbers
 * can check decisionDefinitionVersion rather than assuming today's convention still applies.
 */
const EVALUATION_METADATA = {
  decisionDefinition: 'PREVIOUS_OPERATING_HOUR_HEADCOUNT_DELTA',
  decisionDefinitionVersion: 1,
  classificationThreshold: 0,
  primaryPopulation: 'CONFIGURED_TARGET_PRODUCTIVITY_STORES',
  hourlyActualMode: 'DAILY_TOTAL_X_STORE_HOUR_SHAPE_PROXY',
  openingHourClassification: 'UNCLASSIFIED',
  closingCoverageFloor: CLOSING_COVERAGE_STAFF_COUNT,
};

/**
 * Resolves whether a store's guideline supports demand-driven sizing, using the exact same truthy
 * check computeHourlyLaborDemand itself applies to target_productivity (a resolved productivity of
 * 0, null, or undefined all fall back to the same sales-independent operational minimum, so all
 * three are UNCONFIGURED_PRODUCTIVITY here too — this must never drift from laborDemandService's
 * own condition, since a mismatch would silently misclassify which stores' decisions are real).
 */
function resolveEvaluationStatus(guideline) {
  return guideline?.target_productivity ? EVALUATION_STATUS.CONFIGURED : EVALUATION_STATUS.UNCONFIGURED_PRODUCTIVITY;
}

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Splits one daily sales total across operating hours using a normalized hour-of-day shape (Map<hour, fraction>) — the same "daily total x hour fraction" model generateHourlyForecast already uses, applied here to whichever daily total (actual or forecast) the caller supplies. */
function distributeHourlySales(dailyTotal, hourShape, hours = operatingHourList()) {
  return hours.map((hour) => ({ hour, sales: Math.round(dailyTotal * (hourShape.get(hour) ?? 0)) }));
}

/**
 * Applies the mandatory-closing floor to computeHourlyLaborDemand's own output: only the LAST
 * operating hour (whose end is store closing) is floored at CLOSING_COVERAGE_STAFF_COUNT, since
 * that's the one hour production's guaranteeCoverage() unconditionally guarantees regardless of
 * demand — every other hour's effective requirement is exactly computeHourlyLaborDemand's own
 * maxJustifiedHeadcount (which already includes the operational-minimum floor).
 */
function applyMandatoryCoverageFloor(laborDemandByHour) {
  const closingHour = OPERATING_HOURS.end - 1;
  return laborDemandByHour.map((h) => {
    const isMandatoryCoverageHour = h.hour === closingHour;
    const effectiveRequiredHeadcount = isMandatoryCoverageHour ? Math.max(h.maxJustifiedHeadcount, CLOSING_COVERAGE_STAFF_COUNT) : h.maxJustifiedHeadcount;
    return { ...h, effectiveRequiredHeadcount, isMandatoryCoverageHour };
  });
}

/** hourlySales: [{hour, sales}] (from distributeHourlySales) -> per-hour required headcount, via the real production sizing rule plus the mandatory-closing floor above. */
function computeRequiredHeadcountByHour({ hourlySales, guideline }) {
  const hourlyForecast = hourlySales.map((h) => ({ hour: h.hour, forecastedSales: h.sales }));
  const laborDemand = computeHourlyLaborDemand({ hourlyForecast, guideline });
  return applyMandatoryCoverageFloor(laborDemand);
}

/** INCREASE if current > previous, DECREASE if current < previous, KEEP if equal, or null when there's no previous hour to compare against (the opening hour) or either value is missing. */
function classifyDecision(current, previous) {
  if (current == null || previous == null) return null;
  if (current > previous) return 'INCREASE';
  if (current < previous) return 'DECREASE';
  return 'KEEP';
}

/**
 * Combines one date's actual- and forecast-derived hourly headcount series (same hour ordering,
 * both from computeRequiredHeadcountByHour) into per-hour evaluation records: the hour-to-hour
 * decision label from each source, plus same-hour headcount comparison fields for the business
 * metrics (headcount_error, understaffed, overstaffed).
 */
function buildDailyDecisionRecords({ storeId, date, actualHeadcountByHour, forecastHeadcountByHour }) {
  const records = [];
  for (let i = 0; i < actualHeadcountByHour.length; i++) {
    const actualRow = actualHeadcountByHour[i];
    const forecastRow = forecastHeadcountByHour[i];
    const prevActual = i > 0 ? actualHeadcountByHour[i - 1].effectiveRequiredHeadcount : null;
    const prevForecast = i > 0 ? forecastHeadcountByHour[i - 1].effectiveRequiredHeadcount : null;
    const actualRequired = actualRow.effectiveRequiredHeadcount;
    const forecastRequired = forecastRow.effectiveRequiredHeadcount;

    records.push({
      store_id: storeId,
      date,
      hour: actualRow.hour,
      actual_sales: actualRow.forecastedSales, // computeHourlyLaborDemand's own field name, reused generically for whichever sales value fed it
      forecast_sales: forecastRow.forecastedSales,
      actual_required_headcount: actualRequired,
      forecast_required_headcount: forecastRequired,
      actual_decision: classifyDecision(actualRequired, prevActual),
      predicted_decision: classifyDecision(forecastRequired, prevForecast),
      headcount_error: forecastRequired - actualRequired,
      understaffed: actualRequired > forecastRequired,
      overstaffed: forecastRequired > actualRequired,
      is_mandatory_coverage_hour: actualRow.isMandatoryCoverageHour,
    });
  }
  return records;
}

/**
 * The rolling-origin manpower-decision evaluation for one store: for every real reported date in
 * [fromDate, toDate], both the actual- and forecast-required headcount series are built using
 * ONLY that store's real daily sales history strictly BEFORE that date (sortedDailyHistory must
 * already exclude null gross_actual — same rule computeDailyForecast itself applies). No DB
 * access happens in this function — storeId's sales history and hour shape are supplied by the
 * caller, exactly like the existing forecast-accuracy.js pattern.
 */
function evaluateStoreManpowerDecisions({ storeId, sortedDailyHistory, hourShape, guideline, fromDate, toDate }) {
  const evaluationStatus = resolveEvaluationStatus(guideline);
  const records = [];
  for (const point of sortedDailyHistory) {
    if (point.report_date < fromDate || point.report_date > toDate) continue;

    const historyBefore = sortedDailyHistory.filter((h) => h.report_date < point.report_date); // no look-ahead, ever
    const forecastDaily = computeDailyForecast(historyBefore, point.report_date); // the real production function
    if (forecastDaily.source === 'NO_HISTORY') continue;

    const actualHourlySales = distributeHourlySales(point.gross_actual, hourShape);
    const forecastHourlySales = distributeHourlySales(forecastDaily.value, hourShape);

    const actualHeadcountByHour = computeRequiredHeadcountByHour({ hourlySales: actualHourlySales, guideline });
    const forecastHeadcountByHour = computeRequiredHeadcountByHour({ hourlySales: forecastHourlySales, guideline });

    records.push(...buildDailyDecisionRecords({ storeId, date: point.report_date, actualHeadcountByHour, forecastHeadcountByHour }));
  }
  return records.map((r) => ({ ...r, evaluation_status: evaluationStatus }));
}

// --- Classification metrics ---------------------------------------------------------------------
// Standard multi-class Precision/Recall/F1 — computed only over records where BOTH actual_decision
// and predicted_decision are non-null (both sides had a preceding hour to compare against).

function computeConfusionMatrix(records, classes = DECISION_CLASSES) {
  const matrix = {};
  for (const a of classes) {
    matrix[a] = {};
    for (const p of classes) matrix[a][p] = 0;
  }
  for (const r of records) {
    if (r.actual_decision == null || r.predicted_decision == null) continue;
    matrix[r.actual_decision][r.predicted_decision] += 1;
  }
  return matrix;
}

/** Per-class Precision (of everything PREDICTED this class, how much was really this class), Recall (of everything ACTUALLY this class, how much was caught), F1 (harmonic mean of the two), and Support (how many real occurrences of this class existed). All three metrics resolve to 0 — never NaN/Infinity — for a class with zero predictions or zero actual occurrences. */
function computeClassMetrics(matrix, classes = DECISION_CLASSES) {
  const result = {};
  for (const actualClass of classes) {
    let truePositive = matrix[actualClass][actualClass];
    let falseNegative = 0;
    let support = 0;
    for (const predicted of classes) {
      support += matrix[actualClass][predicted];
      if (predicted !== actualClass) falseNegative += matrix[actualClass][predicted];
    }
    let falsePositive = 0;
    for (const otherActual of classes) {
      if (otherActual !== actualClass) falsePositive += matrix[otherActual][actualClass];
    }
    const precision = truePositive + falsePositive > 0 ? truePositive / (truePositive + falsePositive) : 0;
    const recall = truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    result[actualClass] = { precision, recall, f1, support };
  }
  return result;
}

/** Overall accuracy = correct predictions / total evaluable predictions (0 when there are none, never NaN). */
function computeAccuracy(matrix, classes = DECISION_CLASSES) {
  let correct = 0;
  let total = 0;
  for (const a of classes) {
    for (const p of classes) {
      total += matrix[a][p];
      if (a === p) correct += matrix[a][p];
    }
  }
  return total > 0 ? correct / total : 0;
}

/** Macro-averaged Precision/Recall/F1 -- an unweighted mean across all 3 classes (every class counts equally regardless of how common it is), so a class the system rarely predicts correctly can't hide behind a dominant KEEP class the way overall Accuracy alone would. Classes with zero support still count in the average (as 0), matching the standard macro-averaging convention -- silently excluding an unseen class would hide, not reveal, a systematic gap. */
function computeMacroMetrics(classMetrics, classes = DECISION_CLASSES) {
  return {
    precision: average(classes.map((c) => classMetrics[c].precision)),
    recall: average(classes.map((c) => classMetrics[c].recall)),
    f1: average(classes.map((c) => classMetrics[c].f1)),
  };
}

// --- Business metrics ------------------------------------------------------------------------
// Same-hour comparisons (forecast_required_headcount vs actual_required_headcount at that exact
// hour) -- a different axis from the hour-to-hour decision labels above, answering "how far off,
// and in which direction, was the sizing itself" rather than "was the trend called correctly".

function computeBusinessMetrics(records) {
  const n = records.length;
  const understaffingHours = records.filter((r) => r.understaffed).length;
  const overstaffingHours = records.filter((r) => r.overstaffed).length;
  return {
    understaffingHours,
    overstaffingHours,
    understaffingRate: n > 0 ? (understaffingHours / n) * 100 : 0,
    overstaffingRate: n > 0 ? (overstaffingHours / n) * 100 : 0,
    meanHeadcountError: average(records.map((r) => Math.abs(r.headcount_error))),
    signedHeadcountBias: average(records.map((r) => r.headcount_error)), // positive = tendency to overstaff, negative = tendency to understaff
  };
}

// --- Coverage and primary-KPI population ---------------------------------------------------
// See the "PRIMARY KPI POPULATION" note in the module doc comment above for why this split
// exists: a store with no resolvable target_productivity produces a constant, trivially
// "correct" headcount series that must never be allowed to dilute the primary KPI.

/**
 * storeStatuses: [{ storeId, evaluationStatus }] — one entry per store the caller considers
 * "active" (i.e. had any real sales history to evaluate), regardless of whether that store ended
 * up contributing any classified hours. Reports the labor_guideline configuration gap itself,
 * independent of how much data each store happened to produce.
 */
function computeCoverageSummary(storeStatuses) {
  const totalActiveStores = storeStatuses.length;
  const configuredStores = storeStatuses.filter((s) => s.evaluationStatus === EVALUATION_STATUS.CONFIGURED).length;
  const storesWithoutProductivity = totalActiveStores - configuredStores;
  return {
    totalActiveStores,
    configuredStores,
    storesWithoutProductivity,
    laborGuidelineCoverage: totalActiveStores > 0 ? (configuredStores / totalActiveStores) * 100 : 0,
  };
}

/**
 * The single source of truth for the PRIMARY manpower-decision KPI: filters to
 * evaluation_status === CONFIGURED first, then computes every classification and business metric
 * only over that population. Records from UNCONFIGURED_PRODUCTIVITY stores never reach the
 * confusion matrix, class metrics, macro metrics, or business metrics — their constant,
 * demand-independent headcount series must never be scored as a successful prediction.
 */
function computePrimaryKpi(records) {
  const primaryRecords = records.filter((r) => r.evaluation_status === EVALUATION_STATUS.CONFIGURED);
  const classifiedRecords = primaryRecords.filter((r) => r.actual_decision != null && r.predicted_decision != null);
  const matrix = computeConfusionMatrix(primaryRecords);
  const classMetrics = computeClassMetrics(matrix);
  return {
    evaluatedStores: new Set(classifiedRecords.map((r) => r.store_id)).size,
    evaluatedHours: classifiedRecords.length,
    matrix,
    classMetrics,
    accuracy: computeAccuracy(matrix),
    macro: computeMacroMetrics(classMetrics),
    business: computeBusinessMetrics(primaryRecords),
  };
}

module.exports = {
  DECISION_CLASSES,
  EVALUATION_STATUS,
  DECISION_DEFINITION_TEXT,
  DECISION_DEFINITION_DISCLAIMER,
  EVALUATION_METADATA,
  resolveEvaluationStatus,
  distributeHourlySales,
  applyMandatoryCoverageFloor,
  computeRequiredHeadcountByHour,
  classifyDecision,
  buildDailyDecisionRecords,
  evaluateStoreManpowerDecisions,
  computeConfusionMatrix,
  computeClassMetrics,
  computeAccuracy,
  computeMacroMetrics,
  computeBusinessMetrics,
  computeCoverageSummary,
  computePrimaryKpi,
};
