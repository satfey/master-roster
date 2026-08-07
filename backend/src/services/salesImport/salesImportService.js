const { parseSalesWorkbook } = require('./excelParser');
const { transformRows } = require('./transform');
const repo = require('../../repositories/salesImportRepository');

/** Parses + validates the workbook against the DB, without writing anything. */
async function evaluateRows(buffer) {
  const { rows: rawRows } = await parseSalesWorkbook(buffer);
  const rows = transformRows(rawRows);

  const codes = [...new Set(rows.filter((r) => r.storeCode).map((r) => r.storeCode))];
  const storeMap = await repo.findStoresByCodes(codes);

  const storeIds = [...new Set([...storeMap.values()].map((s) => s.id))];
  const parsedDates = rows.filter((r) => r.salesDate).map((r) => r.salesDate);
  const existingKeys = await repo.findExistingRecordKeys(storeIds, parsedDates);

  const seenInFile = new Set();

  return rows.map((row) => {
    const errors = [...row.errors];
    const store = row.storeCode ? storeMap.get(row.storeCode) : null;
    if (row.storeCode && !store) errors.push(`Unknown store code: ${row.storeCode}`);

    let status = 'invalid';
    if (errors.length === 0 && store) {
      const key = repo.recordKey(store.id, row.salesDate);
      if (existingKeys.has(key) || seenInFile.has(key)) {
        status = 'duplicate';
      } else {
        status = 'valid';
        seenInFile.add(key);
      }
    }

    return {
      rowNumber: row.rowNumber,
      storeCode: row.storeCode,
      storeId: store?.id || null,
      storeName: store?.name || null,
      salesDate: row.salesDate ? row.salesDate.toISOString().slice(0, 10) : null,
      salesAmount: row.salesAmount,
      docket: row.docket,
      labourHours: row.labourHours,
      status,
      errors,
    };
  });
}

function summarize(rows) {
  return {
    totalRows: rows.length,
    validRows: rows.filter((r) => r.status === 'valid').length,
    invalidRows: rows.filter((r) => r.status === 'invalid').length,
    duplicateRows: rows.filter((r) => r.status === 'duplicate').length,
    rows,
  };
}

async function previewSalesImport(buffer) {
  return summarize(await evaluateRows(buffer));
}

async function commitSalesImport(buffer) {
  const rows = await evaluateRows(buffer);
  const validRows = rows.filter((r) => r.status === 'valid');

  const sourceType = await repo.getExcelSourceType();
  const records = validRows.map((r) => ({
    storeId: r.storeId,
    salesDate: new Date(r.salesDate),
    amount: r.salesAmount,
    docket: r.docket,
    labourHours: r.labourHours,
    sourceTypeId: sourceType.id,
  }));

  const imported = await repo.insertRecords(records);

  return {
    total: rows.length,
    imported,
    skippedDuplicates: rows.filter((r) => r.status === 'duplicate').length,
    failed: rows.filter((r) => r.status === 'invalid').map((r) => ({ rowNumber: r.rowNumber, storeCode: r.storeCode, errors: r.errors })),
  };
}

module.exports = { previewSalesImport, commitSalesImport };
