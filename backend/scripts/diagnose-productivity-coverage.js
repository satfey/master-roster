
require('dotenv').config();
const supabase = require('../src/config/supabase');
const rosterRepo = require('../src/repositories/rosterRepository');
const whrTargetRepo = require('../src/repositories/whrTargetRepository');
const { resolveTargetProductivity } = require('../src/services/laborBudgetService');

async function loadActiveStoreIds() {
  const pageSize = 1000;
  let from = 0;
  const ids = new Set();
  while (true) {
    const { data, error } = await supabase.from('sales_report').select('store_id, gross_actual').range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data.length) break;
    for (const r of data) if (r.gross_actual != null) ids.add(r.store_id);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return [...ids];
}


async function findAllWhrRows(storeId) {
  const { data, error } = await supabase.from('whr_target_monthly').select('report_month, productivity, whrs, sales').eq('store_id', storeId).order('report_month', { ascending: false });
  if (error) throw error;
  return data;
}

async function main() {
  console.log('Loading active stores (read-only)...');
  const storeIds = await loadActiveStoreIds();
  console.log(`Active stores: ${storeIds.length}\n`);

  const categories = {
    CONFIGURED_MANUAL: [],
    CONFIGURED_WHR_HISTORY: [],
    NO_GUIDELINE_NO_WHR_DATA_AT_ALL: [],
    NO_GUIDELINE_WHR_ROWS_EXIST_BUT_PRODUCTIVITY_ALWAYS_NULL: [],
    HAS_GUIDELINE_BUT_TARGET_PRODUCTIVITY_NULL_NO_WHR_DATA: [],
    HAS_GUIDELINE_BUT_TARGET_PRODUCTIVITY_NULL_WHR_ROWS_EXIST_BUT_PRODUCTIVITY_ALWAYS_NULL: [],
    ZERO_PRODUCTIVITY_EDGE_CASE: [], // resolved value is exactly 0 (falsy) -- resolveTargetProductivity accepts it as "resolved", but computeHourlyLaborDemand's truthy check treats 0 the same as null
  };

  let done = 0;
  for (const storeId of storeIds) {
    const [guideline, resolved, whrRows] = await Promise.all([
      rosterRepo.findGuideline(storeId),
      resolveTargetProductivity({ storeId, manualTargetProductivity: null }), // never pass the manual override here -- we want to see what WHR alone would resolve, manual is checked separately below
      findAllWhrRows(storeId),
    ]);

    const manualTargetProductivity = guideline?.target_productivity != null ? Number(guideline.target_productivity) : null;
    const hasAnyWhrRow = whrRows.length > 0;
    const hasAnyNonNullProductivity = whrRows.some((r) => r.productivity != null);

    if (manualTargetProductivity) {
      categories.CONFIGURED_MANUAL.push({ storeId, value: manualTargetProductivity });
    } else if (resolved.value) {
      categories.CONFIGURED_WHR_HISTORY.push({ storeId, value: resolved.value, reportMonth: resolved.reportMonth });
    } else if (resolved.value === 0 || manualTargetProductivity === 0) {
      categories.ZERO_PRODUCTIVITY_EDGE_CASE.push({ storeId, manualTargetProductivity, whrValue: resolved.value });
    } else if (!guideline && !hasAnyWhrRow) {
      categories.NO_GUIDELINE_NO_WHR_DATA_AT_ALL.push({ storeId });
    } else if (!guideline && hasAnyWhrRow && !hasAnyNonNullProductivity) {
      categories.NO_GUIDELINE_WHR_ROWS_EXIST_BUT_PRODUCTIVITY_ALWAYS_NULL.push({ storeId, whrRowCount: whrRows.length });
    } else if (guideline && !hasAnyWhrRow) {
      categories.HAS_GUIDELINE_BUT_TARGET_PRODUCTIVITY_NULL_NO_WHR_DATA.push({ storeId });
    } else if (guideline && hasAnyWhrRow && !hasAnyNonNullProductivity) {
      categories.HAS_GUIDELINE_BUT_TARGET_PRODUCTIVITY_NULL_WHR_ROWS_EXIST_BUT_PRODUCTIVITY_ALWAYS_NULL.push({ storeId, whrRowCount: whrRows.length });
    } else {
      console.log(`  UNCATEGORIZED: ${storeId} guideline=${JSON.stringify(guideline)} resolved=${JSON.stringify(resolved)} whrRows=${whrRows.length} hasAnyNonNullProductivity=${hasAnyNonNullProductivity}`);
    }

    done++;
    if (done % 100 === 0) console.log(`  ...${done}/${storeIds.length}`);
  }

  console.log('\n=== PRODUCTIVITY COVERAGE BREAKDOWN ===\n');
  for (const [name, list] of Object.entries(categories)) {
    console.log(`${name}: ${list.length}`);
  }
  const configured = categories.CONFIGURED_MANUAL.length + categories.CONFIGURED_WHR_HISTORY.length;
  console.log(`\nTotal configured (valid target_productivity): ${configured} / ${storeIds.length} (${((configured / storeIds.length) * 100).toFixed(2)}%)`);

  console.log('\n--- Sample: NO_GUIDELINE_NO_WHR_DATA_AT_ALL (first 10) ---');
  for (const s of categories.NO_GUIDELINE_NO_WHR_DATA_AT_ALL.slice(0, 10)) console.log(' ', s.storeId);

  console.log('\n--- Sample: NO_GUIDELINE_WHR_ROWS_EXIST_BUT_PRODUCTIVITY_ALWAYS_NULL (first 10) ---');
  for (const s of categories.NO_GUIDELINE_WHR_ROWS_EXIST_BUT_PRODUCTIVITY_ALWAYS_NULL.slice(0, 10)) console.log(' ', s.storeId, `(${s.whrRowCount} WHR rows, all productivity blank)`);

  console.log('\n--- Sample: HAS_GUIDELINE_BUT_TARGET_PRODUCTIVITY_NULL_NO_WHR_DATA (first 10) ---');
  for (const s of categories.HAS_GUIDELINE_BUT_TARGET_PRODUCTIVITY_NULL_NO_WHR_DATA.slice(0, 10)) console.log(' ', s.storeId);

  console.log('\n--- ZERO_PRODUCTIVITY_EDGE_CASE (all) ---');
  for (const s of categories.ZERO_PRODUCTIVITY_EDGE_CASE) console.log(' ', JSON.stringify(s));

  console.log('\nDone. Read-only -- no writes were made.');
}

main().catch((err) => {
  console.error('diagnose-productivity-coverage.js failed:', err);
  process.exit(1);
});
