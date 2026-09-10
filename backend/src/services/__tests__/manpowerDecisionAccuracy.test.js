// manpowerDecisionAccuracy.js imports forecastService.js (for the real computeDailyForecast),
// which requires config/supabase directly at module load — must be mocked even though these
// tests never exercise it, same pattern as forecastService's own tests.
jest.mock('../../config/supabase', () => ({}));

const {
  distributeHourlySales,
  computeRequiredHeadcountByHour,
  classifyDecision,
  buildDailyDecisionRecords,
  evaluateStoreManpowerDecisions,
  computeConfusionMatrix,
  computeClassMetrics,
  computeAccuracy,
  computeMacroMetrics,
  computeBusinessMetrics,
  EVALUATION_STATUS,
  resolveEvaluationStatus,
  computeCoverageSummary,
  computePrimaryKpi,
  DECISION_DEFINITION_TEXT,
  DECISION_DEFINITION_DISCLAIMER,
  EVALUATION_METADATA,
} = require('../manpowerDecisionAccuracy');
const { OPERATING_HOURS, CLOSING_COVERAGE_STAFF_COUNT } = require('../storeOperatingHours');

/** Minimal hand-built "computeRequiredHeadcountByHour row" for tests that only need to exercise buildDailyDecisionRecords / the classification and business metrics, without going through real sales->headcount math each time. */
function hc(hour, effectiveRequiredHeadcount, { sales = 0, mandatory = false } = {}) {
  return { hour, effectiveRequiredHeadcount, forecastedSales: sales, isMandatoryCoverageHour: mandatory };
}

describe('manpowerDecisionAccuracy.classifyDecision', () => {
  // 1. exact KEEP
  test('1. equal current and previous -> KEEP', () => {
    expect(classifyDecision(4, 4)).toBe('KEEP');
  });

  test('higher current than previous -> INCREASE', () => {
    expect(classifyDecision(5, 4)).toBe('INCREASE');
  });

  test('lower current than previous -> DECREASE', () => {
    expect(classifyDecision(3, 4)).toBe('DECREASE');
  });

  test('no previous hour (opening hour) -> null, not a guess', () => {
    expect(classifyDecision(4, null)).toBeNull();
  });
});

describe('manpowerDecisionAccuracy — decision definition per spec (previous-operating-hour headcount delta, no thresholds)', () => {
  // 1. previous 2 -> current 3 = INCREASE
  test('1. previous headcount 2, current 3 -> INCREASE', () => {
    expect(classifyDecision(3, 2)).toBe('INCREASE');
  });

  // 2. previous 3 -> current 3 = KEEP
  test('2. previous headcount 3, current 3 -> KEEP', () => {
    expect(classifyDecision(3, 3)).toBe('KEEP');
  });

  // 3. previous 3 -> current 2 = DECREASE
  test('3. previous headcount 3, current 2 -> DECREASE', () => {
    expect(classifyDecision(2, 3)).toBe('DECREASE');
  });

  // 4. opening hour = unclassified (no predecessor)
  test('4. opening hour has no predecessor and is UNCLASSIFIED (null)', () => {
    expect(classifyDecision(5, null)).toBeNull();
    expect(classifyDecision(null, null)).toBeNull();
  });

  // 12. no arbitrary percentage threshold
  test('12. a change is classified from the raw delta alone, never a percentage tolerance -- a 1% change still classifies', () => {
    // previous=100, current=101 is a 1% change; a %-threshold convention (e.g. +/-10%) would call
    // this KEEP, but the spec forbids percentage thresholds entirely -- any positive delta is INCREASE.
    expect(classifyDecision(101, 100)).toBe('INCREASE');
    // Symmetrically, a huge relative jump with a delta of exactly 0 must still be KEEP.
    expect(classifyDecision(1, 1)).toBe('KEEP');
  });

  // 13. a one-person headcount change is itself a valid, classifiable decision change
  test('13. a one-person headcount change (delta of exactly 1) is a valid, non-degenerate decision change', () => {
    expect(classifyDecision(6, 5)).toBe('INCREASE');
    expect(classifyDecision(5, 6)).toBe('DECREASE');
  });
});

describe('manpowerDecisionAccuracy.buildDailyDecisionRecords — decision correctness', () => {
  // 2. true INCREASE: both actual and forecast agree the hour should increase
  test('2. true INCREASE — actual and forecast both rise 4 -> 5', () => {
    const actual = [hc(9, 4), hc(10, 5)];
    const forecast = [hc(9, 4), hc(10, 5)];
    const records = buildDailyDecisionRecords({ storeId: 's1', date: '2026-06-01', actualHeadcountByHour: actual, forecastHeadcountByHour: forecast });
    expect(records[1].actual_decision).toBe('INCREASE');
    expect(records[1].predicted_decision).toBe('INCREASE');
  });

  // 3. true DECREASE
  test('3. true DECREASE — actual and forecast both fall 5 -> 4', () => {
    const actual = [hc(9, 5), hc(10, 4)];
    const forecast = [hc(9, 5), hc(10, 4)];
    const records = buildDailyDecisionRecords({ storeId: 's1', date: '2026-06-01', actualHeadcountByHour: actual, forecastHeadcountByHour: forecast });
    expect(records[1].actual_decision).toBe('DECREASE');
    expect(records[1].predicted_decision).toBe('DECREASE');
  });

  // 4. false INCREASE: forecast wrongly predicts a rise that didn't really happen
  test('4. false INCREASE — actual stays flat (KEEP), forecast predicts a rise', () => {
    const actual = [hc(9, 4), hc(10, 4)];
    const forecast = [hc(9, 4), hc(10, 5)];
    const records = buildDailyDecisionRecords({ storeId: 's1', date: '2026-06-01', actualHeadcountByHour: actual, forecastHeadcountByHour: forecast });
    expect(records[1].actual_decision).toBe('KEEP');
    expect(records[1].predicted_decision).toBe('INCREASE');
  });

  // 5. false DECREASE: forecast wrongly predicts a drop that didn't really happen
  test('5. false DECREASE — actual stays flat (KEEP), forecast predicts a drop', () => {
    const actual = [hc(9, 4), hc(10, 4)];
    const forecast = [hc(9, 4), hc(10, 3)];
    const records = buildDailyDecisionRecords({ storeId: 's1', date: '2026-06-01', actualHeadcountByHour: actual, forecastHeadcountByHour: forecast });
    expect(records[1].actual_decision).toBe('KEEP');
    expect(records[1].predicted_decision).toBe('DECREASE');
  });

  // 16. understaffing: the true requirement exceeded what the forecast would have sized for
  test('16. understaffed = true when actual_required > forecast_required at the same hour', () => {
    const actual = [hc(9, 6)];
    const forecast = [hc(9, 4)];
    const [record] = buildDailyDecisionRecords({ storeId: 's1', date: '2026-06-01', actualHeadcountByHour: actual, forecastHeadcountByHour: forecast });
    expect(record.understaffed).toBe(true);
    expect(record.overstaffed).toBe(false);
    expect(record.headcount_error).toBe(-2); // forecast(4) - actual(6)
  });

  // 17. overstaffing: the forecast would have sized for more than truly needed
  test('17. overstaffed = true when forecast_required > actual_required at the same hour', () => {
    const actual = [hc(9, 3)];
    const forecast = [hc(9, 6)];
    const [record] = buildDailyDecisionRecords({ storeId: 's1', date: '2026-06-01', actualHeadcountByHour: actual, forecastHeadcountByHour: forecast });
    expect(record.overstaffed).toBe(true);
    expect(record.understaffed).toBe(false);
    expect(record.headcount_error).toBe(3); // forecast(6) - actual(3)
  });
});

describe('manpowerDecisionAccuracy — classification metrics', () => {
  // 6. confusion matrix
  test('6. confusion matrix counts each (actual, predicted) pair correctly', () => {
    const records = [
      { actual_decision: 'KEEP', predicted_decision: 'KEEP' },
      { actual_decision: 'KEEP', predicted_decision: 'KEEP' },
      { actual_decision: 'KEEP', predicted_decision: 'INCREASE' }, // false INCREASE
      { actual_decision: 'INCREASE', predicted_decision: 'INCREASE' }, // true INCREASE
      { actual_decision: 'DECREASE', predicted_decision: 'DECREASE' }, // true DECREASE
    ];
    const matrix = computeConfusionMatrix(records);
    expect(matrix.KEEP.KEEP).toBe(2);
    expect(matrix.KEEP.INCREASE).toBe(1);
    expect(matrix.KEEP.DECREASE).toBe(0);
    expect(matrix.INCREASE.INCREASE).toBe(1);
    expect(matrix.DECREASE.DECREASE).toBe(1);
  });

  test('confusion matrix ignores records where either side has no decision (no preceding hour)', () => {
    const records = [
      { actual_decision: 'KEEP', predicted_decision: null },
      { actual_decision: null, predicted_decision: 'KEEP' },
      { actual_decision: 'KEEP', predicted_decision: 'KEEP' },
    ];
    const matrix = computeConfusionMatrix(records);
    expect(matrix.KEEP.KEEP).toBe(1); // only the one fully-evaluable record counts
  });

  // 7, 8, 9. precision / recall / F1 for a specific class, hand-computed from a known matrix
  test('7 & 8 & 9. precision, recall, and F1 for INCREASE, hand-computed', () => {
    // 2 real INCREASE occurrences: 1 caught correctly, 1 missed (predicted KEEP).
    // 1 false-positive INCREASE (actual was really KEEP).
    const records = [
      { actual_decision: 'INCREASE', predicted_decision: 'INCREASE' }, // TP
      { actual_decision: 'INCREASE', predicted_decision: 'KEEP' }, // FN
      { actual_decision: 'KEEP', predicted_decision: 'INCREASE' }, // FP
      { actual_decision: 'KEEP', predicted_decision: 'KEEP' },
      { actual_decision: 'DECREASE', predicted_decision: 'DECREASE' },
    ];
    const matrix = computeConfusionMatrix(records);
    const metrics = computeClassMetrics(matrix);
    // Precision = TP / (TP + FP) = 1 / (1 + 1) = 0.5
    expect(metrics.INCREASE.precision).toBeCloseTo(0.5, 6);
    // Recall = TP / (TP + FN) = 1 / (1 + 1) = 0.5
    expect(metrics.INCREASE.recall).toBeCloseTo(0.5, 6);
    // F1 = 2 * P * R / (P + R) = 2*0.5*0.5/1.0 = 0.5
    expect(metrics.INCREASE.f1).toBeCloseTo(0.5, 6);
    expect(metrics.INCREASE.support).toBe(2); // 2 real INCREASE occurrences
  });

  // 10. macro F1
  test('10. macro F1 is the unweighted average of the 3 per-class F1 scores', () => {
    const records = [
      { actual_decision: 'INCREASE', predicted_decision: 'INCREASE' },
      { actual_decision: 'KEEP', predicted_decision: 'KEEP' },
      { actual_decision: 'KEEP', predicted_decision: 'KEEP' },
      { actual_decision: 'DECREASE', predicted_decision: 'INCREASE' }, // DECREASE missed entirely
    ];
    const matrix = computeConfusionMatrix(records);
    const classMetrics = computeClassMetrics(matrix);
    const macro = computeMacroMetrics(classMetrics);
    const expectedMacroF1 = (classMetrics.INCREASE.f1 + classMetrics.KEEP.f1 + classMetrics.DECREASE.f1) / 3;
    expect(macro.f1).toBeCloseTo(expectedMacroF1, 10);
    // DECREASE has real occurrences but was never predicted correctly -> its F1 is 0, which macro F1
    // must reflect (this is exactly why macro F1, not accuracy alone, must always be reported).
    expect(classMetrics.DECREASE.f1).toBe(0);
    expect(macro.f1).toBeLessThan(1);
  });

  test('accuracy is computed correctly and stays within [0,1]', () => {
    const records = [
      { actual_decision: 'KEEP', predicted_decision: 'KEEP' },
      { actual_decision: 'KEEP', predicted_decision: 'KEEP' },
      { actual_decision: 'INCREASE', predicted_decision: 'KEEP' },
      { actual_decision: 'DECREASE', predicted_decision: 'DECREASE' },
    ];
    const matrix = computeConfusionMatrix(records);
    expect(computeAccuracy(matrix)).toBeCloseTo(3 / 4, 6);
  });

  // 11. zero division / missing class
  test('11. a class with zero support or zero predictions resolves to 0, never NaN or Infinity, and macro metrics stay finite', () => {
    // DECREASE never occurs as actual OR predicted anywhere in this data.
    const records = [
      { actual_decision: 'INCREASE', predicted_decision: 'INCREASE' },
      { actual_decision: 'KEEP', predicted_decision: 'KEEP' },
    ];
    const matrix = computeConfusionMatrix(records);
    const classMetrics = computeClassMetrics(matrix);
    expect(classMetrics.DECREASE.support).toBe(0);
    expect(classMetrics.DECREASE.precision).toBe(0);
    expect(classMetrics.DECREASE.recall).toBe(0);
    expect(classMetrics.DECREASE.f1).toBe(0);
    expect(Number.isFinite(classMetrics.DECREASE.precision)).toBe(true);
    const macro = computeMacroMetrics(classMetrics);
    expect(Number.isFinite(macro.f1)).toBe(true);
    expect(macro.f1).toBeCloseTo((1 + 1 + 0) / 3, 6); // INCREASE and KEEP both perfect, DECREASE counts as 0
  });

  test('computeAccuracy on zero evaluable records returns 0, not NaN', () => {
    expect(computeAccuracy(computeConfusionMatrix([]))).toBe(0);
  });
});

describe('manpowerDecisionAccuracy — operational minimum and mandatory closing (real computeRequiredHeadcountByHour)', () => {
  // 12. minimum staffing
  test('12. a non-closing hour with near-zero sales still floors at min_staff_per_shift, not 0', () => {
    const guideline = { target_productivity: 500, min_staff_per_shift: 2 };
    const hourlySales = [{ hour: 12, sales: 10 }]; // 10/500 -> floor(0.02) -> 0 heads from productivity alone
    const [row] = computeRequiredHeadcountByHour({ hourlySales, guideline }).filter((h) => h.hour === 12);
    expect(row.effectiveRequiredHeadcount).toBe(2); // floored at the operational minimum, not 0
    expect(row.isMandatoryCoverageHour).toBe(false);
  });

  // 13. mandatory closing
  test('13. the closing hour floors at CLOSING_COVERAGE_STAFF_COUNT even when demand alone would justify fewer', () => {
    const guideline = { target_productivity: 500, min_staff_per_shift: 1 };
    const closingHour = OPERATING_HOURS.end - 1;
    const hourlySales = [{ hour: closingHour, sales: 10 }]; // demand alone -> operational minimum of 1
    const [row] = computeRequiredHeadcountByHour({ hourlySales, guideline }).filter((h) => h.hour === closingHour);
    expect(row.isMandatoryCoverageHour).toBe(true);
    expect(row.effectiveRequiredHeadcount).toBe(CLOSING_COVERAGE_STAFF_COUNT); // 2, not the demand-only value of 1
  });

  test('13b. a non-closing hour is never floored by the mandatory-closing rule, even with identical low sales', () => {
    const guideline = { target_productivity: 500, min_staff_per_shift: 1 };
    const nonClosingHour = OPERATING_HOURS.end - 2; // one hour before closing
    const hourlySales = [{ hour: nonClosingHour, sales: 10 }];
    const [row] = computeRequiredHeadcountByHour({ hourlySales, guideline }).filter((h) => h.hour === nonClosingHour);
    expect(row.isMandatoryCoverageHour).toBe(false);
    expect(row.effectiveRequiredHeadcount).toBe(1); // operational minimum only, NOT bumped to 2
  });

  test('demand above the closing floor is not clipped down to it — closing can exceed the minimum when sales justify it', () => {
    const guideline = { target_productivity: 100, min_staff_per_shift: 1 };
    const closingHour = OPERATING_HOURS.end - 1;
    const hourlySales = [{ hour: closingHour, sales: 1000 }]; // 1000/100 = 10 heads justified by demand
    const [row] = computeRequiredHeadcountByHour({ hourlySales, guideline }).filter((h) => h.hour === closingHour);
    expect(row.effectiveRequiredHeadcount).toBe(10); // demand (10) exceeds the floor (2) -> demand wins
  });

  // 5. closing floor applies identically to actual and forecast -- never a spurious over/understaffing signal
  test('5. the mandatory closing floor is applied identically on the actual side and the forecast side', () => {
    const guideline = { target_productivity: 1000, min_staff_per_shift: 1 }; // demand alone -> 1 head at the closing hour
    const closingHour = OPERATING_HOURS.end - 1;
    // Actual and forecast sales differ at the closing hour, but both are far too low to clear the
    // productivity floor on their own -- both sides must independently land on the SAME floored value.
    const actual = computeRequiredHeadcountByHour({ hourlySales: [{ hour: closingHour, sales: 50 }], guideline });
    const forecast = computeRequiredHeadcountByHour({ hourlySales: [{ hour: closingHour, sales: 900 }], guideline });
    const actualRow = actual.find((h) => h.hour === closingHour);
    const forecastRow = forecast.find((h) => h.hour === closingHour);
    expect(actualRow.effectiveRequiredHeadcount).toBe(CLOSING_COVERAGE_STAFF_COUNT);
    expect(forecastRow.effectiveRequiredHeadcount).toBe(CLOSING_COVERAGE_STAFF_COUNT);
    // Same-hour comparison at the closing hour must therefore never register as under/overstaffed.
    expect(actualRow.effectiveRequiredHeadcount).toBe(forecastRow.effectiveRequiredHeadcount);
  });

  // 11. actual and forecast series are sized by the exact same production rule (computeHourlyLaborDemand),
  // never two divergent formulas -- proven by feeding IDENTICAL sales through both paths and requiring
  // an identical result.
  test('11. actual-derived and forecast-derived headcount use the same manpower-sizing rule -- identical sales in, identical headcount out', () => {
    const guideline = { target_productivity: 250, min_staff_per_shift: 2 };
    const sales = [{ hour: 9, sales: 1234 }, { hour: 10, sales: 2500 }, { hour: OPERATING_HOURS.end - 1, sales: 10 }];
    const asActual = computeRequiredHeadcountByHour({ hourlySales: sales, guideline });
    const asForecast = computeRequiredHeadcountByHour({ hourlySales: sales, guideline });
    expect(asActual).toEqual(asForecast);
  });
});

describe('manpowerDecisionAccuracy.evaluateStoreManpowerDecisions — rolling-origin integrity (real computeDailyForecast)', () => {
  function flatHourShape() {
    // Uniform shape across the 13 operating hours -- keeps the sales->hour math simple and predictable for these tests.
    const hours = Array.from({ length: OPERATING_HOURS.end - OPERATING_HOURS.start }, (_, i) => OPERATING_HOURS.start + i);
    return new Map(hours.map((h) => [h, 1 / hours.length]));
  }
  function weeklyRows(weekday, amounts, startDate) {
    // amounts in chronological order, 7 days apart, starting at startDate (which must land on `weekday`).
    const rows = [];
    let cursor = new Date(`${startDate}T00:00:00Z`);
    if (cursor.getUTCDay() !== weekday) throw new Error('fixture date/weekday mismatch');
    for (const amount of amounts) {
      rows.push({ store_id: 's1', report_date: cursor.toISOString().slice(0, 10), gross_actual: amount });
      cursor = new Date(cursor.getTime() + 7 * 86400000);
    }
    return rows;
  }
  const guideline = { target_productivity: 500, min_staff_per_shift: 1 };

  // 14. rolling-origin integrity
  test('14. each test date is forecast using only its own progressively-growing prior history, not one fixed snapshot', () => {
    // 4 Mondays: 2026-06-01, 06-08, 06-15, 06-22. Evaluating 06-15 and 06-22 -- 06-15 must be
    // forecast from only [06-01, 06-08] (2 samples), 06-22 from [06-01, 06-08, 06-15] (3 samples).
    const history = weeklyRows(1, [10000, 10000, 20000, 20000], '2026-06-01');
    const records = evaluateStoreManpowerDecisions({ storeId: 's1', sortedDailyHistory: history, hourShape: flatHourShape(), guideline, fromDate: '2026-06-15', toDate: '2026-06-22' });

    const juneDates = [...new Set(records.map((r) => r.date))];
    expect(juneDates).toEqual(['2026-06-15', '2026-06-22']); // both dates evaluated
    // 06-15's forecast (from only the two 10,000 Mondays) must differ from 06-22's forecast (which
    // now also has 06-15's real 20,000 actual in its history) -- proving the history genuinely grew.
    const forecast0615 = records.find((r) => r.date === '2026-06-15').forecast_sales;
    const forecast0622 = records.find((r) => r.date === '2026-06-22').forecast_sales;
    expect(forecast0622).toBeGreaterThan(forecast0615);
  });

  // 15. no future actual leakage
  test('15. an evaluation result for an earlier date is identical whether or not a LATER actual exists in history', () => {
    const historyWithFuture = weeklyRows(1, [10000, 10000, 10000, 99999], '2026-06-01'); // 06-22 is an extreme future value
    const historyWithoutFuture = historyWithFuture.slice(0, 3); // same data, minus the future 06-22 row

    const withFuture = evaluateStoreManpowerDecisions({ storeId: 's1', sortedDailyHistory: historyWithFuture, hourShape: flatHourShape(), guideline, fromDate: '2026-06-15', toDate: '2026-06-15' });
    const withoutFuture = evaluateStoreManpowerDecisions({ storeId: 's1', sortedDailyHistory: historyWithoutFuture, hourShape: flatHourShape(), guideline, fromDate: '2026-06-15', toDate: '2026-06-15' });

    expect(withFuture).toEqual(withoutFuture); // the extreme future value must have zero effect on this earlier date's result
  });
});

describe('manpowerDecisionAccuracy.computeBusinessMetrics', () => {
  // 18. headcount bias
  test('18. signed headcount bias averages the signed (forecast - actual) error, positive = overstaff tendency', () => {
    const records = [
      { headcount_error: 2, understaffed: false, overstaffed: true }, // overstaffed by 2
      { headcount_error: 2, understaffed: false, overstaffed: true }, // overstaffed by 2
      { headcount_error: -1, understaffed: true, overstaffed: false }, // understaffed by 1
    ];
    const business = computeBusinessMetrics(records);
    expect(business.signedHeadcountBias).toBeCloseTo((2 + 2 - 1) / 3, 6); // = +1 -> net tendency to overstaff
    expect(business.signedHeadcountBias).toBeGreaterThan(0);
    expect(business.meanHeadcountError).toBeCloseTo((2 + 2 + 1) / 3, 6); // magnitude only, always >= 0
    expect(business.understaffingHours).toBe(1);
    expect(business.overstaffingHours).toBe(2);
    expect(business.understaffingRate).toBeCloseTo((1 / 3) * 100, 6);
    expect(business.overstaffingRate).toBeCloseTo((2 / 3) * 100, 6);
  });

  test('a net-negative bias correctly signals a tendency to understaff', () => {
    const records = [
      { headcount_error: -3, understaffed: true, overstaffed: false },
      { headcount_error: -1, understaffed: true, overstaffed: false },
      { headcount_error: 1, understaffed: false, overstaffed: true },
    ];
    const business = computeBusinessMetrics(records);
    expect(business.signedHeadcountBias).toBeLessThan(0);
  });

  test('computeBusinessMetrics on zero records returns 0s, not NaN', () => {
    const business = computeBusinessMetrics([]);
    expect(business.understaffingRate).toBe(0);
    expect(business.overstaffingRate).toBe(0);
    expect(business.meanHeadcountError).toBe(0);
    expect(business.signedHeadcountBias).toBe(0);
  });
});

describe('manpowerDecisionAccuracy — primary KPI population (unconfigured-productivity stores excluded)', () => {
  test('resolveEvaluationStatus: a store with a resolved target_productivity is CONFIGURED', () => {
    expect(resolveEvaluationStatus({ target_productivity: 500, min_staff_per_shift: 1 })).toBe(EVALUATION_STATUS.CONFIGURED);
  });

  test('resolveEvaluationStatus: no guideline at all, or a null/0 target_productivity, is UNCONFIGURED_PRODUCTIVITY (matches computeHourlyLaborDemand\'s own truthy check)', () => {
    expect(resolveEvaluationStatus(null)).toBe(EVALUATION_STATUS.UNCONFIGURED_PRODUCTIVITY);
    expect(resolveEvaluationStatus({ target_productivity: null, min_staff_per_shift: 1 })).toBe(EVALUATION_STATUS.UNCONFIGURED_PRODUCTIVITY);
    expect(resolveEvaluationStatus({ target_productivity: 0, min_staff_per_shift: 1 })).toBe(EVALUATION_STATUS.UNCONFIGURED_PRODUCTIVITY);
  });

  // 6. missing target_productivity excludes store from primary KPI
  test('6. evaluateStoreManpowerDecisions tags every record UNCONFIGURED_PRODUCTIVITY when the store has no resolvable target_productivity, and computePrimaryKpi excludes them entirely', () => {
    const guideline = { target_productivity: null, min_staff_per_shift: 1 };
    const history = [
      { store_id: 'unconfigured-1', report_date: '2026-06-01', gross_actual: 5000 },
      { store_id: 'unconfigured-1', report_date: '2026-06-08', gross_actual: 5000 },
    ];
    const shape = new Map([[9, 1]]);
    const records = evaluateStoreManpowerDecisions({ storeId: 'unconfigured-1', sortedDailyHistory: history, hourShape: shape, guideline, fromDate: '2026-06-08', toDate: '2026-06-08' });
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.evaluation_status === EVALUATION_STATUS.UNCONFIGURED_PRODUCTIVITY)).toBe(true);

    const kpi = computePrimaryKpi(records);
    expect(kpi.evaluatedStores).toBe(0);
    expect(kpi.evaluatedHours).toBe(0);
    expect(Object.values(kpi.matrix.KEEP).every((v) => v === 0)).toBe(true);
    expect(kpi.accuracy).toBe(0);
  });

  // 7. configured store remains included
  test('7. a configured store\'s records are tagged CONFIGURED and fully counted by computePrimaryKpi', () => {
    const guideline = { target_productivity: 500, min_staff_per_shift: 1 };
    const history = [
      { store_id: 'configured-1', report_date: '2026-06-01', gross_actual: 5000 },
      { store_id: 'configured-1', report_date: '2026-06-08', gross_actual: 8000 },
    ];
    const shape = new Map([[9, 0.5], [10, 0.5]]);
    const records = evaluateStoreManpowerDecisions({ storeId: 'configured-1', sortedDailyHistory: history, hourShape: shape, guideline, fromDate: '2026-06-08', toDate: '2026-06-08' });
    expect(records.every((r) => r.evaluation_status === EVALUATION_STATUS.CONFIGURED)).toBe(true);

    const kpi = computePrimaryKpi(records);
    expect(kpi.evaluatedStores).toBe(1);
    expect(kpi.evaluatedHours).toBeGreaterThan(0);
  });

  // 14. configured-store KPI is not diluted by unconfigured stores
  test('14. mixing configured and unconfigured-productivity records leaves the primary KPI identical to configured-only', () => {
    const configuredRecords = [
      { store_id: 'c1', evaluation_status: EVALUATION_STATUS.CONFIGURED, actual_decision: 'INCREASE', predicted_decision: 'INCREASE', headcount_error: 0, understaffed: false, overstaffed: false },
      { store_id: 'c1', evaluation_status: EVALUATION_STATUS.CONFIGURED, actual_decision: 'KEEP', predicted_decision: 'DECREASE', headcount_error: -1, understaffed: true, overstaffed: false },
      { store_id: 'c2', evaluation_status: EVALUATION_STATUS.CONFIGURED, actual_decision: 'DECREASE', predicted_decision: 'DECREASE', headcount_error: 0, understaffed: false, overstaffed: false },
    ];
    // 100 unconfigured "always KEEP, always agrees" records that would inflate accuracy/support if
    // they leaked into the primary population -- computePrimaryKpi must ignore all of them.
    const unconfiguredRecords = Array.from({ length: 100 }, (_, i) => ({
      store_id: `u${i}`,
      evaluation_status: EVALUATION_STATUS.UNCONFIGURED_PRODUCTIVITY,
      actual_decision: 'KEEP',
      predicted_decision: 'KEEP',
      headcount_error: 0,
      understaffed: false,
      overstaffed: false,
    }));

    const configuredOnlyKpi = computePrimaryKpi(configuredRecords);
    const mixedKpi = computePrimaryKpi([...configuredRecords, ...unconfiguredRecords]);

    expect(mixedKpi.evaluatedHours).toBe(configuredOnlyKpi.evaluatedHours);
    expect(mixedKpi.evaluatedStores).toBe(configuredOnlyKpi.evaluatedStores);
    expect(mixedKpi.accuracy).toBeCloseTo(configuredOnlyKpi.accuracy, 10);
    expect(mixedKpi.macro.f1).toBeCloseTo(configuredOnlyKpi.macro.f1, 10);
    expect(mixedKpi.matrix).toEqual(configuredOnlyKpi.matrix);
    expect(mixedKpi.evaluatedHours).toBe(3); // never 103 -- the 100 unconfigured records must not count
  });

  test('computeCoverageSummary reports store-level guideline coverage independent of how many hours each store produced', () => {
    const storeStatuses = [
      { storeId: 'a', evaluationStatus: EVALUATION_STATUS.CONFIGURED },
      { storeId: 'b', evaluationStatus: EVALUATION_STATUS.CONFIGURED },
      { storeId: 'c', evaluationStatus: EVALUATION_STATUS.UNCONFIGURED_PRODUCTIVITY },
      { storeId: 'd', evaluationStatus: EVALUATION_STATUS.UNCONFIGURED_PRODUCTIVITY },
    ];
    const coverage = computeCoverageSummary(storeStatuses);
    expect(coverage.totalActiveStores).toBe(4);
    expect(coverage.configuredStores).toBe(2);
    expect(coverage.storesWithoutProductivity).toBe(2);
    expect(coverage.laborGuidelineCoverage).toBeCloseTo(50, 6);
  });

  test('computeCoverageSummary on zero stores returns 0s, not NaN', () => {
    const coverage = computeCoverageSummary([]);
    expect(coverage.totalActiveStores).toBe(0);
    expect(coverage.laborGuidelineCoverage).toBe(0);
  });

  test('evaluation metadata is exact and reproducible', () => {
    expect(EVALUATION_METADATA).toEqual({
      decisionDefinition: 'PREVIOUS_OPERATING_HOUR_HEADCOUNT_DELTA',
      decisionDefinitionVersion: 1,
      classificationThreshold: 0,
      primaryPopulation: 'CONFIGURED_TARGET_PRODUCTIVITY_STORES',
      hourlyActualMode: 'DAILY_TOTAL_X_STORE_HOUR_SHAPE_PROXY',
      openingHourClassification: 'UNCLASSIFIED',
      closingCoverageFloor: CLOSING_COVERAGE_STAFF_COUNT,
    });
    expect(typeof DECISION_DEFINITION_TEXT).toBe('string');
    expect(typeof DECISION_DEFINITION_DISCLAIMER).toBe('string');
  });
});

describe('manpowerDecisionAccuracy.distributeHourlySales', () => {
  test('splits a daily total across hours using the supplied shape, rounded per hour', () => {
    const shape = new Map([[9, 0.25], [10, 0.75]]);
    const result = distributeHourlySales(1000, shape, [9, 10]);
    expect(result).toEqual([{ hour: 9, sales: 250 }, { hour: 10, sales: 750 }]);
  });

  test('an hour missing from the shape gets 0, not NaN', () => {
    const shape = new Map([[9, 1]]);
    const result = distributeHourlySales(1000, shape, [9, 10]);
    expect(result.find((r) => r.hour === 10).sales).toBe(0);
  });
});
