

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../src/config/supabase');
const forecastRepo = require('../src/repositories/forecastRepository');
const rosterRepo = require('../src/repositories/rosterRepository');
const { computeDailyForecast, computeHourShape } = require('../src/services/forecastService');
const { resolveTargetProductivity } = require('../src/services/laborBudgetService');
const { operatingHourList } = require('../src/services/storeOperatingHours');
const {
  DECISION_CLASSES,
  EVALUATION_STATUS,
  resolveEvaluationStatus,
  evaluateStoreManpowerDecisions,
  computeConfusionMatrix,
  computeClassMetrics,
  computeAccuracy,
  computeMacroMetrics,
  computeBusinessMetrics,
  computeCoverageSummary,
  computePrimaryKpi,
  DECISION_DEFINITION_TEXT,
  DECISION_DEFINITION_DISCLAIMER,
  EVALUATION_METADATA,
} = require('../src/services/manpowerDecisionAccuracy');
const { weekdayOf } = require('../src/utils/dateRange');

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];


async function withRetry(fn, { retries = 4, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastErr;
}


function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const match = /^--([a-zA-Z-]+)(?:=(.*))?$/.exec(raw);
    if (!match) continue;
    args[match[1]] = match[2] === undefined ? true : match[2];
  }
  return args;
}

function monthRangeToDates(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(daysInMonth).padStart(2, '0')}` };
}

function resolveEvaluationWindow(args) {
  if (args.month) {
    if (!/^\d{4}-\d{2}$/.test(args.month)) throw new Error('--month must be in YYYY-MM form, e.g. --month=2026-06');
    return monthRangeToDates(args.month);
  }
  if (!args.from || !args.to) {
    throw new Error('Provide either --month=YYYY-MM, or both --from=YYYY-MM-DD and --to=YYYY-MM-DD.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from) || !/^\d{4}-\d{2}-\d{2}$/.test(args.to)) {
    throw new Error('--from and --to must be in YYYY-MM-DD form.');
  }
  if (args.from > args.to) throw new Error('--from must not be after --to.');
  return { from: args.from, to: args.to };
}


async function loadSalesHistory(storeId) {
  if (storeId) {
    const rows = await forecastRepo.findDailySalesHistory(storeId); // no `before` -> full history
    return rows.map((r) => ({ store_id: storeId, report_date: r.report_date, gross_actual: r.gross_actual }));
  }

  const pageSize = 1000;
  let from = 0;
  const rows = [];

  while (true) {
    const { data, error } = await supabase
      .from('sales_report')
      .select('store_id, report_date, gross_actual')
      .order('report_date', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function loadStoreNames(storeIds) {
  const { data, error } = await supabase.from('store').select('id, name').in('id', storeIds);
  if (error) throw error;
  return new Map((data || []).map((s) => [s.id, s.name]));
}


async function resolveEffectiveGuideline(storeId) {
  const guideline = await withRetry(() => rosterRepo.findGuideline(storeId));
  const manualTargetProductivity = guideline?.target_productivity != null ? Number(guideline.target_productivity) : null;
  const productivity = await withRetry(() => resolveTargetProductivity({ storeId, manualTargetProductivity }));
  return {
    target_productivity: productivity.value,
    min_staff_per_shift: guideline?.min_staff_per_shift != null ? Number(guideline.min_staff_per_shift) : 0,
  };
}


async function resolveHourShape(storeId, chainRows) {
  const operatingHours = operatingHourList();
  let shape = computeHourShape(await withRetry(() => forecastRepo.findHourlySalesHistory(storeId)), operatingHours);
  if (!shape) shape = computeHourShape(chainRows, operatingHours);
  if (!shape) shape = new Map(operatingHours.map((h) => [h, 1 / operatingHours.length]));
  return shape;
}


function evaluateStore(storeId, sortedHistory, fromDate, toDate) {
  const rows = [];
  for (const point of sortedHistory) {
    if (point.report_date < fromDate || point.report_date > toDate) continue;
    if (point.gross_actual === 0) continue;

    const historyBefore = sortedHistory.filter((h) => h.report_date < point.report_date); // no look-ahead, ever
    const result = computeDailyForecast(historyBefore, point.report_date); // THE real production function
    if (result.source === 'NO_HISTORY') continue;

    const actual = point.gross_actual;
    const forecast = result.value;
    const absoluteError = Math.abs(forecast - actual);
    rows.push({
      store_id: storeId,
      forecast_date: point.report_date,
      weekday: WEEKDAY_NAMES[weekdayOf(point.report_date)],
      actual,
      forecast,
      absolute_error: absoluteError,
      ape: (absoluteError / actual) * 100, 
      signed_error_pct: ((forecast - actual) / actual) * 100, 
      forecast_source: result.source, 
      history_sample_count: result.samples,
    });
  }
  return rows;
}


function mape(rows) {
  return average(rows.map((r) => r.ape));
}


function medianApe(rows) {
  return median(rows.map((r) => r.ape));
}


function bias(rows) {
  return average(rows.map((r) => r.signed_error_pct));
}


function wape(rows) {
  const sumAbsError = rows.reduce((s, r) => s + r.absolute_error, 0);
  const sumActual = rows.reduce((s, r) => s + r.actual, 0);
  return sumActual > 0 ? (sumAbsError / sumActual) * 100 : 0;
}


function pctOver20(rows) {
  return rows.length ? (rows.filter((r) => r.ape > 20).length / rows.length) * 100 : 0;
}


function pctOver50(rows) {
  return rows.length ? (rows.filter((r) => r.ape > 50).length / rows.length) * 100 : 0;
}

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function summarize(rows) {
  return {
    n: rows.length,
    mape: mape(rows),
    medianApe: medianApe(rows),
    wape: wape(rows),
    bias: bias(rows),
    over20: pctOver20(rows),
    over50: pctOver50(rows),
    negativeForecasts: rows.filter((r) => r.forecast < 0).length,
  };
}


function pct(n) {
  return `${n.toFixed(2)}%`;
}
function money(n) {
  return Math.round(n).toLocaleString();
}
function pad(str, width) {
  return String(str).padEnd(width);
}
function padNum(str, width) {
  return String(str).padStart(width);
}

function printSummaryBlock(title, s) {
  console.log(title);
  console.log(`  MAPE:               ${pct(s.mape)}`);
  console.log(`  Median APE:         ${pct(s.medianApe)}`);
  console.log(`  WAPE:               ${pct(s.wape)}`);
  console.log(`  Bias:               ${s.bias >= 0 ? '+' : ''}${pct(s.bias)}`);
  console.log(`  Error >20%:         ${pct(s.over20)}`);
  console.log(`  Error >50%:         ${pct(s.over50)}`);
  console.log(`  Negative forecasts: ${s.negativeForecasts}`);
}


const CSV_COLUMNS = [
  'store_id',
  'forecast_date',
  'weekday',
  'actual',
  'forecast',
  'absolute_error',
  'ape',
  'signed_error_pct',
  'forecast_source',
  'history_sample_count',
];

function csvEscape(value) {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function writeCsv(filePath, rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((col) => csvEscape(typeof row[col] === 'number' ? round2(row[col]) : row[col])).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n'));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}


function printClassificationSummary(records, coverage) {
  const kpi = computePrimaryKpi(records);

  console.log('\n=== MANPOWER DECISION ACCURACY ===\n');
  console.log('Decision definition:');
  console.log('  Previous operating hour required-headcount delta');
  console.log(`  "${DECISION_DEFINITION_TEXT}"`);
  console.log(`  ${DECISION_DEFINITION_DISCLAIMER}`);

  console.log('\nData coverage:');
  console.log(`  Active stores:                   ${coverage.totalActiveStores}`);
  console.log(`  Configured productivity stores:  ${coverage.configuredStores}`);
  console.log(`  Labor Guideline Coverage:        ${pct(coverage.laborGuidelineCoverage)}`);
  console.log(`  Unconfigured stores:             ${coverage.storesWithoutProductivity} (excluded from primary metrics below -- constant headcount, nothing demand-driven to score)`);
  console.log(`  Evaluated stores (primary KPI):  ${kpi.evaluatedStores}`);
  console.log(`  Evaluated hours (primary KPI):   ${kpi.evaluatedHours}`);

  console.log('\nPrimary metrics (configured-productivity stores only):');
  console.log(`  Accuracy:         ${pct(kpi.accuracy * 100)}`);
  console.log(`  Macro Precision:  ${pct(kpi.macro.precision * 100)}`);
  console.log(`  Macro Recall:     ${pct(kpi.macro.recall * 100)}`);
  console.log(`  Macro F1:         ${pct(kpi.macro.f1 * 100)}`);
  console.log('  (Macro F1 is the number to trust over Accuracy alone -- KEEP is almost always the majority class, so Accuracy can look good while INCREASE/DECREASE are barely ever caught.)');

  for (const cls of DECISION_CLASSES) {
    const m = kpi.classMetrics[cls];
    console.log(`\n${cls}:`);
    console.log(`  Precision: ${pct(m.precision * 100)}`);
    console.log(`  Recall:    ${pct(m.recall * 100)}`);
    console.log(`  F1:        ${pct(m.f1 * 100)}`);
    console.log(`  Support:   ${m.support}`);
  }

  console.log('\nConfusion Matrix (primary KPI population only):');
  console.log('                 Pred Increase  Pred Keep  Pred Decrease');
  for (const actualCls of DECISION_CLASSES) {
    console.log(
      `Actual ${pad(actualCls, 9)}`,
      padNum(kpi.matrix[actualCls].INCREASE, 13),
      padNum(kpi.matrix[actualCls].KEEP, 11),
      padNum(kpi.matrix[actualCls].DECREASE, 14)
    );
  }

  const business = kpi.business;
  console.log('\nStaffing outcome (configured-productivity stores only):');
  console.log(`  Understaffing Hours:    ${business.understaffingHours}`);
  console.log(`  Overstaffing Hours:     ${business.overstaffingHours}`);
  console.log(`  Understaffing Rate:     ${pct(business.understaffingRate)}`);
  console.log(`  Overstaffing Rate:      ${pct(business.overstaffingRate)}`);
  console.log(`  Mean Headcount Error:   ${business.meanHeadcountError.toFixed(2)} people`);
  console.log(`  Signed Headcount Bias:  ${business.signedHeadcountBias >= 0 ? '+' : ''}${business.signedHeadcountBias.toFixed(2)} people (${business.signedHeadcountBias >= 0 ? 'tendency to overstaff' : 'tendency to understaff'})`);

  console.log('\nData limitations:');
  console.log('  - hourly actual is a daily-total x store-hour-shape proxy (no true date+hour actual sales table exists)');
  console.log('  - manager-approved staffing intent is unavailable -- this is an evaluation convention, not a business policy');
  console.log('  - monthly-guideline-share reconciliation (rosterGenerationService\'s salesShapedHeadcount term) is not replicated');

  return kpi;
}

// --- Manpower decision CSV export ---------------------------------------------------------------

const MANPOWER_CSV_COLUMNS = [
  'store_id',
  'store_name',
  'date',
  'hour',
  'actual_sales',
  'forecast_sales',
  'actual_required_headcount',
  'forecast_required_headcount',
  'actual_decision',
  'predicted_decision',
  'headcount_error',
  'understaffed',
  'overstaffed',
  'evaluation_status',
];

function writeManpowerCsv(filePath, records, storeNames) {
  const lines = [MANPOWER_CSV_COLUMNS.join(',')];
  for (const r of records) {
    const row = { ...r, store_name: storeNames.get(r.store_id) || '(unknown)' };
    lines.push(MANPOWER_CSV_COLUMNS.map((col) => csvEscape(typeof row[col] === 'number' ? round2(row[col]) : row[col])).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n'));
}


async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { from, to } = resolveEvaluationWindow(args);
  const singleStoreId = args.store ? String(args.store) : null;

  console.log('Loading real sales_report data (read-only)...');
  const allHistory = await loadSalesHistory(singleStoreId);

  const byStore = new Map();
  for (const r of allHistory) {
    if (r.gross_actual == null) continue; // never treat an unreported day as 0 -- same rule computeDailyForecast itself applies
    if (!byStore.has(r.store_id)) byStore.set(r.store_id, []);
    byStore.get(r.store_id).push(r);
  }
  for (const rows of byStore.values()) rows.sort((a, b) => (a.report_date < b.report_date ? -1 : 1));

  const allRows = [];
  for (const [storeId, sortedHistory] of byStore) {
    allRows.push(...evaluateStore(storeId, sortedHistory, from, to));
  }

  if (!allRows.length) {
    console.log('\nNo valid forecast test points found for this evaluation window / store. Nothing to report.');
    return;
  }

  const storeNames = await loadStoreNames([...new Set(allRows.map((r) => r.store_id))]);
  const overall = summarize(allRows);

  console.log('\n=== FORECAST ACCURACY ===\n');
  console.log(`Evaluation period: ${from} to ${to}`);
  console.log(`Test points:       ${overall.n}`);
  console.log(`Stores:            ${byStore.size}\n`);
  printSummaryBlock('Overall:', overall);


  console.log('\n--- By month ---');
  const months = [...new Set(allRows.map((r) => r.forecast_date.slice(0, 7)))].sort();
  console.log(pad('Month', 10), padNum('n', 7), padNum('MAPE', 9), padNum('WAPE', 9), padNum('Bias', 9), padNum('>20%', 8), padNum('>50%', 8));
  for (const m of months) {
    const rows = allRows.filter((r) => r.forecast_date.slice(0, 7) === m);
    const s = summarize(rows);
    console.log(pad(m, 10), padNum(s.n, 7), padNum(pct(s.mape), 9), padNum(pct(s.wape), 9), padNum((s.bias >= 0 ? '+' : '') + pct(s.bias), 9), padNum(pct(s.over20), 8), padNum(pct(s.over50), 8));
  }


  console.log('\n--- By store ---');
  console.log(pad('Store ID', 10), padNum('Test Points', 12), padNum('MAPE', 9), padNum('WAPE', 9), padNum('Bias', 9), padNum('>20%', 8), padNum('>50%', 8));
  const storeSummaries = [...byStore.keys()].map((storeId) => {
    const rows = allRows.filter((r) => r.store_id === storeId);
    return { storeId, name: storeNames.get(storeId) || '(unknown)', ...summarize(rows) };
  });
  for (const s of storeSummaries.sort((a, b) => a.storeId.localeCompare(b.storeId))) {
    console.log(pad(s.storeId, 10), padNum(s.n, 12), padNum(pct(s.mape), 9), padNum(pct(s.wape), 9), padNum((s.bias >= 0 ? '+' : '') + pct(s.bias), 9), padNum(pct(s.over20), 8), padNum(pct(s.over50), 8));
  }


  console.log('\n--- By weekday ---');
  console.log(pad('Weekday', 10), padNum('n', 7), padNum('MAPE', 9), padNum('WAPE', 9), padNum('Bias', 9), padNum('>20%', 8), padNum('>50%', 8));
  for (const wd of WEEKDAY_NAMES) {
    const rows = allRows.filter((r) => r.weekday === wd);
    if (!rows.length) continue;
    const s = summarize(rows);
    console.log(pad(wd, 10), padNum(s.n, 7), padNum(pct(s.mape), 9), padNum(pct(s.wape), 9), padNum((s.bias >= 0 ? '+' : '') + pct(s.bias), 9), padNum(pct(s.over20), 8), padNum(pct(s.over50), 8));
  }


  if (!singleStoreId && storeSummaries.length >= 3) {
    console.log('\n--- By sales-volume segment (terciles, by each store\'s average actual sales in this window) ---');
    const withAvgActual = [...byStore.keys()].map((storeId) => {
      const rows = allRows.filter((r) => r.store_id === storeId);
      return { storeId, avgActual: average(rows.map((r) => r.actual)) };
    });
    withAvgActual.sort((a, b) => b.avgActual - a.avgActual);
    const third = Math.floor(withAvgActual.length / 3);
    const segments = [
      ['High-volume', withAvgActual.slice(0, third)],
      ['Mid-volume', withAvgActual.slice(third, third * 2)],
      ['Low-volume', withAvgActual.slice(third * 2)],
    ];
    for (const [label, storesInSegment] of segments) {
      const ids = new Set(storesInSegment.map((s) => s.storeId));
      const rows = allRows.filter((r) => ids.has(r.store_id));
      const s = summarize(rows);
      console.log(`${pad(label, 14)} (${storesInSegment.length} stores) | ` + `n=${padNum(s.n, 6)} | MAPE=${pct(s.mape)} | WAPE=${pct(s.wape)} | Bias=${(s.bias >= 0 ? '+' : '') + pct(s.bias)}`);
    }
  } else if (!singleStoreId) {
    console.log('\n--- By sales-volume segment ---\n  (skipped -- too few stores in this result set to segment meaningfully)');
  }


  const MIN_SAMPLES_FOR_RANKING = 10;
  const rankable = storeSummaries.filter((s) => s.n >= MIN_SAMPLES_FOR_RANKING);
  if (rankable.length) {
    console.log(`\n--- Best-performing stores (by MAPE, min ${MIN_SAMPLES_FOR_RANKING} test points) ---`);
    for (const s of [...rankable].sort((a, b) => a.mape - b.mape).slice(0, 5)) {
      console.log(`  ${s.storeId} — ${s.name} | MAPE=${pct(s.mape)} | n=${s.n}`);
    }
    console.log(`\n--- Worst-performing stores (by MAPE, min ${MIN_SAMPLES_FOR_RANKING} test points) ---`);
    for (const s of [...rankable].sort((a, b) => b.mape - a.mape).slice(0, 5)) {
      console.log(`  ${s.storeId} — ${s.name} | MAPE=${pct(s.mape)} | n=${s.n}`);
    }
  }


  console.log('\n--- Largest individual forecast errors (by APE) ---');
  for (const r of [...allRows].sort((a, b) => b.ape - a.ape).slice(0, 10)) {
    console.log(`  ${r.forecast_date} (${r.weekday}) store ${r.store_id} | actual=${money(r.actual)} forecast=${money(r.forecast)} | APE=${pct(r.ape)} | source=${r.forecast_source} n=${r.history_sample_count}`);
  }

  if (args.csv) {
    const csvPath = path.resolve(process.cwd(), args.csv);
    writeCsv(csvPath, allRows);
    console.log(`\nCSV written: ${csvPath} (${allRows.length} rows)`);
  }


  console.log('\nLoading real labor guidelines and hourly sales shapes (read-only)...');
  const chainHourlyRows = await withRetry(() => forecastRepo.findAllHourlySalesHistory()); 

  const manpowerRecords = [];
  const storeStatuses = []; 
  for (const [storeId, sortedHistory] of byStore) {
    const [guideline, hourShape] = await Promise.all([resolveEffectiveGuideline(storeId), resolveHourShape(storeId, chainHourlyRows)]);
    storeStatuses.push({ storeId, evaluationStatus: resolveEvaluationStatus(guideline) });
    manpowerRecords.push(...evaluateStoreManpowerDecisions({ storeId, sortedDailyHistory: sortedHistory, hourShape, guideline, fromDate: from, toDate: to }));
  }
  const coverage = computeCoverageSummary(storeStatuses);

  if (!manpowerRecords.length) {
    console.log('\nNo manpower decision test points could be evaluated for this window / store.');
  } else {
    printClassificationSummary(manpowerRecords, coverage);


    const primaryRecords = manpowerRecords.filter((r) => r.evaluation_status === EVALUATION_STATUS.CONFIGURED);

    if (!primaryRecords.length) {
      console.log('\n(No configured-productivity stores had evaluable hours -- breakdowns skipped.)');
    } else {


    function summarizeManpower(records) {
      const matrix = computeConfusionMatrix(records);
      return { n: records.length, accuracy: computeAccuracy(matrix), macro: computeMacroMetrics(computeClassMetrics(matrix)), business: computeBusinessMetrics(records) };
    }
    function printManpowerRow(label, width, s) {
      console.log(
        pad(label, width),
        padNum(s.n, 7),
        padNum(pct(s.accuracy * 100), 9),
        padNum(pct(s.macro.f1 * 100), 9),
        padNum(pct(s.business.understaffingRate), 10),
        padNum(pct(s.business.overstaffingRate), 10),
        padNum(s.business.signedHeadcountBias.toFixed(2), 8)
      );
    }
    const manpowerHeader = () =>
      console.log(pad('', 10), padNum('n', 7), padNum('Accuracy', 9), padNum('MacroF1', 9), padNum('Understaff', 10), padNum('Overstaff', 10), padNum('Bias', 8));

    console.log('\n--- Manpower decision accuracy by month (configured-productivity stores only) ---');
    manpowerHeader();
    for (const m of [...new Set(primaryRecords.map((r) => r.date.slice(0, 7)))].sort()) {
      printManpowerRow(m, 10, summarizeManpower(primaryRecords.filter((r) => r.date.slice(0, 7) === m)));
    }

    console.log('\n--- Manpower decision accuracy by store (configured-productivity stores only) ---');
    manpowerHeader();
    const manpowerStoreIds = [...new Set(primaryRecords.map((r) => r.store_id))].sort();
    const manpowerStoreSummaries = manpowerStoreIds.map((storeId) => ({ storeId, ...summarizeManpower(primaryRecords.filter((r) => r.store_id === storeId)) }));
    for (const s of manpowerStoreSummaries) printManpowerRow(s.storeId, 10, s);

    console.log('\n--- Manpower decision accuracy by weekday (configured-productivity stores only) ---');
    manpowerHeader();
    for (const wd of WEEKDAY_NAMES) {
      const rows = primaryRecords.filter((r) => WEEKDAY_NAMES[weekdayOf(r.date)] === wd);
      if (!rows.length) continue;
      printManpowerRow(wd, 10, summarizeManpower(rows));
    }

    if (!singleStoreId && manpowerStoreSummaries.length >= 3) {
      console.log("\n--- Manpower decision accuracy by sales-volume segment (terciles, same grouping as the sales-forecast section, configured-productivity stores only) ---");
      const storeAvgSales = new Map(storeSummaries.map((s) => [s.storeId, average(allRows.filter((r) => r.store_id === s.storeId).map((r) => r.actual))]));
      const orderedIds = [...storeAvgSales.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).filter((id) => manpowerStoreIds.includes(id));
      const third = Math.floor(orderedIds.length / 3);
      const segments = [
        ['High-volume', new Set(orderedIds.slice(0, third))],
        ['Mid-volume', new Set(orderedIds.slice(third, third * 2))],
        ['Low-volume', new Set(orderedIds.slice(third * 2))],
      ];
      for (const [label, ids] of segments) {
        printManpowerRow(label, 14, summarizeManpower(primaryRecords.filter((r) => ids.has(r.store_id))));
      }
    }


    const MIN_MANPOWER_SAMPLES = 20;
    const rankableManpower = manpowerStoreSummaries.filter((s) => s.n >= MIN_MANPOWER_SAMPLES);
    if (rankableManpower.length) {
      console.log(`\n--- Best manpower-decision stores (by Macro F1, min ${MIN_MANPOWER_SAMPLES} evaluable hours, configured-productivity stores only) ---`);
      for (const s of [...rankableManpower].sort((a, b) => b.macro.f1 - a.macro.f1).slice(0, 5)) {
        console.log(`  ${s.storeId} — ${storeNames.get(s.storeId) || '(unknown)'} | Macro F1=${pct(s.macro.f1 * 100)} | Accuracy=${pct(s.accuracy * 100)} | n=${s.n}`);
      }
      console.log(`\n--- Worst manpower-decision stores (by Macro F1, min ${MIN_MANPOWER_SAMPLES} evaluable hours, configured-productivity stores only) ---`);
      for (const s of [...rankableManpower].sort((a, b) => a.macro.f1 - b.macro.f1).slice(0, 5)) {
        console.log(`  ${s.storeId} — ${storeNames.get(s.storeId) || '(unknown)'} | Macro F1=${pct(s.macro.f1 * 100)} | Accuracy=${pct(s.accuracy * 100)} | n=${s.n}`);
      }
      console.log(`\n--- Highest understaffing-rate stores (min ${MIN_MANPOWER_SAMPLES} hours, configured-productivity stores only) ---`);
      for (const s of [...rankableManpower].sort((a, b) => b.business.understaffingRate - a.business.understaffingRate).slice(0, 5)) {
        console.log(`  ${s.storeId} — ${storeNames.get(s.storeId) || '(unknown)'} | Understaffing Rate=${pct(s.business.understaffingRate)} | n=${s.n}`);
      }
      console.log(`\n--- Highest overstaffing-rate stores (min ${MIN_MANPOWER_SAMPLES} hours, configured-productivity stores only) ---`);
      for (const s of [...rankableManpower].sort((a, b) => b.business.overstaffingRate - a.business.overstaffingRate).slice(0, 5)) {
        console.log(`  ${s.storeId} — ${storeNames.get(s.storeId) || '(unknown)'} | Overstaffing Rate=${pct(s.business.overstaffingRate)} | n=${s.n}`);
      }
    }
    } 

    if (args.csv) {
      const baseCsvPath = path.resolve(process.cwd(), args.csv);
      const manpowerCsvPath = baseCsvPath.replace(/(\.[^.]+)?$/, (ext) => `-manpower${ext || '.csv'}`);
      writeManpowerCsv(manpowerCsvPath, manpowerRecords, storeNames);
      console.log(`\nManpower decision CSV written: ${manpowerCsvPath} (${manpowerRecords.length} rows, hourly granularity, includes an evaluation_status column -- filter to CONFIGURED for anything matching the primary KPI above)`);
    }
  }

  console.log('\nDone. This script only ever read data (sales_report, sales_by_hour, labor_guideline, whr_target_monthly, store) -- nothing was written to the database.');
}

main().catch((err) => {
  console.error('\nforecast-accuracy.js failed:', err.message);
  process.exit(1);
});
