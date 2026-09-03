const ExcelJS = require('exceljs');
const { resolveCellValue } = require('../salesImport/excelParser');

/**
 * WHR Target is a wide monthly planning workbook (confirmed against the real
 * file: 1 sheet, ~14 used rows x ~215 used columns) — not a simple one-
 * header-row report like Sales Report. Rows above the real header are an
 * "ASSUMPTION & DATA LOOKUP" section and weekday-name lookup tables used by
 * the sheet's own formulas; the real per-store table starts at whichever row
 * has "TYPE" in column 1 and "CODE" in column 2 (found by scanning, not
 * assumed to be a fixed row number, matching storeMasterImport/
 * salesReportImport's findHeaderRow convention — this file's header row
 * happens to be row 12, but nothing here hardcodes that).
 *
 * Fixed report layout below that header row (column position, not header
 * text — same convention as storeMasterImport.js/salesReportImport.js,
 * confirmed against the real file's column layout):
 *   1: TYPE (unused)              6: CONFIRM DOCKET FOR MONITOR (unused)
 *   2: CODE  -> store_id          8: PRODUCTIVITY -> monthly productivity
 *   3: SALES -> monthly sales     9: CPLH (unused)
 *   4: DOCKET (unused)           10: COG (BAHT) -> monthly COG
 *   5: TA (unused)
 *  13: Store Name (a second, denormalized store-lookup block starting at
 *      column 12 sits alongside the same row) -> store_name
 *
 * WHRS is NOT read from column 7 ("ORIGINAL" section) despite that column
 * literally being labeled WHRS — live-tested against a real 265-store file
 * and found to have only 17 distinct values across all of them (a budget/
 * lookup figure keyed to store TYPE, confirmed by the business: it's the
 * ORIGINAL/target section, not actual results). The real "hours actually
 * used" figure lives in a separate "WHRS (OPS)" section further right
 * (confirmed real position: column 84 in that same file, immediately
 * before that section's own daily-date columns) — genuinely distinct
 * per store there. Its column position isn't hardcoded, though (unlike the
 * block-1 fields above): the real file's total width/section layout can
 * plausibly shift between months (a 30- vs 31-day month changes how many
 * daily columns each section spans), so this is located the same way the
 * header row itself is — scanning for its label, one row above the header,
 * where "PRODUCTIVITY"/"COG"/etc.'s super-headers also live (see
 * findWhrsOpsColumn) — rather than assumed to always be column 84.
 *
 * The reporting month is never hardcoded — it's read from the workbook's own
 * "PERIOD" cell (confirmed real position: column 12 label, column 13 value
 * on a row above the header), the same "derive month from the file, don't
 * assume it" principle Sales-by-Hour Import already follows (there it's a
 * caller-supplied form field instead, because that file has no in-sheet
 * period marker; here the sheet has one, so that's used directly).
 */
const HEADER_SCAN_MAX_ROW = 60; // generous bound — the real file's header is at row 9-12 depending on the month; this tolerates a reasonably larger assumption/lookup section above it without scanning the whole (potentially huge) daily-data area below
const COLUMNS = {
  type: 1,
  storeCode: 2,
  monthlySales: 3,
  productivity: 8,
  cog: 10,
  storeNameRaw: 13,
};

function normalizedText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return '';
  if (typeof value === 'object' && value.text) return String(value.text).trim().toLowerCase();
  return String(value).trim().toLowerCase();
}

/** The row whose column 1/2 read "type"/"code" — the real per-store table's header, wherever it actually is in this file. */
function findHeaderRow(worksheet) {
  for (let rowNumber = 1; rowNumber <= Math.min(HEADER_SCAN_MAX_ROW, worksheet.rowCount); rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const col1 = normalizedText(resolveCellValue(row.getCell(1)));
    const col2 = normalizedText(resolveCellValue(row.getCell(2)));
    if (col1 === 'type' && col2 === 'code') return rowNumber;
  }
  return null;
}

/** Scans above the header row for a cell reading "period" (any trailing whitespace); the reporting month is the value immediately to its right — never a fixed/hardcoded month. */
function findPeriodDate(worksheet, headerRowNumber) {
  for (let rowNumber = 1; rowNumber < headerRowNumber; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    for (let colNumber = 1; colNumber <= 30; colNumber++) {
      if (normalizedText(resolveCellValue(row.getCell(colNumber))) === 'period') {
        return resolveCellValue(row.getCell(colNumber + 1));
      }
    }
  }
  return null;
}

/**
 * Finds the "actual hours used" WHRS column: the one whose super-header
 * (the row directly above the TYPE/CODE header row, same row "PRODUCTIVITY"/
 * "COG"/etc. live on) reads "WHRS (OPS)" — confirmed the real, per-store-
 * varying figure (see the module comment above for why column 7's literal
 * "WHRS" label is NOT this — it's a budget/target column instead). Matched
 * on "whrs" + "ops" both being present (case-insensitive) rather than an
 * exact string, so incidental spacing/casing differences between files
 * don't break it, while still not accidentally matching the file's other
 * WHRS-labeled sections ("WHRS AUTO CALCULATE", "WHR PORTION" — neither
 * contains "ops").
 */
function findWhrsOpsColumn(worksheet, headerRowNumber) {
  const superHeaderRow = worksheet.getRow(headerRowNumber - 1);
  for (let colNumber = 1; colNumber <= worksheet.columnCount; colNumber++) {
    const text = normalizedText(resolveCellValue(superHeaderRow.getCell(colNumber)));
    if (text.includes('whrs') && text.includes('ops')) return colNumber;
  }
  return null;
}

function isRowBlankAtColumns(row, columnNumbers) {
  return columnNumbers.every((c) => {
    const v = resolveCellValue(row.getCell(c));
    return v === null || v === undefined || String(v).trim() === '';
  });
}

/**
 * Extracts raw per-store rows below the header, stopping at the end of the
 * real data table (2 consecutive fully-blank rows, or 5 consecutive rows
 * with no CODE, whichever comes first — same footer/blank-run heuristic as
 * salesImport/excelParser.js, since this file has the same "real data table
 * embedded in a much larger sheet" shape).
 */
function extractWhrTargetRows(worksheet, headerRowNumber, whrsOpsColumn) {
  const rows = [];
  let consecutiveNonDataRows = 0;
  const lastRowNumber = worksheet.rowCount;
  const trackedColumns = [...Object.values(COLUMNS), whrsOpsColumn];

  for (let rowNumber = headerRowNumber + 1; rowNumber <= lastRowNumber; rowNumber++) {
    const row = worksheet.getRow(rowNumber);

    if (isRowBlankAtColumns(row, trackedColumns)) {
      consecutiveNonDataRows++;
      if (consecutiveNonDataRows >= 2) break;
      continue;
    }

    const storeCode = resolveCellValue(row.getCell(COLUMNS.storeCode));
    if (storeCode === null || storeCode === undefined || String(storeCode).trim() === '') {
      consecutiveNonDataRows++;
      if (consecutiveNonDataRows >= 5) break;
      continue;
    }

    consecutiveNonDataRows = 0;
    rows.push({
      rowNumber,
      type: resolveCellValue(row.getCell(COLUMNS.type)),
      storeCode,
      monthlySales: resolveCellValue(row.getCell(COLUMNS.monthlySales)),
      whrs: resolveCellValue(row.getCell(whrsOpsColumn)),
      productivity: resolveCellValue(row.getCell(COLUMNS.productivity)),
      cog: resolveCellValue(row.getCell(COLUMNS.cog)),
      storeNameRaw: resolveCellValue(row.getCell(COLUMNS.storeNameRaw)),
    });
  }

  return rows;
}

async function parseWhrTargetWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw Object.assign(new Error('The uploaded file has no worksheets'), { status: 400 });
  }

  const headerRowNumber = findHeaderRow(worksheet);
  if (headerRowNumber === null) {
    throw Object.assign(new Error('Could not find the WHR Target header row (expected "TYPE" in column A and "CODE" in column B)'), { status: 400 });
  }

  const periodDate = findPeriodDate(worksheet, headerRowNumber);
  if (!(periodDate instanceof Date)) {
    throw Object.assign(new Error('Could not find the WHR Target reporting month (expected a "PERIOD" cell with a date to its right, above the header row)'), { status: 400 });
  }

  const whrsOpsColumn = findWhrsOpsColumn(worksheet, headerRowNumber);
  if (whrsOpsColumn === null) {
    throw Object.assign(new Error('Could not find the "WHRS (OPS)" column (expected in the row directly above the header row)'), { status: 400 });
  }

  const rows = extractWhrTargetRows(worksheet, headerRowNumber, whrsOpsColumn);
  return { headerRowNumber, periodDate, rows };
}

module.exports = { parseWhrTargetWorkbook, findHeaderRow, findPeriodDate, findWhrsOpsColumn };
