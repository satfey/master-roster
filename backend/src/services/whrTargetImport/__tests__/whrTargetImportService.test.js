const ExcelJS = require('exceljs');

jest.mock('../../../repositories/whrTargetRepository', () => ({
  findStoresByCodes: jest.fn(),
  getWhrTargetSourceType: jest.fn(),
  findExistingRecordKeys: jest.fn(),
  upsertRecords: jest.fn(),
  recordKey: jest.fn(),
}));
const repo = require('../../../repositories/whrTargetRepository');

const { previewWhrTargetImport, commitWhrTargetImport } = require('../whrTargetImportService');

/**
 * Same fixed-column layout as excelParser.test.js — mirrors the real file's confirmed
 * structure. WHRS is written to a "WHRS (OPS)" super-headed column (84, matching the real
 * file), not the budget "WHRS" column (7) — see excelParser.js's module comment for why.
 */
async function buildWorkbook(dataRows, { periodDate = new Date(Date.UTC(2026, 6, 1)) } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['ASSUMPTION & DATA LOOKUP']);
  const periodRow = ws.addRow([]);
  periodRow.getCell(12).value = 'PERIOD  ';
  periodRow.getCell(13).value = periodDate;
  const superHeaderRow = ws.addRow([]);
  superHeaderRow.getCell(84).value = 'WHRS (OPS)';
  const headerRow = ws.addRow([]);
  headerRow.getCell(1).value = 'TYPE';
  headerRow.getCell(2).value = 'CODE';
  headerRow.getCell(3).value = 'SALES';
  headerRow.getCell(7).value = 'WHRS';
  headerRow.getCell(10).value = 'BAHT';
  headerRow.getCell(12).value = 'Code';
  headerRow.getCell(13).value = 'Store Name';
  headerRow.getCell(84).value = 'WHRS';

  for (const row of dataRows) {
    const r = ws.addRow([]);
    r.getCell(1).value = 'EQ';
    r.getCell(2).value = row.storeCode;
    r.getCell(3).value = row.monthlySales;
    r.getCell(7).value = 999999; // the budget column — an obviously-wrong value, to prove it's never read
    r.getCell(8).value = row.productivity;
    r.getCell(10).value = row.cog;
    r.getCell(13).value = row.storeNameRaw;
    r.getCell(84).value = row.whrs;
  }

  return wb.xlsx.writeBuffer();
}

function createFakeStoreTable(storeIds) {
  const storeMap = new Map(storeIds.map((id) => [id, { id, name: `Store ${id}` }]));
  repo.findStoresByCodes.mockResolvedValue(storeMap);
  return storeMap;
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.findExistingRecordKeys.mockResolvedValue(new Set());
  repo.getWhrTargetSourceType.mockResolvedValue({ id: 'uuid-source-type' });
  repo.upsertRecords.mockImplementation(async (records) => records.length);
  repo.recordKey.mockImplementation((storeId, month) => `${storeId}|${month}`);
});

describe('whrTargetImportService — month comes from the file (never hardcoded)', () => {
  test('the reportMonth in preview/commit results matches the workbook\'s own PERIOD cell', async () => {
    createFakeStoreTable(['1001']);
    const buffer = await buildWorkbook([{ storeCode: 1001, monthlySales: 500000, whrs: 620, productivity: 190, cog: 100000, storeNameRaw: 'Store A' }], {
      periodDate: new Date(Date.UTC(2026, 9, 1)), // October
    });

    const preview = await previewWhrTargetImport(buffer);
    expect(preview.reportMonth).toBe('2026-10-01');

    const result = await commitWhrTargetImport(buffer, 'uuid-user-1');
    expect(result.reportMonth).toBe('2026-10-01');
  });
});

describe('whrTargetImportService — preview classifies new / update / invalid / duplicate_in_file', () => {
  test('a store not yet in whr_target_monthly for this month previews as "new"', async () => {
    createFakeStoreTable(['1001']);
    const buffer = await buildWorkbook([{ storeCode: 1001, monthlySales: 500000, whrs: 620, productivity: 190, cog: 100000, storeNameRaw: 'Store A' }]);

    const preview = await previewWhrTargetImport(buffer);

    expect(preview.rows[0].status).toBe('new');
    expect(preview.newRows).toBe(1);
    expect(preview.storeCount).toBe(1);
  });

  test('a store already in whr_target_monthly for this exact month previews as "update"', async () => {
    createFakeStoreTable(['1001']);
    repo.findExistingRecordKeys.mockResolvedValue(new Set(['1001|2026-07-01']));
    const buffer = await buildWorkbook([{ storeCode: 1001, monthlySales: 500000, whrs: 620, productivity: 190, cog: 100000, storeNameRaw: 'Store A' }]);

    const preview = await previewWhrTargetImport(buffer);

    expect(preview.rows[0].status).toBe('update');
    expect(preview.updateRows).toBe(1);
  });

  test('an unknown store CODE (no matching store) is invalid, never auto-created', async () => {
    createFakeStoreTable([]); // no stores exist
    const buffer = await buildWorkbook([{ storeCode: 9999, monthlySales: 500000, whrs: 620, productivity: 190, cog: 100000, storeNameRaw: 'Ghost Store' }]);

    const preview = await previewWhrTargetImport(buffer);

    expect(preview.rows[0].status).toBe('invalid');
    expect(preview.rows[0].errors.some((e) => e.includes('Unknown store CODE'))).toBe(true);
    expect(preview.invalidRows).toBe(1);
  });

  test('a COG > 33% row is invalid and counted in cogOverLimitRows, with a clear reason', async () => {
    createFakeStoreTable(['1001']);
    const buffer = await buildWorkbook([{ storeCode: 1001, monthlySales: 500000, whrs: 620, productivity: 190, cog: 200000, storeNameRaw: 'Store A' }]);

    const preview = await previewWhrTargetImport(buffer);

    expect(preview.rows[0].status).toBe('invalid');
    expect(preview.cogOverLimitRows).toBe(1);
    expect(preview.rows[0].errors[0]).toMatch(/33%/);
  });

  test('13. the same store CODE repeated within one file resolves to the last occurrence — earlier ones are duplicate_in_file', async () => {
    createFakeStoreTable(['1001']);
    const buffer = await buildWorkbook([
      { storeCode: 1001, monthlySales: 400000, whrs: 600, productivity: 180, cog: 80000, storeNameRaw: 'Store A (old)' },
      { storeCode: 1001, monthlySales: 500000, whrs: 620, productivity: 190, cog: 100000, storeNameRaw: 'Store A (new)' },
    ]);

    const preview = await previewWhrTargetImport(buffer);

    expect(preview.rows[0].status).toBe('duplicate_in_file');
    expect(preview.rows[1].status).toBe('new'); // last occurrence wins
    expect(preview.rows[1].monthlySales).toBe(500000);
    expect(preview.duplicateInFileRows).toBe(1);
  });
});

describe('whrTargetImportService — commit writes only new/update rows, with the exact mapped fields', () => {
  test('writes store_id, whrs, productivity, cog, sales, cog_percent, and store_name to the DB payload', async () => {
    createFakeStoreTable(['1001']);
    const buffer = await buildWorkbook([{ storeCode: 1001, monthlySales: 500000, whrs: 620, productivity: 190.5, cog: 100000, storeNameRaw: '1001 Store Name ABC' }]);

    await commitWhrTargetImport(buffer, 'uuid-user-1');

    const [records] = repo.upsertRecords.mock.calls[0];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      store_id: '1001',
      report_month: '2026-07-01',
      whrs: 620,
      productivity: 190.5,
      cog: 100000,
      sales: 500000,
      cog_percent: 0.2,
      store_name: 'Store Name ABC', // leading "1001 " stripped, name preserved
      entered_by: 'uuid-user-1',
    });
  });

  test('an invalid row (COG > 33%) is never written, and is reported in `failed`', async () => {
    createFakeStoreTable(['1001', '1002']);
    const buffer = await buildWorkbook([
      { storeCode: 1001, monthlySales: 500000, whrs: 620, productivity: 190, cog: 100000, storeNameRaw: 'Store A' }, // valid: 20%
      { storeCode: 1002, monthlySales: 500000, whrs: 620, productivity: 190, cog: 200000, storeNameRaw: 'Store B' }, // invalid: 40%
    ]);

    const result = await commitWhrTargetImport(buffer, 'uuid-user-1');

    expect(result.imported).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ storeId: '1002' });
    const [records] = repo.upsertRecords.mock.calls[0];
    expect(records).toHaveLength(1);
    expect(records[0].store_id).toBe('1001');
  });

  test('14. re-importing the same store+month is reported as an update, not rejected as a duplicate', async () => {
    createFakeStoreTable(['1001']);
    repo.findExistingRecordKeys.mockResolvedValue(new Set(['1001|2026-07-01']));
    const buffer = await buildWorkbook([{ storeCode: 1001, monthlySales: 550000, whrs: 630, productivity: 195, cog: 110000, storeNameRaw: 'Store A' }]);

    const result = await commitWhrTargetImport(buffer, 'uuid-user-1');

    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.failed).toHaveLength(0);
  });

  test('duplicate_in_file rows are never written and are reported in skippedDuplicatesInFile', async () => {
    createFakeStoreTable(['1001']);
    const buffer = await buildWorkbook([
      { storeCode: 1001, monthlySales: 400000, whrs: 600, productivity: 180, cog: 80000, storeNameRaw: 'Store A (old)' },
      { storeCode: 1001, monthlySales: 500000, whrs: 620, productivity: 190, cog: 100000, storeNameRaw: 'Store A (new)' },
    ]);

    const result = await commitWhrTargetImport(buffer, 'uuid-user-1');

    expect(result.imported).toBe(1);
    expect(result.skippedDuplicatesInFile).toBe(1);
    const [records] = repo.upsertRecords.mock.calls[0];
    expect(records[0].sales).toBe(500000); // the winning (last) occurrence's data
  });
});
