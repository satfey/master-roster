import * as fs from 'fs';
import ExcelJS from 'exceljs';

export interface ExcelData {
  headers: string[];
  rows: unknown[][];
}

// Defense-in-depth bounds — this tool reads a locally-supplied file (not a
// web upload), but an oversized/absurdly-wide file is still worth rejecting
// up front rather than parsing it fully into memory first. exceljs loads a
// whole .xlsx into memory (no true streaming for the OOXML zip format), so
// the file-size cap is what actually bounds worst-case memory/CPU here.
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_ROWS = 200_000;

/** Resolves a cell's displayed value, following merges/formulas/rich text — exceljs equivalent of what xlsx's `cellDates: true` + raw cell access gave us: native Date objects for date-formatted cells, plain numbers/strings otherwise. */
function resolveCellValue(cell: ExcelJS.Cell): unknown {
  if (cell.type === ExcelJS.ValueType.Merge) {
    return resolveCellValue((cell as unknown as { master: ExcelJS.Cell }).master);
  }
  const value = cell.value;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('result' in value) return (value as { result: unknown }).result ?? null; // formula
    if ('richText' in value) return (value as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join(''); // rich text
    if ('text' in value) return (value as { text: unknown }).text ?? null; // hyperlink-with-text
  }
  return value;
}

export interface ReadExcelRowsOptions {
  maxFileSizeBytes?: number;
  maxRows?: number;
}

export async function readExcelRows(filePath: string, options: ReadExcelRowsOptions = {}): Promise<ExcelData> {
  const { maxFileSizeBytes = MAX_FILE_SIZE_BYTES, maxRows = MAX_ROWS } = options;

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const { size } = fs.statSync(filePath);
  if (size > maxFileSizeBytes) {
    throw new Error(`File is too large (${(size / (1024 * 1024)).toFixed(1)} MB) — the maximum supported size is ${maxFileSizeBytes / (1024 * 1024)} MB.`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('Workbook has no sheets');

  if (worksheet.rowCount > maxRows) {
    throw new Error(`Worksheet has too many rows (${worksheet.rowCount}) — the maximum supported is ${maxRows}.`);
  }

  const headerRow = worksheet.getRow(1);
  const lastColumn = Math.max(headerRow.cellCount, worksheet.columnCount);
  const headers: string[] = [];
  for (let col = 1; col <= lastColumn; col++) {
    const value = resolveCellValue(headerRow.getCell(col));
    headers.push(value === null || value === undefined ? '' : String(value).trim());
  }

  const rows: unknown[][] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const rawRow: unknown[] = [];
    for (let col = 1; col <= lastColumn; col++) {
      const value = resolveCellValue(row.getCell(col));
      rawRow.push(value === undefined ? null : value);
    }
    rows.push(rawRow);
  }

  return { headers, rows };
}

export function isRowEmpty(row: unknown[]): boolean {
  return !row || row.every((cell) => cell === null || cell === undefined || String(cell).trim() === '');
}
