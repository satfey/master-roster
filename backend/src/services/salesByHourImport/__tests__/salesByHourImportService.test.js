const ExcelJS = require('exceljs');

// Explicit factory (not automock) so the real module — which creates a
// Supabase client at require-time — is never loaded during tests.
jest.mock('../../../repositories/salesByHourRepository', () => ({
  findStoresByCodes: jest.fn(),
  createStores: jest.fn(),
  findExistingRecordKeys: jest.fn(),
  getSalesByHourSourceType: jest.fn(),
  insertRecords: jest.fn(),
  recordKey: jest.fn(),
}));
const repo = require('../../../repositories/salesByHourRepository');

const { previewSalesByHourImport, commitSalesByHourImport } = require('../salesByHourImportService');

const MONTH = '2026-07-01';

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
  ws.addRow(['Brand Name', 'Store Id', 'Store Name', 'Gross Sale', 'Hour']);
  for (const r of rows) ws.addRow(r);
  return wb.xlsx.writeBuffer();
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.findExistingRecordKeys.mockResolvedValue(new Set());
  repo.getSalesByHourSourceType.mockResolvedValue({ id: 'uuid-source-type' });
  repo.insertRecords.mockImplementation(async (records) => records.length);
  repo.recordKey.mockImplementation((storeId, month, hour) => `${storeId}|${month}|${hour}`);
});

describe('salesByHourImportService — the Excel Store ID becomes store.id directly (no random UUID)', () => {
  test('13. an unknown Store ID results in store.id = "1001" — no random UUID is generated', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([['ABC', 1001, 'ABC Central', 1150, 1]]);

    const result = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');

    expect(repo.createStores).toHaveBeenCalledTimes(1);
    expect(result.storesCreated).toHaveLength(1);
    expect(result.storesCreated[0].id).toBe('1001');
    expect(result.storesCreated[0]).toMatchObject({ storeCode: '1001', name: 'ABC Central' });
    expect(result.imported).toBe(1);
  });

  test('14. an existing Store ID reuses the existing store.id (no creation)', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'ABC Central' }]);
    const buffer = await buildWorkbook([['ABC', 1001, 'ABC Central', 1150, 1]]);

    const result = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');

    expect(repo.createStores).not.toHaveBeenCalled();
    expect(result.storesCreated).toEqual([]);
    const [records] = repo.insertRecords.mock.calls[0];
    expect(records[0].store_id).toBe('1001');
  });

  test('multiple rows with the same unknown Store ID create only ONE store', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([
      ['ABC', 1001, 'ABC Central', 1150, 1],
      [null, null, null, 1280, 9],
      [null, null, null, 1860, 10],
    ]);

    const result = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');

    expect(repo.createStores).toHaveBeenCalledTimes(1);
    expect(result.storesCreated).toHaveLength(1);
    const [records] = repo.insertRecords.mock.calls[0];
    expect(new Set(records.map((r) => r.store_id))).toEqual(new Set(['1001']));
  });

  test('re-importing Store ID 1001 updates/reuses the same row instead of creating a new one', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([['ABC', 1001, 'ABC Central', 1150, 1]]);

    const first = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');
    expect(first.storesCreated).toHaveLength(1);
    expect(first.storesCreated[0].id).toBe('1001');

    repo.findExistingRecordKeys.mockResolvedValueOnce(new Set(['1001|2026-07-01|1']));
    const second = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');

    expect(second.storesCreated).toHaveLength(0); // already exists — not recreated
    expect(repo.createStores).toHaveBeenCalledTimes(1); // called once total, across both imports
  });

  test('leading-zero Store IDs are preserved end to end (text cell, never round-tripped through Number())', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([['ABC', '001093', 'Leading Zero Store', 1150, 1]]);

    const preview = await previewSalesByHourImport(buffer, MONTH);
    expect(preview.rows[0].storeId).toBe('001093');

    const result = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');
    expect(result.storesCreated[0].id).toBe('001093');
  });

  test('a missing Store ID never generates a placeholder id and the row is not inserted', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([[null, null, null, 1150, 1]]);

    const preview = await previewSalesByHourImport(buffer, MONTH);
    expect(preview.rows[0].storeId).toBeNull();
    expect(preview.rows[0].status).toBe('invalid');

    const result = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');
    expect(result.imported).toBe(0);
    expect(repo.insertRecords).toHaveBeenCalledWith([]);
  });
});

describe('salesByHourImportService — payload correctness', () => {
  test('16. correct database payload: store_id is store.id (the source Store ID), report_store_id keeps the original integer, report_month/hour/gross_sale map correctly', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([['ABC', 1001, 'ABC Central', 1150, 9]]);

    const result = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');
    const [records] = repo.insertRecords.mock.calls[0];

    expect(records[0]).toMatchObject({
      store_id: '1001',
      report_store_id: 1001,
      brand_name: 'ABC',
      store_name: 'ABC Central',
      report_month: MONTH,
      hour: 9,
      gross_sale: 1150,
      source_type_id: 'uuid-source-type',
      entered_by: 'uuid-user-1',
    });
    expect(records[0].store_id).toBe(result.storesCreated[0].id);
  });
});

describe('salesByHourImportService — duplicate handling', () => {
  test('15. re-importing the same file for the same month does not duplicate records', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'ABC Central' }]);
    const buffer = await buildWorkbook([['ABC', 1001, 'ABC Central', 1150, 1]]);

    // First import: nothing exists yet.
    repo.findExistingRecordKeys.mockResolvedValueOnce(new Set());
    const first = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');
    expect(first.imported).toBe(1);
    expect(first.skippedDuplicates).toBe(0);

    // Second import of the SAME file/month: simulate the DB now having that record.
    repo.findExistingRecordKeys.mockResolvedValueOnce(new Set(['1001|2026-07-01|1']));
    const second = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');
    expect(second.imported).toBe(0);
    expect(second.skippedDuplicates).toBe(1);
  });

  test('duplicate rows within the SAME file (same store+hour twice) are only imported once', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'ABC Central' }]);
    const buffer = await buildWorkbook([
      ['ABC', 1001, 'ABC Central', 1150, 9],
      [null, null, null, 1400, 9], // same store, same hour, repeated
    ]);

    const result = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');
    expect(result.imported).toBe(1);
    expect(result.skippedDuplicates).toBe(1);
  });
});

describe('salesByHourImportService — API response: storeId is store.id, the canonical Store ID', () => {
  test('7. API returns storeId as the source Store ID string, not a UUID', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'ABC Central' }]);
    const buffer = await buildWorkbook([['ABC', 1001, 'ABC Central', 1150, 1]]);

    const preview = await previewSalesByHourImport(buffer, MONTH);

    expect(preview.rows[0].storeId).toBe('1001');
    expect(preview.rows[0].storeId).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i); // not UUID-shaped
  });

  test('multiple stores in one file each report their own storeId', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([
      ['ABC', 1001, 'ABC Central', 1150, 1],
      ['XYZ', 1002, 'XYZ North', 900, 1],
      ['DEF', 1003, 'DEF South', 700, 1],
    ]);

    const preview = await previewSalesByHourImport(buffer, MONTH);

    expect(preview.rows.map((r) => r.storeId)).toEqual(['1001', '1002', '1003']);
  });
});

describe('salesByHourImportService — preview never writes to the DB', () => {
  test('17. preview does not call createStores or insertRecords, even for an unknown Store ID', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([['ABC', 1001, 'ABC Central', 1150, 1]]);

    const preview = await previewSalesByHourImport(buffer, MONTH);

    expect(repo.createStores).not.toHaveBeenCalled();
    expect(repo.insertRecords).not.toHaveBeenCalled();
    expect(preview.rows[0].status).toBe('valid');
    expect(preview.rows[0].willCreateStore).toBe(true);
    expect(preview.newStoreCount).toBe(1);
  });

  test('preview reports totals/valid/invalid/duplicate rows correctly', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'ABC Central' }]);
    repo.findExistingRecordKeys.mockResolvedValue(new Set(['1001|2026-07-01|1']));
    const buffer = await buildWorkbook([
      ['ABC', 1001, 'ABC Central', 1150, 1], // duplicate vs DB
      [null, null, null, 1280, 9], // valid
      [null, null, null, 'bad', 10], // invalid gross sale
    ]);

    const preview = await previewSalesByHourImport(buffer, MONTH);
    expect(preview.totalRows).toBe(3);
    expect(preview.duplicateRows).toBe(1);
    expect(preview.validRows).toBe(1);
    expect(preview.invalidRows).toBe(1);
  });
});

describe('salesByHourImportService — commit actually inserts', () => {
  test('18. commit inserts only valid rows into sales_by_hour via insertRecords', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'ABC Central' }]);
    const buffer = await buildWorkbook([
      ['ABC', 1001, 'ABC Central', 1150, 1],
      [null, null, null, 'bad-value', 9], // invalid, should not be inserted
    ]);

    const result = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');

    expect(repo.insertRecords).toHaveBeenCalledTimes(1);
    const [records] = repo.insertRecords.mock.calls[0];
    expect(records).toHaveLength(1);
    expect(result.imported).toBe(1);
    expect(result.failed).toHaveLength(1);
  });

  test('a store-creation failure aborts the commit before any sales_by_hour rows are inserted', async () => {
    createFakeStoreTable([]);
    repo.createStores.mockRejectedValue(new Error('insert failed'));
    const buffer = await buildWorkbook([['ABC', 1001, 'ABC Central', 1150, 1]]);

    await expect(commitSalesByHourImport(buffer, MONTH, 'uuid-user-1')).rejects.toThrow('insert failed');
    expect(repo.insertRecords).not.toHaveBeenCalled();
  });
});
