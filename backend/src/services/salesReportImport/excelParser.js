const ExcelJS = require('exceljs');
const { resolveCellValue } = require('../salesImport/excelParser');

// Fixed report layout: column position (A-Z), not header text.
const COLUMNS = [
  'storeBuId', 'reportStoreId', 'storeName', 'week', 'reportDate',
  'grossActual', 'grossBudget', 'grossVariancePercent',
  'grossActualLy', 'grossLyVariancePercent',
  'grossActualMtd', 'grossBudgetMtd', 'grossMtdVariancePercent',
  'grossActualLyMtd',
  'docketActual', 'docketBudget', 'docketVariancePercent',
  'docketActualLy', 'docketLyVariancePercent',
  'customerActual', 'customerBudget', 'customerVariancePercent',
  'customerActualLy', 'customerLyVariancePercent',
  'otherSales', 'serviceCharge',
];

// Columns A-D repeat only on the first day of each Store/Week block (merged
// cells, or simply left blank on continuation rows) — carried forward from
// the last non-blank value seen in each column independently.
const GROUP_FIELDS = ['storeBuId', 'reportStoreId', 'storeName', 'week'];

// The report/KPI section above the data table varies in length per file, so
// the label row's position can't be assumed — detect it by content instead.
const HEADER_LABEL_HINTS = ['store bu', 'store id', 'store name', 'week', 'date'];

function isBlankValue(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function normalizedText(value) {
  return isBlankValue(value) ? '' : String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function rowMatchesHeaderLabels(row) {
  return HEADER_LABEL_HINTS.every((hint, i) => normalizedText(resolveCellValue(row.getCell(i + 1))).includes(hint));
}

/** Scans top to bottom for the row whose first 5 columns read "Store BU Id", "Store Id", "Store Name", "Week", "Date" — never assumes a fixed row number. */
function findHeaderRow(worksheet) {
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    if (rowMatchesHeaderLabels(worksheet.getRow(rowNumber))) return rowNumber;
  }
  return null;
}

function isRowBlank(row) {
  for (let i = 1; i <= COLUMNS.length; i++) {
    if (!isBlankValue(resolveCellValue(row.getCell(i)))) return false;
  }
  return true;
}

/** Store/Week Total rows carry an aggregate label (e.g. "2026-27 Total", "A1001-A Total") instead of a daily date. The label's column isn't fixed, so every mapped column is checked. */
function rowIsTotalRow(row) {
  for (let i = 1; i <= COLUMNS.length; i++) {
    const value = resolveCellValue(row.getCell(i));
    if (!isBlankValue(value) && /total/i.test(String(value))) return true;
  }
  return false;
}

function extractSalesReportRows(worksheet, headerRowNumber) {
  const rows = [];
  const current = { storeBuId: null, reportStoreId: null, storeName: null, week: null };

  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);

    if (isRowBlank(row)) continue;
    if (rowIsTotalRow(row)) continue; // aggregate row — must never mutate the carry-forward state

    GROUP_FIELDS.forEach((field, i) => {
      const value = resolveCellValue(row.getCell(i + 1));
      if (!isBlankValue(value)) current[field] = value;
    });

    const raw = { rowNumber };
    GROUP_FIELDS.forEach((field) => { raw[field] = current[field]; });
    for (let i = GROUP_FIELDS.length; i < COLUMNS.length; i++) {
      raw[COLUMNS[i]] = resolveCellValue(row.getCell(i + 1));
    }
    rows.push(raw);
  }

  return rows;
}

async function parseSalesReportWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw Object.assign(new Error('The uploaded file has no worksheets'), { status: 400 });
  }

  const headerRowNumber = findHeaderRow(worksheet);
  if (headerRowNumber === null) {
    throw Object.assign(
      new Error('Could not find the sales report header row (expected columns like Store BU Id, Store Id, Store Name, Week, Date)'),
      { status: 400 },
    );
  }

  const rows = extractSalesReportRows(worksheet, headerRowNumber);
  return { headerRowNumber, rows };
}

module.exports = { parseSalesReportWorkbook };
