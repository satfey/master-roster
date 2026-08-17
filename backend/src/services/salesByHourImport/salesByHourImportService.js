const crypto = require('crypto');
const { parseSalesByHourWorkbook } = require('./excelParser');
const { transformRows } = require('./transform');
const repo = require('../../repositories/salesByHourRepository');

/** First non-blank Excel store name seen for each Store Id, in file order — used as the name for any auto-created store. */
function pickStoreNamesByCode(rows) {
  const names = new Map();
  for (const row of rows) {
    if (row.reportStoreId === null) continue;
    const code = String(row.reportStoreId);
    if (!names.has(code) && row.storeName) names.set(code, row.storeName);
  }
  return names;
}

/**
 * Resolves every distinct Store Id referenced in the file to a store row,
 * creating missing stores when `createMissingStores` is true (commit), or
 * standing in a per-call placeholder id when false (preview — nothing is
 * written to the DB, but the row shape/dedup logic stays consistent).
 * A Store Id repeated across many rows resolves/creates exactly once.
 */
async function resolveStores(rows, createMissingStores) {
  const codes = [...new Set(rows.filter((r) => r.reportStoreId !== null).map((r) => String(r.reportStoreId)))];
  const namesByCode = pickStoreNamesByCode(rows);

  const storeMap = await repo.findStoresByCodes(codes);
  const missingCodes = codes.filter((code) => !storeMap.has(code));

  const createdStores = [];
  if (missingCodes.length) {
    if (createMissingStores) {
      const created = await repo.createStores(missingCodes.map((code) => ({ storeCode: code, name: namesByCode.get(code) || null })));
      for (const store of created) {
        storeMap.set(store.storeCode, store);
        createdStores.push(store);
      }
    } else {
      for (const code of missingCodes) {
        storeMap.set(code, { id: crypto.randomUUID(), storeCode: code, name: namesByCode.get(code) || null, pending: true });
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

  const seenInFile = new Set();

  const previewRows = rows.map((row) => {
    const errors = [...row.errors];
    const store = row.reportStoreId !== null ? storeMap.get(String(row.reportStoreId)) : null;

    let status = 'invalid';
    if (errors.length === 0 && store) {
      const key = repo.recordKey(store.id, reportMonth, row.hour);
      if (existingKeys.has(key) || seenInFile.has(key)) {
        status = 'duplicate';
      } else {
        status = 'valid';
        seenInFile.add(key);
      }
    }

    return {
      rowNumber: row.rowNumber,
      status,
      errors,
      reportStoreId: row.reportStoreId,
      storeId: store?.id || null,
      willCreateStore: Boolean(store?.pending),
      brandName: row.brandName,
      storeName: row.storeName,
      reportMonth,
      hour: row.hour,
      grossSale: row.grossSale,
    };
  });

  return { rows: previewRows, createdStores };
}

function summarize({ rows, createdStores }) {
  return {
    totalRows: rows.length,
    validRows: rows.filter((r) => r.status === 'valid').length,
    invalidRows: rows.filter((r) => r.status === 'invalid').length,
    duplicateRows: rows.filter((r) => r.status === 'duplicate').length,
    newStoreCount: new Set(rows.filter((r) => r.willCreateStore).map((r) => r.reportStoreId)).size,
    rows,
  };
}

async function previewSalesByHourImport(buffer, reportMonth) {
  return summarize(await evaluateRows(buffer, reportMonth, false));
}

async function commitSalesByHourImport(buffer, reportMonth, userId) {
  const { rows, createdStores } = await evaluateRows(buffer, reportMonth, true);
  const validRows = rows.filter((r) => r.status === 'valid');

  const sourceType = await repo.getSalesByHourSourceType();
  const records = validRows.map((r) => ({
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

  const imported = await repo.insertRecords(records);

  return {
    total: rows.length,
    imported,
    skippedDuplicates: rows.filter((r) => r.status === 'duplicate').length,
    failed: rows.filter((r) => r.status === 'invalid').map((r) => ({ rowNumber: r.rowNumber, reportStoreId: r.reportStoreId, errors: r.errors })),
    storesCreated: createdStores.map((s) => ({ id: s.id, storeCode: s.storeCode, name: s.name })),
  };
}

module.exports = { previewSalesByHourImport, commitSalesByHourImport };
