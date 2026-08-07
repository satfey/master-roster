import * as fs from 'fs';
import * as XLSX from 'xlsx';

export interface ExcelData {
  headers: string[];
  rows: unknown[][];
}

export function readExcelRows(filePath: string): ExcelData {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Workbook has no sheets');

  const sheet = workbook.Sheets[sheetName];
  const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });

  const [headerRow, ...dataRows] = allRows;
  const headers = (headerRow ?? []).map((cell) => (cell === null || cell === undefined ? '' : String(cell).trim()));

  return { headers, rows: dataRows };
}

export function isRowEmpty(row: unknown[]): boolean {
  return !row || row.every((cell) => cell === null || cell === undefined || String(cell).trim() === '');
}
