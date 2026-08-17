const ExcelJS = require('exceljs');
const { resolveCellValue } = require('../salesImport/excelParser');

// Fixed report layout: column position (A-D).
const COLUMNS = ['effectiveDate', 'id', 'branch', 'zoneUpdate'];

// The header row's position varies per file, so it's detected by content
// instead of assumed. Exact match (not substring) since "ID" is short enough
// that a substring match would false-positive on unrelated header text.
const HEADER_LABELS = ['effective date', 'id', 'branch', 'zone update'];

function isBlankValue(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function normalizedText(value) {
  return isBlankValue(value) ? '' : String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function rowMatchesHeaderLabels(row) {
  return HEADER_LABELS.every((label, i) => normalizedText(resolveCellValue(row.getCell(i + 1))) === label);
}

/** Scans top to bottom for the row whose first 4 columns read "Effective Date", "ID", "BRANCH", "Zone Update" — never assumes a fixed row number. */
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

function extractStoreMasterRows(worksheet, headerRowNumber) {
  const rows = [];

  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    if (isRowBlank(row)) continue;

    const raw = { rowNumber };
    COLUMNS.forEach((field, i) => { raw[field] = resolveCellValue(row.getCell(i + 1)); });
    rows.push(raw);
  }

  return rows;
}

async function parseStoreMasterWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw Object.assign(new Error('The uploaded file has no worksheets'), { status: 400 });
  }

  const headerRowNumber = findHeaderRow(worksheet);
  if (headerRowNumber === null) {
    throw Object.assign(
      new Error('Could not find the store master header row (expected columns Effective Date, ID, BRANCH, Zone Update)'),
      { status: 400 },
    );
  }

  const rows = extractStoreMasterRows(worksheet, headerRowNumber);
  return { headerRowNumber, rows };
}

module.exports = { parseStoreMasterWorkbook };
