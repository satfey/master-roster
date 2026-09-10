import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, test, expect, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import { buildPreview } from './importer';

const HEADERS = [
  'Store BU Id', 'Store Id', 'Store Name', 'Week', 'Date',
  'Gross Actual', 'Budget', 'Gross Variance %',
  'Gross Actual LY', 'Gross LY Variance %',
  'Gross Actual MTD', 'Budget MTD', 'Gross MTD Variance %',
  'Gross Actual LY MTD',
  'Docket Actual', 'Docket Budget', 'Docket Variance %',
  'Docket Actual LY', 'Docket LY Variance %',
  'Customer Actual', 'Customer Budget', 'Customer Variance %',
  'Customer Actual LY', 'Customer LY Variance %',
  'Other Sales', 'Service Charge',
];

const tmpFiles: string[] = [];

async function writeWorkbook(rows: unknown[][]): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(HEADERS);
  for (const row of rows) sheet.addRow(row);
  const filePath = path.join(os.tmpdir(), `importer-test-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  tmpFiles.push(filePath);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

describe('buildPreview — end-to-end through the exceljs-backed reader (behavior preserved from the xlsx-based version)', () => {
  test('a fully valid row is classified "valid"', async () => {
    const filePath = await writeWorkbook([[30001, 1001, 'Central Ladprao', 30, new Date(Date.UTC(2026, 6, 9)), 50000]]);

    const preview = await buildPreview(filePath);

    expect(preview).toHaveLength(1);
    expect(preview[0].status).toBe('valid');
    expect(preview[0].errors).toEqual([]);
    expect(preview[0].data?.storeId).toBe(1001);
    expect(preview[0].data?.date).toBe('2026-07-09');
  });

  test('a row missing the required Store ID and Date columns is classified "invalid" with clear error messages', async () => {
    const filePath = await writeWorkbook([[30001, null, 'Central Ladprao', 30, null, 50000]]);

    const preview = await buildPreview(filePath);

    expect(preview[0].status).toBe('invalid');
    expect(preview[0].errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Store ID'), expect.stringContaining('Date')])
    );
  });

  test('a fully blank row is skipped, not treated as invalid', async () => {
    const filePath = await writeWorkbook([
      [30001, 1001, 'Central Ladprao', 30, new Date(Date.UTC(2026, 6, 9)), 50000],
      [null, null, null, null, null, null],
    ]);

    const preview = await buildPreview(filePath);

    expect(preview[0].status).toBe('valid');
    expect(preview[1].status).toBe('skipped');
  });

  test('a workbook with no data rows at all (header only) produces an empty, non-throwing preview', async () => {
    const filePath = await writeWorkbook([]);

    const preview = await buildPreview(filePath);

    expect(preview).toEqual([]);
  });
});
