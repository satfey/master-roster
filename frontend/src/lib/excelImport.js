import ExcelJS from "exceljs";

// Defense-in-depth: this runs in the user's own browser tab reading a file
// they picked themselves, but an oversized file can still hang the tab
// while exceljs loads the whole workbook into memory (no true streaming for
// the .xlsx zip format) — reject it before that happens.
export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_ROWS = 50_000;

/** Resolves a cell's displayed value, following formulas/rich text — exceljs equivalent of what XLSX.utils.sheet_to_json used to hand back: numbers/strings/Dates, never a raw formula or rich-text object. */
function resolveCellValue(cell) {
  const value = cell.value;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if ("result" in value) return value.result ?? null; // formula
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("text" in value) return value.text ?? null; // hyperlink-with-text
  }
  return value === undefined ? null : value;
}

function headerText(cell) {
  const value = resolveCellValue(cell);
  return value === null || value === undefined ? "" : String(value).trim();
}

/**
 * Reads the first worksheet of an .xlsx ArrayBuffer into an array of plain
 * objects keyed by the row-1 header text, with `null` for blank cells —
 * the same shape `XLSX.utils.sheet_to_json(sheet, { defval: null })`
 * produced, so existing callers (which do `Object.keys(row)` header
 * matching) need no changes beyond awaiting this instead of calling
 * `XLSX.read` synchronously.
 */
export async function readWorksheetAsObjects(arrayBuffer) {
  if (arrayBuffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File is too large (${(arrayBuffer.byteLength / (1024 * 1024)).toFixed(1)} MB) — the maximum supported size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Workbook has no worksheets");

  if (worksheet.rowCount > MAX_ROWS) {
    throw new Error(`Worksheet has too many rows (${worksheet.rowCount}) — the maximum supported is ${MAX_ROWS}.`);
  }

  const headerRow = worksheet.getRow(1);
  const lastColumn = Math.max(headerRow.cellCount, worksheet.columnCount);
  const headers = [];
  for (let col = 1; col <= lastColumn; col++) headers[col] = headerText(headerRow.getCell(col));

  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const obj = {};
    let hasValue = false;
    for (let col = 1; col <= lastColumn; col++) {
      const header = headers[col];
      if (!header) continue;
      const value = resolveCellValue(row.getCell(col));
      obj[header] = value;
      if (value !== null) hasValue = true;
    }
    if (hasValue) rows.push(obj);
  }

  return rows;
}
