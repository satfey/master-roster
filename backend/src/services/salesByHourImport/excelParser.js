const ExcelJS = require('exceljs');
const { resolveCellValue } = require('../salesImport/excelParser');

// Fixed report layout: column position (A-E), not header text.
const COLUMNS = ['brandName', 'reportStoreId', 'storeName', 'grossSale', 'hour'];

// Columns A-C repeat only on the first hour-row of each Store block (merged
// cells, or simply left blank on continuation rows) — carried forward from
// the last non-blank value seen in each column independently.
const GROUP_FIELDS = ['brandName', 'reportStoreId', 'storeName'];

// The report/title preamble above the data table varies in length per file,
// so the label row's position can't be assumed — detect it by content.
const HEADER_LABEL_HINTS = ['brand name', 'store id', 'store name', 'gross sale', 'hour'];

function isBlankValue(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function normalizedText(value) {
  return isBlankValue(value) ? '' : String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function rowMatchesHeaderLabels(row) {
  return HEADER_LABEL_HINTS.every((hint, i) => normalizedText(resolveCellValue(row.getCell(i + 1))).includes(hint));
}

/** Scans top to bottom for the row whose first 5 columns read "Brand Name", "Store Id", "Store Name", "Gross Sale", "Hour" — never assumes a fixed row number. */
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

function extractSalesByHourRows(worksheet, headerRowNumber) {
  const rows = [];
  const current = { brandName: null, reportStoreId: null, storeName: null };

  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);

    if (isRowBlank(row)) continue;

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

async function parseSalesByHourWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw Object.assign(new Error('The uploaded file has no worksheets'), { status: 400 });
  }

  const headerRowNumber = findHeaderRow(worksheet);
  if (headerRowNumber === null) {
    throw Object.assign(
      new Error('Could not find the sales by hour header row (expected columns like Brand Name, Store Id, Store Name, Gross Sale, Hour)'),
      { status: 400 },
    );
  }

  const rows = extractSalesByHourRows(worksheet, headerRowNumber);
  return { headerRowNumber, rows };
}

module.exports = { parseSalesByHourWorkbook };
