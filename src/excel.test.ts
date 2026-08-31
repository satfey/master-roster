import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, test, expect, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import { readExcelRows, isRowEmpty } from './excel';

const tmpFiles: string[] = [];

function tmpXlsxPath(): string {
  const p = path.join(os.tmpdir(), `excel-test-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  tmpFiles.push(p);
  return p;
}

async function writeWorkbook(rows: unknown[][], { addSheet = true } = {}): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  if (addSheet) {
    const sheet = workbook.addWorksheet('Sheet1');
    for (const row of rows) sheet.addRow(row);
  }
  const filePath = tmpXlsxPath();
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

describe('readExcelRows (exceljs-backed, replaces the vulnerable xlsx package)', () => {
  test('parses headers and rows, preserving numbers, strings, and empty cells', async () => {
    const filePath = await writeWorkbook([
      ['Store ID', 'Store Name', 'Gross Actual', 'Notes'],
      [1001, 'Central Ladprao', 50000.5, null],
      [1002, 'Siam Paragon', 0, ''],
    ]);

    const { headers, rows } = await readExcelRows(filePath);

    expect(headers).toEqual(['Store ID', 'Store Name', 'Gross Actual', 'Notes']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([1001, 'Central Ladprao', 50000.5, null]);
    expect(rows[1][0]).toBe(1002);
    expect(rows[1][2]).toBe(0); // a falsy-but-valid number must not become null
  });

  test('a genuinely date-formatted cell comes back as a native Date object', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['Date']);
    const row = sheet.addRow([new Date(Date.UTC(2026, 6, 9))]);
    row.getCell(1).numFmt = 'yyyy-mm-dd';
    const filePath = tmpXlsxPath();
    await workbook.xlsx.writeFile(filePath);

    const { rows } = await readExcelRows(filePath);

    expect(rows[0][0]).toBeInstanceOf(Date);
    expect((rows[0][0] as Date).toISOString().slice(0, 10)).toBe('2026-07-09');
  });

  test('an empty row is reported as empty by isRowEmpty', async () => {
    const filePath = await writeWorkbook([
      ['A', 'B'],
      [null, null],
      ['x', 'y'],
    ]);

    const { rows } = await readExcelRows(filePath);

    expect(isRowEmpty(rows[0])).toBe(true);
    expect(isRowEmpty(rows[1])).toBe(false);
  });

  test('a missing file throws a clear error', async () => {
    await expect(readExcelRows('/no/such/file.xlsx')).rejects.toThrow(/File not found/);
  });

  test('a workbook with no worksheets throws "Workbook has no sheets"', async () => {
    const filePath = await writeWorkbook([], { addSheet: false });

    await expect(readExcelRows(filePath)).rejects.toThrow(/Workbook has no sheets/);
  });

  test('a header row that is entirely blank still parses without throwing — header validity is the caller\'s concern, not the reader\'s', async () => {
    const filePath = await writeWorkbook([
      [null, null, null],
      [1, 2, 3],
    ]);

    const { headers, rows } = await readExcelRows(filePath);

    expect(headers).toEqual(['', '', '']);
    expect(rows).toEqual([[1, 2, 3]]);
  });

  test('a file over the configured size limit is rejected before being parsed', async () => {
    const filePath = await writeWorkbook([['A'], [1]]);
    const realStat = fs.statSync(filePath);

    await expect(readExcelRows(filePath, { maxFileSizeBytes: realStat.size - 1 })).rejects.toThrow(/too large/);
  });

  test('a worksheet over the configured row limit is rejected before being fully read', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => [i]);
    const filePath = await writeWorkbook([['ID'], ...rows]);

    await expect(readExcelRows(filePath, { maxRows: 10 })).rejects.toThrow(/too many rows/);
  });

  test('a moderately large worksheet (5,000 rows) parses correctly and quickly — no unbounded CPU/memory blowup', async () => {
    const bigRows = Array.from({ length: 5000 }, (_, i) => [i, `Store ${i}`, i * 1.5]);
    const filePath = await writeWorkbook([['ID', 'Name', 'Sales'], ...bigRows]);

    const start = Date.now();
    const { rows } = await readExcelRows(filePath);
    const elapsedMs = Date.now() - start;

    expect(rows).toHaveLength(5000);
    expect(rows[4999][0]).toBe(4999);
    expect(elapsedMs).toBeLessThan(10_000); // generous bound — this is a "doesn't hang", not a micro-benchmark, assertion
  });
});
