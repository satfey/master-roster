const { parseSalesReportWorkbook } = require('./excelParser');
const { transformRows } = require('./transform');
const repo = require('../../repositories/salesReportRepository');

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
async function evaluateRows(buffer, createMissingStores) {
  const { rows: rawRows } = await parseSalesReportWorkbook(buffer);
  const rows = transformRows(rawRows);

  const { storeMap, createdStores } = await resolveStores(rows, createMissingStores);

  const storeIds = [...new Set([...storeMap.values()].map((s) => s.id))];
  const parsedDates = rows.filter((r) => r.reportDate).map((r) => r.reportDate);
  const existingKeys = await repo.findExistingReportKeys(storeIds, parsedDates);

  const seenInFile = new Set();

  const previewRows = rows.map((row) => {
    const errors = [...row.errors];
    const store = row.storeId !== null ? storeMap.get(row.storeId) : null;

    let status = 'invalid';
    if (errors.length === 0 && store) {
      const key = repo.recordKey(store.id, row.reportDate);
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
      storeId: row.storeId, // business-facing Store ID (e.g. "1001") — this IS store.id, the canonical primary key, not a UUID
      willCreateStore: Boolean(store?.pending),
      storeBuId: row.storeBuId,
      storeName: row.storeName,
      week: row.week,
      reportDate: row.reportDate ? row.reportDate.toISOString().slice(0, 10) : null,

      grossActual: row.grossActual,
      grossBudget: row.grossBudget,
      grossVariancePercent: row.grossVariancePercent,
      grossActualLy: row.grossActualLy,
      grossLyVariancePercent: row.grossLyVariancePercent,
      grossActualMtd: row.grossActualMtd,
      grossBudgetMtd: row.grossBudgetMtd,
      grossMtdVariancePercent: row.grossMtdVariancePercent,
      grossActualLyMtd: row.grossActualLyMtd,

      docketActual: row.docketActual,
      docketBudget: row.docketBudget,
      docketVariancePercent: row.docketVariancePercent,
      docketActualLy: row.docketActualLy,
      docketLyVariancePercent: row.docketLyVariancePercent,

      customerActual: row.customerActual,
      customerBudget: row.customerBudget,
      customerVariancePercent: row.customerVariancePercent,
      customerActualLy: row.customerActualLy,
      customerLyVariancePercent: row.customerLyVariancePercent,

      otherSales: row.otherSales,
      serviceCharge: row.serviceCharge,
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

async function previewSalesReportImport(buffer) {
  return summarize(await evaluateRows(buffer, false));
}

async function commitSalesReportImport(buffer, userId) {
  const { rows, createdStores } = await evaluateRows(buffer, true);
  const validRows = rows.filter((r) => r.status === 'valid');

  const sourceType = await repo.getSalesReportSourceType();
  const records = validRows.map((r) => ({
    store_id: r.storeId,
    report_store_id: r.reportStoreId,
    store_bu_id: r.storeBuId,
    store_name: r.storeName,
    week: r.week,
    report_date: r.reportDate,

    gross_actual: r.grossActual,
    gross_budget: r.grossBudget,
    gross_variance_percent: r.grossVariancePercent,
    gross_actual_ly: r.grossActualLy,
    gross_ly_variance_percent: r.grossLyVariancePercent,
    gross_actual_mtd: r.grossActualMtd,
    gross_budget_mtd: r.grossBudgetMtd,
    gross_mtd_variance_percent: r.grossMtdVariancePercent,
    gross_actual_ly_mtd: r.grossActualLyMtd,

    docket_actual: r.docketActual,
    docket_budget: r.docketBudget,
    docket_variance_percent: r.docketVariancePercent,
    docket_actual_ly: r.docketActualLy,
    docket_ly_variance_percent: r.docketLyVariancePercent,

    customer_actual: r.customerActual,
    customer_budget: r.customerBudget,
    customer_variance_percent: r.customerVariancePercent,
    customer_actual_ly: r.customerActualLy,
    customer_ly_variance_percent: r.customerLyVariancePercent,

    other_sales: r.otherSales,
    service_charge: r.serviceCharge,

    source_type_id: sourceType.id,
    entered_by: userId,
  }));

  const imported = await repo.insertRecords(records);

  return {
    total: rows.length,
    imported,
    skippedDuplicates: rows.filter((r) => r.status === 'duplicate').length,
    failed: rows.filter((r) => r.status === 'invalid').map((r) => ({ rowNumber: r.rowNumber, reportStoreId: r.reportStoreId, errors: r.errors })),
    storesCreated: createdStores.map((s) => ({ id: s.id, storeId: s.id, storeCode: s.storeCode, name: s.name })),
  };
}

module.exports = { previewSalesReportImport, commitSalesReportImport };



