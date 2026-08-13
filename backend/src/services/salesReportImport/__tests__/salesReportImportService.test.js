const crypto = require('crypto');
const ExcelJS = require('exceljs');

// Explicit factory (not automock) so the real module — which creates a
// Supabase client at require-time — is never loaded during tests.
jest.mock('../../../repositories/salesReportRepository', () => ({
  findStoresByCodes: jest.fn(),
  createStores: jest.fn(),
  findExistingReportKeys: jest.fn(),
  getSalesReportSourceType: jest.fn(),
  insertRecords: jest.fn(),
  recordKey: jest.fn(),
}));
const repo = require('../../../repositories/salesReportRepository');

const { previewSalesReportImport, commitSalesReportImport } = require('../salesReportImportService');

/** In-memory fake `store` table keyed by storeCode — lets tests prove that a store created on one commit is found (not recreated) on a later one. */
function createFakeStoreTable(initial = []) {
  const byCode = new Map(initial.map((s) => [s.storeCode, s]));

  repo.findStoresByCodes.mockImplementation(async (codes) => {
    const map = new Map();
    for (const code of codes) if (byCode.has(code)) map.set(code, byCode.get(code));
    return map;
  });

  repo.createStores.mockImplementation(async (newStores) => {
    const created = newStores.map((s) => ({ id: crypto.randomUUID(), storeCode: s.storeCode, name: s.name, region: null, area_coach_id: null }));
    for (const store of created) byCode.set(store.storeCode, store);
    return created;
  });

  return byCode;
}

async function buildWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['Store BU Id', 'Store Id', 'Store Name', 'Week', 'Date', 'Gross Actual', 'Budget']);
  for (const r of rows) ws.addRow(r);
  return wb.xlsx.writeBuffer();
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.findExistingReportKeys.mockResolvedValue(new Set());
  repo.getSalesReportSourceType.mockResolvedValue({ id: 'uuid-source-type' });
  repo.insertRecords.mockImplementation(async (records) => records.length);
  repo.recordKey.mockImplementation((storeId, date) => {
    const iso = date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
    return `${storeId}|${iso}`;
  });
});

describe('salesReportImportService — dedup (unrelated to store creation)', () => {
  test('preview classifies rows as valid / duplicate (DB + in-file), using an already-existing store', async () => {
    createFakeStoreTable([{ id: 'uuid-1001', storeCode: '1001', name: 'A1001-A' }]);
    repo.findExistingReportKeys.mockResolvedValue(new Set(['uuid-1001|2026-07-01']));

    const buffer = await buildWorkbook([
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500], // duplicates existing DB record
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 2)), 11000, 9500], // valid
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 2)), 12000, 9500], // duplicates the row above, in-file
    ]);

    const preview = await previewSalesReportImport(buffer);

    expect(preview.totalRows).toBe(3);
    expect(preview.validRows).toBe(1);
    expect(preview.duplicateRows).toBe(2);
    expect(preview.invalidRows).toBe(0);
    expect(repo.createStores).not.toHaveBeenCalled();
  });

  test('a row missing required fields (Store Id, Date) is invalid', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([[30001, null, 'A1001-A', '2026-27', null, 10000, 9500]]);

    const preview = await previewSalesReportImport(buffer);

    expect(preview.invalidRows).toBe(1);
    expect(preview.rows[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('Store ID'), expect.stringContaining('Date')]));
  });
});

describe('salesReportImportService — store auto-creation on commit', () => {
  test('1. an existing Store ID uses the existing store.id (no creation)', async () => {
    createFakeStoreTable([{ id: 'uuid-1001', storeCode: '1001', name: 'Existing Name' }]);
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');

    expect(repo.createStores).not.toHaveBeenCalled();
    expect(result.storesCreated).toEqual([]);
    const [records] = repo.insertRecords.mock.calls[0];
    expect(records[0].store_id).toBe('uuid-1001');
  });

  test('2. an unknown Store ID automatically creates a store', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');

    expect(repo.createStores).toHaveBeenCalledTimes(1);
    expect(result.storesCreated).toHaveLength(1);
    expect(result.storesCreated[0]).toMatchObject({ storeCode: '1001', name: 'A1001-A' });
    expect(result.imported).toBe(1);
    expect(result.failed).toHaveLength(0);
  });

  test('3. multiple rows with the same unknown Store ID create only ONE store', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500],
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 2)), 11000, 9500],
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 3)), 12000, 9500],
    ]);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');

    expect(repo.createStores).toHaveBeenCalledTimes(1);
    expect(repo.createStores.mock.calls[0][0]).toEqual([{ storeCode: '1001', name: 'A1001-A' }]);
    expect(result.storesCreated).toHaveLength(1);
    expect(result.imported).toBe(3);

    const [records] = repo.insertRecords.mock.calls[0];
    expect(new Set(records.map((r) => r.store_id)).size).toBe(1); // all 3 rows reuse the same generated UUID
  });

  test('4. multiple different Stores in one workbook are all resolved/created correctly', async () => {
    createFakeStoreTable([{ id: 'uuid-1001', storeCode: '1001', name: 'Existing A' }]);
    const buffer = await buildWorkbook([
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500], // existing
      [30002, 2002, 'B2002-B', '2026-27', new Date(Date.UTC(2026, 6, 1)), 8000, 7500], // new
      [30003, 3003, 'C3003-C', '2026-27', new Date(Date.UTC(2026, 6, 1)), 6000, 5500], // new
    ]);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');

    expect(result.imported).toBe(3);
    expect(result.storesCreated).toHaveLength(2);
    expect(new Set(result.storesCreated.map((s) => s.storeCode))).toEqual(new Set(['2002', '3003']));

    const [records] = repo.insertRecords.mock.calls[0];
    const idFor = (code) => records.find((r) => r.report_store_id === code).store_id;
    expect(idFor(1001)).toBe('uuid-1001');
    expect(idFor(2002)).not.toBe(idFor(1001));
    expect(idFor(3003)).not.toBe(idFor(1001));
    expect(idFor(2002)).not.toBe(idFor(3003));
  });

  test('5 & 6. sales_report.store_id is the generated UUID; report_store_id keeps the original integer', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');
    const [records] = repo.insertRecords.mock.calls[0];

    expect(records[0].report_store_id).toBe(1001);
    expect(records[0].store_id).toBe(result.storesCreated[0].id);
    expect(records[0].store_id).not.toBe(1001);
  });

  test('7. the auto-created store uses the Store Name from Excel', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([[30001, 1001, 'My Excel Store Name', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');

    expect(result.storesCreated[0].name).toBe('My Excel Store Name');
  });

  test('8. re-importing the same Store ID in a later commit does not create a duplicate store', async () => {
    createFakeStoreTable([]);

    const buffer1 = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);
    const firstResult = await commitSalesReportImport(buffer1, 'uuid-user-1');
    expect(firstResult.storesCreated).toHaveLength(1);

    const buffer2 = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 2)), 11000, 9500]]);
    const secondResult = await commitSalesReportImport(buffer2, 'uuid-user-1');

    expect(secondResult.storesCreated).toHaveLength(0); // already exists — not recreated
    expect(repo.createStores).toHaveBeenCalledTimes(1); // called once total, across both imports
    const [, recordsSecond] = repo.insertRecords.mock.calls.map((c) => c[0]);
    expect(recordsSecond[0].store_id).toBe(firstResult.storesCreated[0].id); // same store reused
  });

  test('a store-creation failure aborts the commit before any sales_report rows are inserted', async () => {
    createFakeStoreTable([]);
    repo.createStores.mockRejectedValue(new Error('insert failed'));
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    await expect(commitSalesReportImport(buffer, 'uuid-user-1')).rejects.toThrow('insert failed');
    expect(repo.insertRecords).not.toHaveBeenCalled();
  });
});

describe('salesReportImportService — preview never writes to the DB', () => {
  test('preview never calls createStores, even for an unknown Store ID', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const preview = await previewSalesReportImport(buffer);

    expect(repo.createStores).not.toHaveBeenCalled();
    expect(preview.rows[0].status).toBe('valid'); // not invalid merely because the store doesn't exist yet
    expect(preview.rows[0].willCreateStore).toBe(true);
    expect(preview.newStoreCount).toBe(1);
  });

  test('preview does not flag an already-existing store as willCreateStore', async () => {
    createFakeStoreTable([{ id: 'uuid-1001', storeCode: '1001', name: 'Existing' }]);
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const preview = await previewSalesReportImport(buffer);

    expect(preview.rows[0].willCreateStore).toBe(false);
    expect(preview.newStoreCount).toBe(0);
  });
});
