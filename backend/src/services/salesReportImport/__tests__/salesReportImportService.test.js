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

/**
 * In-memory fake `store` table keyed by id — the Excel Store ID IS store.id
 * now, so a store created on one commit is found (not recreated) on a
 * later one just by matching that same id, no separate UUID involved.
 */
function createFakeStoreTable(initial = []) {
  const byId = new Map(initial.map((s) => [s.id, s]));

  repo.findStoresByCodes.mockImplementation(async (codes) => {
    const map = new Map();
    for (const code of codes) if (byId.has(code)) map.set(code, byId.get(code));
    return map;
  });

  repo.createStores.mockImplementation(async (newStores) => {
    const created = newStores.map((s) => ({ id: s.storeCode, storeCode: s.storeCode, name: s.name, region: null, area_coach_id: null }));
    for (const store of created) byId.set(store.id, store);
    return created;
  });

  return byId;
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
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'A1001-A' }]);
    repo.findExistingReportKeys.mockResolvedValue(new Set(['1001|2026-07-01']));

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

  test('9. a missing Store ID never generates a placeholder id and the row is not inserted', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([[30001, null, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const preview = await previewSalesReportImport(buffer);
    expect(preview.rows[0].storeId).toBeNull();

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');
    expect(result.imported).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(repo.insertRecords).toHaveBeenCalledWith([]);
  });
});

describe('salesReportImportService — the Excel Store ID becomes store.id directly (no random UUID)', () => {
  test('1. an existing Store ID uses the existing store.id (no creation)', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'Existing Name' }]);
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');

    expect(repo.createStores).not.toHaveBeenCalled();
    expect(result.storesCreated).toEqual([]);
    const [records] = repo.insertRecords.mock.calls[0];
    expect(records[0].store_id).toBe('1001');
  });

  test('2. Store ID 1001 results in store.id = "1001" — no random UUID is generated', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');

    expect(repo.createStores).toHaveBeenCalledTimes(1);
    expect(repo.createStores.mock.calls[0][0]).toEqual([{ storeCode: '1001', name: 'A1001-A' }]);
    expect(result.storesCreated).toHaveLength(1);
    expect(result.storesCreated[0].id).toBe('1001');
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
    expect(result.storesCreated).toHaveLength(1);
    expect(result.imported).toBe(3);

    const [records] = repo.insertRecords.mock.calls[0];
    expect(new Set(records.map((r) => r.store_id))).toEqual(new Set(['1001'])); // all 3 rows reference the same store.id
  });

  test('4. multiple different Stores (2002 vs 1001) create separate rows, never colliding', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'Existing A' }]);
    const buffer = await buildWorkbook([
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500], // existing
      [30002, 2002, 'B2002-B', '2026-27', new Date(Date.UTC(2026, 6, 1)), 8000, 7500], // new
      [30003, 3003, 'C3003-C', '2026-27', new Date(Date.UTC(2026, 6, 1)), 6000, 5500], // new
    ]);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');

    expect(result.imported).toBe(3);
    expect(result.storesCreated).toHaveLength(2);
    expect(new Set(result.storesCreated.map((s) => s.id))).toEqual(new Set(['2002', '3003']));

    const [records] = repo.insertRecords.mock.calls[0];
    const idFor = (code) => records.find((r) => r.report_store_id === code).store_id;
    expect(idFor(1001)).toBe('1001');
    expect(idFor(2002)).toBe('2002');
    expect(idFor(3003)).toBe('3003');
  });

  test('5. sales_report.store_id is store.id (the source Store ID, as a string) — never a UUID', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');
    const [records] = repo.insertRecords.mock.calls[0];

    expect(records[0].report_store_id).toBe(1001); // integer column, unchanged
    expect(records[0].store_id).toBe('1001'); // FK — the string Store ID, IS store.id
    expect(records[0].store_id).toBe(result.storesCreated[0].id);
  });

  test('10. leading-zero Store IDs are preserved end to end (text cell, never round-tripped through Number())', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([[30001, '001093', 'Leading Zero Store', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const preview = await previewSalesReportImport(buffer);
    expect(preview.rows[0].storeId).toBe('001093');

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');
    expect(result.storesCreated[0].id).toBe('001093');
    const [records] = repo.insertRecords.mock.calls[0];
    expect(records[0].store_id).toBe('001093');
  });

  test('7. the auto-created store uses the Store Name from Excel', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([[30001, 1001, 'My Excel Store Name', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');

    expect(result.storesCreated[0].name).toBe('My Excel Store Name');
  });

  test('3 (upsert). re-importing Store ID 1001 in a later commit updates the same row instead of creating a new one', async () => {
    createFakeStoreTable([]);

    const buffer1 = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);
    const firstResult = await commitSalesReportImport(buffer1, 'uuid-user-1');
    expect(firstResult.storesCreated).toHaveLength(1);
    expect(firstResult.storesCreated[0].id).toBe('1001');

    const buffer2 = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 2)), 11000, 9500]]);
    const secondResult = await commitSalesReportImport(buffer2, 'uuid-user-1');

    expect(secondResult.storesCreated).toHaveLength(0); // already exists — not recreated
    expect(repo.createStores).toHaveBeenCalledTimes(1); // called once total, across both imports
    const [, recordsSecond] = repo.insertRecords.mock.calls.map((c) => c[0]);
    expect(recordsSecond[0].store_id).toBe('1001'); // same store.id reused, still no UUID anywhere
  });

  test('a store-creation failure aborts the commit before any sales_report rows are inserted', async () => {
    createFakeStoreTable([]);
    repo.createStores.mockRejectedValue(new Error('insert failed'));
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    await expect(commitSalesReportImport(buffer, 'uuid-user-1')).rejects.toThrow('insert failed');
    expect(repo.insertRecords).not.toHaveBeenCalled();
  });
});

describe('salesReportImportService — API response: storeId is store.id, the canonical Store ID', () => {
  test('7. API returns storeId as the source Store ID string, not a UUID', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'A1001-A' }]);
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const preview = await previewSalesReportImport(buffer);

    expect(preview.rows[0].storeId).toBe('1001');
    expect(preview.rows[0].storeId).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i); // not UUID-shaped
  });

  test('multiple stores in one file each report their own storeId', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500],
      [30002, 1002, 'B1002-B', '2026-27', new Date(Date.UTC(2026, 6, 1)), 8000, 7500],
      [30003, 1003, 'C1003-C', '2026-27', new Date(Date.UTC(2026, 6, 1)), 6000, 5500],
    ]);

    const preview = await previewSalesReportImport(buffer);

    expect(preview.rows.map((r) => r.storeId)).toEqual(['1001', '1002', '1003']);
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
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'Existing' }]);
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const preview = await previewSalesReportImport(buffer);

    expect(preview.rows[0].willCreateStore).toBe(false);
    expect(preview.newStoreCount).toBe(0);
  });
});
