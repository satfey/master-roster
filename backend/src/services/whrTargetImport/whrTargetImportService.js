const { parseWhrTargetWorkbook } = require('./excelParser');
const { transformRows } = require('./transform');
const repo = require('../../repositories/whrTargetRepository');
const { monthKey, monthRange } = require('../../utils/dateRange');

/**
 * Unlike Sales Report/Store Master, WHR Target is a downstream monthly
 * PERFORMANCE report about stores that must already exist — a store CODE
 * with no match in `store` is a real data problem (a typo, a decommissioned
 * store, a store not yet onboarded), not a "create it" case, so this never
 * auto-creates stores (matches genericImport's labor_guideline parser,
 * which also just errors on an unknown storeCode rather than creating one).
 */
async function resolveStores(storeIds) {
  return repo.findStoresByCodes(storeIds);
}

/** Parses + validates the workbook against the DB. Writes nothing. The reporting month always comes from the workbook's own PERIOD cell — never a caller-supplied/hardcoded value. */
async function evaluateRows(buffer) {
  const { periodDate, rows: rawRows } = await parseWhrTargetWorkbook(buffer);
  const reportMonth = monthRange(monthKey(periodDate.toISOString().slice(0, 10))).start;

  const rows = transformRows(rawRows, reportMonth);

  const candidateStoreIds = [...new Set(rows.filter((r) => r.storeId !== null).map((r) => r.storeId))];
  const storeMap = await resolveStores(candidateStoreIds);

  const existingStoreIds = [...storeMap.keys()];
  const existingKeys = await repo.findExistingRecordKeys(existingStoreIds, reportMonth);

  // A store CODE repeated within the same file (e.g. a stray subtotal row
  // that happens to carry a real CODE) can only be written once — the LAST
  // occurrence in file order wins, same "the newly uploaded file is the
  // source of truth" convention as Sales Report/Sales-by-Hour Import.
  const winningRowNumberByKey = new Map();
  for (const row of rows) {
    if (row.errors.length || row.storeId === null || !storeMap.has(row.storeId)) continue;
    winningRowNumberByKey.set(repo.recordKey(row.storeId, reportMonth), row.rowNumber);
  }

  const resultRows = rows.map((row) => {
    const errors = [...row.errors];
    const store = row.storeId !== null ? storeMap.get(row.storeId) : null;
    if (row.storeId !== null && !store) errors.push(`Unknown store CODE: ${row.storeId}`);

    let status = 'invalid';
    if (errors.length === 0 && store) {
      const key = repo.recordKey(row.storeId, reportMonth);
      if (winningRowNumberByKey.get(key) !== row.rowNumber) {
        status = 'duplicate_in_file';
      } else {
        status = existingKeys.has(key) ? 'update' : 'new';
      }
    }

    return { ...row, status, errors };
  });

  return { reportMonth, rows: resultRows };
}

function summarize({ reportMonth, rows }) {
  const newRows = rows.filter((r) => r.status === 'new').length;
  const updateRows = rows.filter((r) => r.status === 'update').length;
  const distinctStores = new Set(rows.filter((r) => r.storeId !== null).map((r) => r.storeId));

  return {
    reportMonth, // 'YYYY-MM-01' — the month this whole file covers, read from its own PERIOD cell
    totalRows: rows.length,
    storeCount: distinctStores.size,
    newRows,
    updateRows,
    validRows: newRows + updateRows,
    invalidRows: rows.filter((r) => r.status === 'invalid').length,
    duplicateInFileRows: rows.filter((r) => r.status === 'duplicate_in_file').length,
    cogOverLimitRows: rows.filter((r) => r.errors.some((e) => e.includes('exceeds the 33% limit'))).length,
    rows,
  };
}

async function previewWhrTargetImport(buffer) {
  return summarize(await evaluateRows(buffer));
}

async function commitWhrTargetImport(buffer, userId) {
  const { reportMonth, rows } = await evaluateRows(buffer);
  const writableRows = rows.filter((r) => r.status === 'new' || r.status === 'update');

  const sourceType = await repo.getWhrTargetSourceType();
  const records = writableRows.map((r) => ({
    store_id: r.storeId,
    report_store_id: r.reportStoreId,
    store_name: r.storeName,
    report_month: r.reportMonth,
    whrs: r.whrs,
    productivity: r.productivity,
    cog: r.cog,
    sales: r.monthlySales,
    cog_percent: r.cogPercent,
    source_type_id: sourceType.id,
    entered_by: userId,
  }));

  const imported = await repo.upsertRecords(records);

  return {
    reportMonth,
    total: rows.length,
    imported,
    inserted: writableRows.filter((r) => r.status === 'new').length,
    updated: writableRows.filter((r) => r.status === 'update').length,
    skippedDuplicatesInFile: rows.filter((r) => r.status === 'duplicate_in_file').length,
    failed: rows.filter((r) => r.status === 'invalid').map((r) => ({ rowNumber: r.rowNumber, storeId: r.storeId, errors: r.errors })),
  };
}

module.exports = { previewWhrTargetImport, commitWhrTargetImport };
