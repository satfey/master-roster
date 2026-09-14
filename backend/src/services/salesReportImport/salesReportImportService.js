const { parseSalesReportWorkbook } = require('./excelParser');
const { transformRows } = require('./transform');
const repo = require('../../repositories/salesReportRepository');
const importJobStore = require('../importJobStore');

const LOG_PREFIX = '[SALES_REPORT_PREVIEW]';

const PREVIEW_ROW_LIMIT = 200;

function pickStoreNamesByCode(rows) {
  const names = new Map();
  for (const row of rows) {
    if (row.storeId === null) continue;
    if (!names.has(row.storeId) && row.storeName) names.set(row.storeId, row.storeName);
  }
  return names;
}


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

function buildRow(row, status, errors, store) {
  return {
    rowNumber: row.rowNumber,
    status,
    errors,
    reportStoreId: row.reportStoreId,
    storeId: row.storeId, 
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
}


async function evaluateRows(buffer, createMissingStores, jobId = null) {
  const t0 = Date.now();
  if (jobId) importJobStore.beginStage(jobId, 'parsing', 'Reading Excel file...');
  const { rows: rawRows } = await parseSalesReportWorkbook(buffer);
  const tParsed = Date.now();
  console.log(`${LOG_PREFIX} workbook read + rows extracted: ${tParsed - t0} ms (${rawRows.length} raw rows)`);
  if (jobId) {
    importJobStore.setTotalRows(jobId, rawRows.length);
    importJobStore.beginStage(jobId, 'transforming', `Transforming ${rawRows.length} rows...`);
  }

  const rows = transformRows(rawRows);
  const tTransformed = Date.now();
  console.log(`${LOG_PREFIX} rows transformed: ${tTransformed - tParsed} ms`);
  if (jobId) importJobStore.beginStage(jobId, 'validating', `Validating ${rows.length} rows...`);

  const { storeMap, createdStores } = await resolveStores(rows, createMissingStores);
  const storeIds = [...new Set([...storeMap.values()].map((s) => s.id))];
  const parsedDates = rows.filter((r) => r.reportDate).map((r) => r.reportDate);
  const existingKeys = await repo.findExistingReportKeys(storeIds, parsedDates);
  const tDb = Date.now();
  console.log(`${LOG_PREFIX} database (store lookup + duplicate check): ${tDb - tTransformed} ms (${storeIds.length} distinct stores, ${existingKeys.size} existing keys loaded)`);

  const winningRowNumberByKey = new Map();
  for (const row of rows) {
    if (row.errors.length || row.storeId === null) continue;
    const store = storeMap.get(row.storeId);
    if (!store) continue;
    winningRowNumberByKey.set(repo.recordKey(store.id, row.reportDate), row.rowNumber);
  }

  const resultRows = rows.map((row) => {
    const errors = [...row.errors];
    const store = row.storeId !== null ? storeMap.get(row.storeId) : null;

    let status = 'invalid';
    if (errors.length === 0 && store) {
      const key = repo.recordKey(store.id, row.reportDate);
      if (winningRowNumberByKey.get(key) !== row.rowNumber) {
        status = 'duplicate_in_file';
      } else {
        status = existingKeys.has(key) ? 'update' : 'new';
      }
    }

    return buildRow(row, status, errors, store);
  });
  const tValidated = Date.now();
  console.log(`${LOG_PREFIX} validation (status per row): ${tValidated - tDb} ms`);

  return { rows: resultRows, createdStores };
}


function buildPreviewRows(rows) {
  const priority = rows.filter((r) => r.status === 'invalid' || r.status === 'duplicate_in_file');
  const rest = rows.filter((r) => r.status !== 'invalid' && r.status !== 'duplicate_in_file');
  const remaining = Math.max(PREVIEW_ROW_LIMIT - priority.length, 0);
  return [...priority, ...rest.slice(0, remaining)].sort((a, b) => a.rowNumber - b.rowNumber);
}

function summarize({ rows, createdStores }) {
  const tStart = Date.now();
  const previewRows = buildPreviewRows(rows);
  console.log(`${LOG_PREFIX} response build: ${Date.now() - tStart} ms (${rows.length} evaluated -> ${previewRows.length} returned)`);

  const newRows = rows.filter((r) => r.status === 'new').length;
  const updateRows = rows.filter((r) => r.status === 'update').length;

  return {
    totalRows: rows.length,
    newRows,
    updateRows, 
    validRows: newRows + updateRows,
    invalidRows: rows.filter((r) => r.status === 'invalid').length,
    duplicateInFileRows: rows.filter((r) => r.status === 'duplicate_in_file').length,
    newStoreCount: new Set(rows.filter((r) => r.willCreateStore).map((r) => r.reportStoreId)).size,
    previewRowCount: previewRows.length,
    previewRows,
  };
}

async function previewSalesReportImport(buffer) {
  const t0 = Date.now();
  const result = summarize(await evaluateRows(buffer, false));
  console.log(`${LOG_PREFIX} total (parse through response build): ${Date.now() - t0} ms`);
  return result;
}


async function commitSalesReportImport(buffer, userId, jobId = null) {
  const { rows, createdStores } = await evaluateRows(buffer, true, jobId);

  const writableRows = rows.filter((r) => r.status === 'new' || r.status === 'update');

  const sourceType = await repo.getSalesReportSourceType();
  const records = writableRows.map((r) => ({
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

  if (jobId) importJobStore.beginStage(jobId, 'database_insert', `Writing ${records.length} rows to database...`);
  const imported = await repo.upsertRecords(records, {
    onBatchComplete: jobId ? ({ rowsWrittenSoFar, totalRows }) => importJobStore.setStageProgress(jobId, { processed: rowsWrittenSoFar, total: totalRows }) : undefined,
  });

  return {
    total: rows.length,
    imported, 
    inserted: writableRows.filter((r) => r.status === 'new').length,
    updated: writableRows.filter((r) => r.status === 'update').length,
    skippedDuplicatesInFile: rows.filter((r) => r.status === 'duplicate_in_file').length,
    failed: rows.filter((r) => r.status === 'invalid').map((r) => ({ rowNumber: r.rowNumber, reportStoreId: r.reportStoreId, errors: r.errors })),
    storesCreated: createdStores.map((s) => ({ id: s.id, storeId: s.id, storeCode: s.storeCode, name: s.name })),
  };
}

module.exports = { previewSalesReportImport, commitSalesReportImport };
