const ExcelJS = require('exceljs');

// Column headers we look for on the one row that starts the real data table.
// Keys are canonical field names; values are header text patterns (matched
// case-insensitively, substring match so "SALES AMOUNT" matches "SALES").
const HEADER_PATTERNS = {
  storeCode: ['CODE'],
  type: ['TYPE'],
  salesAmount: ['SALES'],
  docket: ['DOCKET'],
  salesDate: ['DATE'],
  labourHours: ['LABOUR HOUR', 'LABOR HOUR', 'LABOUR HRS', 'LABOR HRS'],
};

// A row only counts as the header row once at least this many of the
// required columns are present — keeps us from matching a stray cell in a
// KPI/assumption section that happens to contain one of these words.
const REQUIRED_HEADER_FIELDS = ['storeCode', 'salesAmount'];

/** Resolves a cell's displayed value, following merges and formula results. */
function resolveCellValue(cell) {
  if (cell.type === ExcelJS.ValueType.Merge) {
    return resolveCellValue(cell.master);
  }
  if (cell.type === ExcelJS.ValueType.Formula) {
    const result = cell.value && typeof cell.value === 'object' ? cell.value.result : undefined;
    return result !== undefined ? result : null;
  }
  return cell.value;
}

function cellText(cell) {
  const value = resolveCellValue(cell);
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value.text) return String(value.text); // rich text
  return String(value).trim();
}

function matchHeaderField(headerText) {
  const upper = headerText.toUpperCase();
  for (const [field, patterns] of Object.entries(HEADER_PATTERNS)) {
    if (patterns.some((p) => upper.includes(p))) return field;
  }
  return null;
}

/** Builds { colNumber -> canonicalField } for a candidate header row; null if it doesn't qualify. */
function detectColumnMap(row) {
  const columnMap = {};
  const usedFields = new Set();
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const field = matchHeaderField(cellText(cell));
    if (field && !usedFields.has(field)) {
      columnMap[colNumber] = field;
      usedFields.add(field);
    }
  });

  const hasRequired = REQUIRED_HEADER_FIELDS.every((f) => usedFields.has(f));
  return hasRequired ? columnMap : null;
}

function isRowBlank(row) {
  let blank = true;
  row.eachCell({ includeEmpty: false }, (cell) => {
    if (cellText(cell) !== '') blank = false;
  });
  return blank;
}

/**
 * Scans a worksheet top to bottom for the one row whose headers match the
 * expected sales columns (TYPE / CODE / SALES / DOCKET / ...), ignoring the
 * report title, KPI/assumption sections, and summary blocks above and below
 * it. Returns the raw data rows below that header, stopping at the first
 * blank row (or a run of rows with no store code, which marks the footer).
 */
function extractSalesRows(worksheet) {
  let columnMap = null;
  let headerRowNumber = null;

  worksheet.eachRow((row, rowNumber) => {
    if (columnMap) return;
    const candidate = detectColumnMap(row);
    if (candidate) {
      columnMap = candidate;
      headerRowNumber = rowNumber;
    }
  });

  if (!columnMap) {
    throw Object.assign(new Error('Could not find a sales data table (expected columns like TYPE, CODE, SALES, DOCKET)'), {
      status: 400,
    });
  }

  const rows = [];
  let consecutiveNonDataRows = 0;
  // worksheet.rowCount is the last row *number* with any content; actualRowCount
  // is a *count* of non-empty rows and would truncate the scan early whenever
  // rows are sparse (e.g. blank separator rows above the data table).
  const lastRowNumber = worksheet.rowCount;

  for (let rowNumber = headerRowNumber + 1; rowNumber <= lastRowNumber; rowNumber++) {
    const row = worksheet.getRow(rowNumber);

    if (isRowBlank(row)) {
      consecutiveNonDataRows++;
      if (consecutiveNonDataRows >= 2) break; // end of table
      continue;
    }

    const raw = { rowNumber };
    for (const [colNumber, field] of Object.entries(columnMap)) {
      raw[field] = resolveCellValue(row.getCell(Number(colNumber)));
    }

    // Rows with no store code are treated as sub-headers/footer notes, not data.
    if (raw.storeCode === null || raw.storeCode === undefined || String(raw.storeCode).trim() === '') {
      consecutiveNonDataRows++;
      if (consecutiveNonDataRows >= 5) break; // ran into the footer, stop scanning
      continue;
    }

    consecutiveNonDataRows = 0;
    rows.push(raw);
  }

  return { headerRowNumber, rows };
}

async function parseSalesWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw Object.assign(new Error('The uploaded file has no worksheets'), { status: 400 });
  }

  return extractSalesRows(worksheet);
}

module.exports = { parseSalesWorkbook, resolveCellValue };
