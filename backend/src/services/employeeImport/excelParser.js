const ExcelJS = require('exceljs');
const { resolveCellValue } = require('../salesImport/excelParser');

// Header text (normalized: trimmed, lowercased, whitespace-collapsed) ->
// canonical field name. Matched by exact header name, not column position —
// the real file has hundreds of columns in an arbitrary order; anything not
// listed here is silently ignored, and these 20 are found wherever they are.
const HEADER_TO_FIELD = {
  'employee id': 'employeeId',
  'legal name - title': 'title',
  'legal name - first name': 'firstName',
  'legal name - last name': 'lastName',
  'first name - local': 'firstNameLocal',
  'last name - local': 'lastNameLocal',
  'email - primary home': 'email',
  'position title': 'position',
  'position time type': 'positionTimeType',
  location: 'storeName',
  'default weekly hours': 'defaultWeeklyHours',
  'pay rate type': 'payRateType',
  'sl comp plan': 'slCompPlan',
  'sl comp amount': 'slCompAmount',
  'sl comp currency': 'slCompCurrency',
  'sl comp frequency': 'slCompFrequency',
  'hr comp plan': 'hrCompPlan',
  'hr comp amount': 'hrCompAmount',
  'hr comp currency': 'hrCompCurrency',
  'hr comp frequency': 'hrCompFrequency',
};

// The header row is only recognized once the one truly required column is
// present — keeps a stray "Employee ID"-shaped cell elsewhere on the sheet
// from being misread as the header row.
const REQUIRED_HEADER_FIELDS = ['employeeId'];

function isBlankValue(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function normalizedHeader(value) {
  return isBlankValue(value) ? '' : String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Builds { colNumber -> canonicalField } for a candidate header row; null if it doesn't qualify. Column order/position is never assumed. */
function detectColumnMap(row) {
  const columnMap = {};
  const usedFields = new Set();
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const field = HEADER_TO_FIELD[normalizedHeader(resolveCellValue(cell))];
    if (field && !usedFields.has(field)) {
      columnMap[colNumber] = field;
      usedFields.add(field);
    }
  });

  const hasRequired = REQUIRED_HEADER_FIELDS.every((f) => usedFields.has(f));
  return hasRequired ? { columnMap, usedFields } : null;
}

/** Scans top to bottom for the row containing an "Employee ID" column (among possibly hundreds of other columns) — never assumes a fixed row number. */
function findHeaderRow(worksheet) {
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const candidate = detectColumnMap(worksheet.getRow(rowNumber));
    if (candidate) return { headerRowNumber: rowNumber, columnMap: candidate.columnMap };
  }
  return null;
}

function isRowBlank(row, columnMap) {
  for (const colNumber of Object.keys(columnMap)) {
    if (!isBlankValue(resolveCellValue(row.getCell(Number(colNumber))))) return false;
  }
  return true;
}

function extractEmployeeRows(worksheet, headerRowNumber, columnMap) {
  const rows = [];

  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    if (isRowBlank(row, columnMap)) continue;

    const raw = { rowNumber };
    for (const [colNumber, field] of Object.entries(columnMap)) {
      raw[field] = resolveCellValue(row.getCell(Number(colNumber)));
    }
    rows.push(raw);
  }

  return rows;
}

async function parseEmployeeMasterWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw Object.assign(new Error('The uploaded file has no worksheets'), { status: 400 });
  }

  const found = findHeaderRow(worksheet);
  if (!found) {
    throw Object.assign(
      new Error('Could not find the Employee Master header row (expected a column named "Employee ID")'),
      { status: 400 },
    );
  }

  const rows = extractEmployeeRows(worksheet, found.headerRowNumber, found.columnMap);
  return { headerRowNumber: found.headerRowNumber, rows };
}

module.exports = { parseEmployeeMasterWorkbook, HEADER_TO_FIELD };
