const { parseSalesByHourWorkbook } = require('./excelParser');
const { transformRows } = require('./transform');
const repo = require('../../repositories/salesByHourRepository');

/** First non-blank Excel store name seen for each Store Id, in file order — used as the name for any auto-created store. */
function pickStoreNamesByCode(rows) {
  const names = new Map();
  for (const row of rows) {
    if (row.storeId === null) continue;
    if (!names.has(row.storeId) && row.storeName) names.set(row.storeId, row.storeName);
  }
  return names;
}

/**
 * Resolves every distinct Store Id referenced in the file to a store row,
 * creating missing stores when `createMissingStores` is true (commit), or
 * standing in a per-call placeholder when false (preview — nothing is
 * written to the DB, but the row shape/dedup logic stays consistent).
 * A Store Id repeated across many rows resolves/creates exactly once.
 *
 * The Excel Store ID *is* store.id now (no separate UUID identity) — a
 * "placeholder" here is not random, it's the same id the row will actually
 * get on commit, since that id is deterministic from the source file.
 */
async function resolveStores(rows, createMissingStores) {
  const codes = [...new Set(rows.filter((r) => r.storeId !== null).map((r) => r.storeId))];
  const namesByCode = pickStoreNamesByCode(rows);

  const storeMap = await repo.findStoresByCodes(codes);
  const missingCodes = codes.filter((code) => !storeMap.has(code));

  const createdStores = [];
  if (missingCodes.length) {
    if (createMissingStores) {
      const created = await repo.createStores(missingCodes.map((code) => ({ storeCode: code, name: namesByCode.get(code) || null })));
      for (const store of created) {
        storeMap.set(store.id, store);
        createdStores.push(store);
      }
    } else {
      for (const code of missingCodes) {
        storeMap.set(code, { id: code, storeCode: code, name: namesByCode.get(code) || null, pending: true });
      }
    }
  }

  return { storeMap, createdStores };
}

/** Parses + validates the workbook against the DB. Writes nothing except any auto-created stores when createMissingStores is true. */
async function evaluateRows(buffer, reportMonth, createMissingStores) {
  const { rows: rawRows } = await parseSalesByHourWorkbook(buffer);
  const rows = transformRows(rawRows);

  const { storeMap, createdStores } = await resolveStores(rows, createMissingStores);

  const storeIds = [...new Set([...storeMap.values()].map((s) => s.id))];
  const existingKeys = await repo.findExistingRecordKeys(storeIds, reportMonth);

  // A (store, month, hour) key can legitimately appear more than once in one
  // file — only one write per key can happen. The LAST occurrence in file
  // order wins, since the newly uploaded file is the source of truth (same
  // convention as Sales Report Import). This pass just records which
  // rowNumber wins for each key; earlier occurrences are marked
  // 'duplicate_in_file' below and never written.
  const winningRowNumberByKey = new Map();
  for (const row of rows) {
    if (row.errors.length || row.storeId === null) continue;
    const store = storeMap.get(row.storeId);
    if (!store) continue;
    winningRowNumberByKey.set(repo.recordKey(store.id, reportMonth, row.hour), row.rowNumber);
  }

  const resultRows = rows.map((row) => {
    const errors = [...row.errors];
    const store = row.storeId !== null ? storeMap.get(row.storeId) : null;

    let status = 'invalid';
    if (errors.length === 0 && store) {
      const key = repo.recordKey(store.id, reportMonth, row.hour);
      if (winningRowNumberByKey.get(key) !== row.rowNumber) {
        status = 'duplicate_in_file';
      } else {
        // An (store, month, hour) already in the DB is UPDATEd with this file's data —
        // never rejected as a duplicate — so re-importing a corrected report overwrites cleanly.
        status = existingKeys.has(key) ? 'update' : 'new';
      }
    }

    return {
      rowNumber: row.rowNumber,
      status,
      errors,
      reportStoreId: row.reportStoreId,
      storeId: row.storeId, // business-facing Store ID (e.g. "1001") — this IS store.id, the canonical primary key, not a UUID
      willCreateStore: Boolean(store?.pending),
      brandName: row.brandName,
      storeName: row.storeName,
      reportMonth,
      hour: row.hour,
      grossSale: row.grossSale,
    };
  });

  return { rows: resultRows, createdStores };
}

function summarize({ rows, createdStores }) {
  const newRows = rows.filter((r) => r.status === 'new').length;
  const updateRows = rows.filter((r) => r.status === 'update').length;
  return {
    totalRows: rows.length,
    newRows, // will be INSERTed
    updateRows, // (store_id, report_month, hour) already exists — will be UPDATEd with this file's data
    validRows: newRows + updateRows, // total rows that will actually be written, insert + update combined
    invalidRows: rows.filter((r) => r.status === 'invalid').length,
    duplicateInFileRows: rows.filter((r) => r.status === 'duplicate_in_file').length, // same key repeated within this file — only the last occurrence is written
    newStoreCount: new Set(rows.filter((r) => r.willCreateStore).map((r) => r.reportStoreId)).size,
    rows,
  };
}

async function previewSalesByHourImport(buffer, reportMonth) {
  return summarize(await evaluateRows(buffer, reportMonth, false));
}

async function commitSalesByHourImport(buffer, reportMonth, userId) {
  const { rows, createdStores } = await evaluateRows(buffer, reportMonth, true);
  // 'new' and 'update' are both written — the upsert below decides INSERT vs
  // UPDATE per row via ON CONFLICT. 'duplicate_in_file' rows are never
  // written: a duplicate key within this same file was already resolved
  // down to a single winning row during evaluateRows.
  const writableRows = rows.filter((r) => r.status === 'new' || r.status === 'update');

  const sourceType = await repo.getSalesByHourSourceType();
  const records = writableRows.map((r) => ({
    store_id: r.storeId,
    report_store_id: r.reportStoreId,
    brand_name: r.brandName,
    store_name: r.storeName,
    report_month: r.reportMonth,
    hour: r.hour,
    gross_sale: r.grossSale,
    source_type_id: sourceType.id,
    entered_by: userId,
  }));

  const imported = await repo.upsertRecords(records);

  return {
    total: rows.length,
    imported, // total rows written this commit, insert + update combined
    inserted: writableRows.filter((r) => r.status === 'new').length,
    updated: writableRows.filter((r) => r.status === 'update').length,
    skippedDuplicatesInFile: rows.filter((r) => r.status === 'duplicate_in_file').length,
    failed: rows.filter((r) => r.status === 'invalid').map((r) => ({ rowNumber: r.rowNumber, reportStoreId: r.reportStoreId, errors: r.errors })),
    storesCreated: createdStores.map((s) => ({ id: s.id, storeId: s.id, storeCode: s.storeCode, name: s.name })),
  };
}

module.exports = { previewSalesByHourImport, commitSalesByHourImport };
