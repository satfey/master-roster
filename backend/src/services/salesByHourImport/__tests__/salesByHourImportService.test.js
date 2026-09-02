const ExcelJS = require('exceljs');

// Explicit factory (not automock) so the real module — which creates a
// Supabase client at require-time — is never loaded during tests.
jest.mock('../../../repositories/salesByHourRepository', () => ({
  findStoresByCodes: jest.fn(),
  createStores: jest.fn(),
  findExistingRecordKeys: jest.fn(),
  getSalesByHourSourceType: jest.fn(),
  upsertRecords: jest.fn(),
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
  repo.upsertRecords.mockImplementation(async (records) => records.length);
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
    const [records] = repo.upsertRecords.mock.calls[0];
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
    const [records] = repo.upsertRecords.mock.calls[0];
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
    expect(repo.upsertRecords).toHaveBeenCalledWith([]);
  });
});

describe('salesByHourImportService — payload correctness', () => {
  test('16. correct database payload: store_id is store.id (the source Store ID), report_store_id keeps the original integer, report_month/hour/gross_sale map correctly', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([['ABC', 1001, 'ABC Central', 1150, 9]]);

    const result = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');
    const [records] = repo.upsertRecords.mock.calls[0];

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

describe('salesByHourImportService — upsert business rule: an existing (store_id, report_month, hour) is UPDATEd, never rejected', () => {
  // Regression guard: this used to INSERT unconditionally and reject an existing key as a
  // "duplicate" (skipped, not written) — re-importing a corrected report then crashed with a real
  // 23505 unique-violation on (store_id, report_month, hour), since the plain insert conflicted
  // with the row already on file. Upsert makes re-importing the same store/month/hour overwrite
  // cleanly, the same convention Sales Report Import already uses.
  test('15. re-importing the same file for the same month UPDATEs the existing row instead of being rejected', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'ABC Central' }]);
    const buffer = await buildWorkbook([['ABC', 1001, 'ABC Central', 1150, 1]]);

    // First import: nothing exists yet.
    repo.findExistingRecordKeys.mockResolvedValueOnce(new Set());
    const first = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');
    expect(first.imported).toBe(1);
    expect(first.inserted).toBe(1);
    expect(first.updated).toBe(0);

    // Second import of the SAME file/month: simulate the DB now having that record.
    repo.findExistingRecordKeys.mockResolvedValueOnce(new Set(['1001|2026-07-01|1']));
    const second = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');
    expect(second.imported).toBe(1); // still written — as an UPDATE, not skipped
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(1);
    expect(repo.upsertRecords).toHaveBeenLastCalledWith([expect.objectContaining({ store_id: '1001', hour: 1 })]);
  });

  test('a row whose (store_id, report_month, hour) already exists in DB is classified update, not rejected as a duplicate', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'ABC Central' }]);
    repo.findExistingRecordKeys.mockResolvedValue(new Set(['1001|2026-07-01|1']));
    const buffer = await buildWorkbook([['ABC', 1001, 'ABC Central', 9999, 1]]);

    const preview = await previewSalesByHourImport(buffer, MONTH);

    expect(preview.rows[0].status).toBe('update');
    expect(preview.updateRows).toBe(1);
    expect(preview.newRows).toBe(0);
  });

  test('duplicate rows within the SAME file (same store+hour twice) still collapse to a single write — the last occurrence wins', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'ABC Central' }]);
    const buffer = await buildWorkbook([
      ['ABC', 1001, 'ABC Central', 1150, 9],
      [null, null, null, 1400, 9], // same store, same hour, repeated — this is the winning value
    ]);

    const result = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');

    expect(result.imported).toBe(1);
    expect(result.skippedDuplicatesInFile).toBe(1);
    const [records] = repo.upsertRecords.mock.calls[0];
    expect(records[0].gross_sale).toBe(1400); // the later row in the file, not the earlier 1150
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
  test('17. preview does not call createStores or upsertRecords, even for an unknown Store ID', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([['ABC', 1001, 'ABC Central', 1150, 1]]);

    const preview = await previewSalesByHourImport(buffer, MONTH);

    expect(repo.createStores).not.toHaveBeenCalled();
    expect(repo.upsertRecords).not.toHaveBeenCalled();
    expect(preview.rows[0].status).toBe('new');
    expect(preview.rows[0].willCreateStore).toBe(true);
    expect(preview.newStoreCount).toBe(1);
  });

  test('preview reports totals/new/update/invalid/duplicate-in-file rows correctly', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'ABC Central' }]);
    repo.findExistingRecordKeys.mockResolvedValue(new Set(['1001|2026-07-01|1']));
    const buffer = await buildWorkbook([
      ['ABC', 1001, 'ABC Central', 1150, 1], // already exists in DB -> update
      [null, null, null, 1280, 9], // new
      [null, null, null, 'bad', 10], // invalid gross sale
    ]);

    const preview = await previewSalesByHourImport(buffer, MONTH);
    expect(preview.totalRows).toBe(3);
    expect(preview.updateRows).toBe(1);
    expect(preview.newRows).toBe(1);
    expect(preview.validRows).toBe(2);
    expect(preview.invalidRows).toBe(1);
    expect(preview.duplicateInFileRows).toBe(0);
  });
});

describe('salesByHourImportService — commit actually inserts', () => {
  test('18. commit inserts only valid rows into sales_by_hour via upsertRecords', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'ABC Central' }]);
    const buffer = await buildWorkbook([
      ['ABC', 1001, 'ABC Central', 1150, 1],
      [null, null, null, 'bad-value', 9], // invalid, should not be inserted
    ]);

    const result = await commitSalesByHourImport(buffer, MONTH, 'uuid-user-1');

    expect(repo.upsertRecords).toHaveBeenCalledTimes(1);
    const [records] = repo.upsertRecords.mock.calls[0];
    expect(records).toHaveLength(1);
    expect(result.imported).toBe(1);
    expect(result.failed).toHaveLength(1);
  });

  test('a store-creation failure aborts the commit before any sales_by_hour rows are inserted', async () => {
    createFakeStoreTable([]);
    repo.createStores.mockRejectedValue(new Error('insert failed'));
    const buffer = await buildWorkbook([['ABC', 1001, 'ABC Central', 1150, 1]]);

    await expect(commitSalesByHourImport(buffer, MONTH, 'uuid-user-1')).rejects.toThrow('insert failed');
    expect(repo.upsertRecords).not.toHaveBeenCalled();
  });
});
