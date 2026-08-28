const ExcelJS = require('exceljs');

// Explicit factory (not automock) so the real module — which creates a
// Supabase client at require-time — is never loaded during tests.
jest.mock('../../../repositories/salesReportRepository', () => ({
  findStoresByCodes: jest.fn(),
  createStores: jest.fn(),
  findExistingReportKeys: jest.fn(),
  getSalesReportSourceType: jest.fn(),
  upsertRecords: jest.fn(),
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
  repo.upsertRecords.mockImplementation(async (records) => records.length);
  repo.recordKey.mockImplementation((storeId, date) => {
    const iso = date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
    return `${storeId}|${iso}`;
  });
});

describe('salesReportImportService — dedup (unrelated to store creation)', () => {
  test('preview classifies rows as new / update (DB) / duplicate_in_file (within the upload), using an already-existing store', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'A1001-A' }]);
    repo.findExistingReportKeys.mockResolvedValue(new Set(['1001|2026-07-01']));

    const buffer = await buildWorkbook([
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500], // already exists in DB -> update
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 2)), 11000, 9500], // superseded by the row below (same key)
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 2)), 12000, 9500], // last occurrence for this key -> new
    ]);

    const preview = await previewSalesReportImport(buffer);

    expect(preview.totalRows).toBe(3);
    expect(preview.updateRows).toBe(1);
    expect(preview.newRows).toBe(1);
    expect(preview.duplicateInFileRows).toBe(1);
    expect(preview.validRows).toBe(2); // newRows + updateRows — total that will actually be written
    expect(preview.invalidRows).toBe(0);
    expect(repo.createStores).not.toHaveBeenCalled();
  });

  test('a row missing required fields (Store Id, Date) is invalid', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([[30001, null, 'A1001-A', '2026-27', null, 10000, 9500]]);

    const preview = await previewSalesReportImport(buffer);

    expect(preview.invalidRows).toBe(1);
    expect(preview.previewRows[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('Store ID'), expect.stringContaining('Date')]));
  });

  test('9. a missing Store ID never generates a placeholder id and the row is not inserted', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([[30001, null, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const preview = await previewSalesReportImport(buffer);
    expect(preview.previewRows[0].storeId).toBeNull();

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');
    expect(result.imported).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(repo.upsertRecords).toHaveBeenCalledWith([]);
  });
});

describe('salesReportImportService — the Excel Store ID becomes store.id directly (no random UUID)', () => {
  test('1. an existing Store ID uses the existing store.id (no creation)', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'Existing Name' }]);
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');

    expect(repo.createStores).not.toHaveBeenCalled();
    expect(result.storesCreated).toEqual([]);
    const [records] = repo.upsertRecords.mock.calls[0];
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

    const [records] = repo.upsertRecords.mock.calls[0];
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

    const [records] = repo.upsertRecords.mock.calls[0];
    const idFor = (code) => records.find((r) => r.report_store_id === code).store_id;
    expect(idFor(1001)).toBe('1001');
    expect(idFor(2002)).toBe('2002');
    expect(idFor(3003)).toBe('3003');
  });

  test('5. sales_report.store_id is store.id (the source Store ID, as a string) — never a UUID', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');
    const [records] = repo.upsertRecords.mock.calls[0];

    expect(records[0].report_store_id).toBe(1001); // integer column, unchanged
    expect(records[0].store_id).toBe('1001'); // FK — the string Store ID, IS store.id
    expect(records[0].store_id).toBe(result.storesCreated[0].id);
  });

  test('10. leading-zero Store IDs are preserved end to end (text cell, never round-tripped through Number())', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([[30001, '001093', 'Leading Zero Store', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const preview = await previewSalesReportImport(buffer);
    expect(preview.previewRows[0].storeId).toBe('001093');

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');
    expect(result.storesCreated[0].id).toBe('001093');
    const [records] = repo.upsertRecords.mock.calls[0];
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
    const [, recordsSecond] = repo.upsertRecords.mock.calls.map((c) => c[0]);
    expect(recordsSecond[0].store_id).toBe('1001'); // same store.id reused, still no UUID anywhere
  });

  test('a store-creation failure aborts the commit before any sales_report rows are inserted', async () => {
    createFakeStoreTable([]);
    repo.createStores.mockRejectedValue(new Error('insert failed'));
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    await expect(commitSalesReportImport(buffer, 'uuid-user-1')).rejects.toThrow('insert failed');
    expect(repo.upsertRecords).not.toHaveBeenCalled();
  });
});

describe('salesReportImportService — API response: storeId is store.id, the canonical Store ID', () => {
  test('7. API returns storeId as the source Store ID string, not a UUID', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'A1001-A' }]);
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const preview = await previewSalesReportImport(buffer);

    expect(preview.previewRows[0].storeId).toBe('1001');
    expect(preview.previewRows[0].storeId).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i); // not UUID-shaped
  });

  test('multiple stores in one file each report their own storeId', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500],
      [30002, 1002, 'B1002-B', '2026-27', new Date(Date.UTC(2026, 6, 1)), 8000, 7500],
      [30003, 1003, 'C1003-C', '2026-27', new Date(Date.UTC(2026, 6, 1)), 6000, 5500],
    ]);

    const preview = await previewSalesReportImport(buffer);

    expect(preview.previewRows.map((r) => r.storeId)).toEqual(['1001', '1002', '1003']);
  });
});

describe('salesReportImportService — preview never writes to the DB', () => {
  test('preview never calls createStores, even for an unknown Store ID', async () => {
    createFakeStoreTable([]);
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const preview = await previewSalesReportImport(buffer);

    expect(repo.createStores).not.toHaveBeenCalled();
    expect(preview.previewRows[0].status).toBe('new'); // not invalid merely because the store doesn't exist yet
    expect(preview.previewRows[0].willCreateStore).toBe(true);
    expect(preview.newStoreCount).toBe(1);
  });

  test('preview does not flag an already-existing store as willCreateStore', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'Existing' }]);
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1)), 10000, 9500]]);

    const preview = await previewSalesReportImport(buffer);

    expect(preview.previewRows[0].willCreateStore).toBe(false);
    expect(preview.newStoreCount).toBe(0);
  });
});

describe('salesReportImportService — preview payload is capped, never the full file', () => {
  test('a file with more rows than the preview limit reports the true totalRows but caps previewRows', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'A1001-A' }]);
    const manyRows = Array.from({ length: 250 }, (_, i) =>
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1) + i * 86400000), 10000 + i, 9500]
    );
    const buffer = await buildWorkbook(manyRows);

    const preview = await previewSalesReportImport(buffer);

    expect(preview.totalRows).toBe(250); // the real, full count is still reported
    expect(preview.previewRows.length).toBeLessThan(250); // but the array actually sent back is capped
    expect(preview.previewRowCount).toBe(preview.previewRows.length);
  });

  test('invalid rows are never dropped by the cap, even in a large file — a preview must always surface problems', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'A1001-A' }]);
    const validRows = Array.from({ length: 250 }, (_, i) =>
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1) + i * 86400000), 10000 + i, 9500]
    );
    const invalidRow = [30001, null, 'A1001-A', '2026-27', null, 10000, 9500]; // missing Store Id + Date
    const buffer = await buildWorkbook([...validRows, invalidRow]);

    const preview = await previewSalesReportImport(buffer);

    expect(preview.invalidRows).toBe(1);
    expect(preview.previewRows.some((r) => r.status === 'invalid')).toBe(true);
  });

  test('commit still evaluates and inserts every row, unaffected by the preview cap', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'A1001-A' }]);
    const manyRows = Array.from({ length: 250 }, (_, i) =>
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 1) + i * 86400000), 10000 + i, 9500]
    );
    const buffer = await buildWorkbook(manyRows);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');

    expect(result.total).toBe(250);
    expect(result.imported).toBe(250);
  });
});

describe('salesReportImportService — upsert business rule: an existing (store_id, report_date) is UPDATEd, never rejected', () => {
  test('a row not present in DB is classified new and written', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'A1001-A' }]);
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 9)), 10000, 9500]]);

    const preview = await previewSalesReportImport(buffer);
    expect(preview.previewRows[0].status).toBe('new');
    expect(preview.newRows).toBe(1);
    expect(preview.updateRows).toBe(0);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');
    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.failed).toHaveLength(0);
    expect(repo.upsertRecords).toHaveBeenCalledTimes(1);
  });

  test('a row whose (store_id, report_date) already exists in DB is classified update, not rejected as a duplicate', async () => {
    createFakeStoreTable([{ id: '1108', storeCode: '1108', name: 'Store 1108' }]);
    repo.findExistingReportKeys.mockResolvedValue(new Set(['1108|2026-07-09']));
    const buffer = await buildWorkbook([[30001, 1108, 'Store 1108', '2026-27', new Date(Date.UTC(2026, 6, 9)), 20000, 9500]]);

    const preview = await previewSalesReportImport(buffer);
    expect(preview.previewRows[0].status).toBe('update');
    expect(preview.updateRows).toBe(1);
    expect(preview.invalidRows).toBe(0);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.failed).toHaveLength(0); // no 500, no rejection — it's a normal write
  });

  test('an updated row carries the NEW file values into the write, not stale ones — the file is the source of truth', async () => {
    createFakeStoreTable([{ id: '1108', storeCode: '1108', name: 'Store 1108' }]);
    repo.findExistingReportKeys.mockResolvedValue(new Set(['1108|2026-07-09']));
    const buffer = await buildWorkbook([[30001, 1108, 'Store 1108', '2026-27', new Date(Date.UTC(2026, 6, 9)), 99999, 88888]]);

    await commitSalesReportImport(buffer, 'uuid-user-1');

    const [records] = repo.upsertRecords.mock.calls[0];
    expect(records[0].gross_actual).toBe(99999);
    expect(records[0].gross_budget).toBe(88888);
  });

  test('a file mixing new and already-existing rows writes both correctly in one upsert call', async () => {
    createFakeStoreTable([
      { id: '1108', storeCode: '1108', name: 'Store 1108' },
      { id: '1109', storeCode: '1109', name: 'Store 1109' },
    ]);
    repo.findExistingReportKeys.mockResolvedValue(new Set(['1108|2026-07-09']));
    const buffer = await buildWorkbook([
      [30001, 1108, 'Store 1108', '2026-27', new Date(Date.UTC(2026, 6, 9)), 20000, 9500], // update
      [30002, 1109, 'Store 1109', '2026-27', new Date(Date.UTC(2026, 6, 10)), 15000, 8000], // new
    ]);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');

    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(1);
    expect(repo.upsertRecords).toHaveBeenCalledTimes(1);
    const [records] = repo.upsertRecords.mock.calls[0];
    expect(records).toHaveLength(2);
  });

  test('two rows in the same file for the same (store, date) are collapsed to a single write — the last one', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'A1001-A' }]);
    const buffer = await buildWorkbook([
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 9)), 10000, 9500],
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 9)), 77777, 9500], // later row wins
    ]);

    const preview = await previewSalesReportImport(buffer);
    expect(preview.duplicateInFileRows).toBe(1);
    expect(preview.newRows).toBe(1);

    const result = await commitSalesReportImport(buffer, 'uuid-user-1');
    expect(repo.upsertRecords).toHaveBeenCalledTimes(1);
    const [records] = repo.upsertRecords.mock.calls[0];
    expect(records).toHaveLength(1); // only one write for this key, never two
    expect(records[0].gross_actual).toBe(77777); // the later row's data, not the earlier one's
    expect(result.skippedDuplicatesInFile).toBe(1);
  });

  test('resolving in-file duplicates is deterministic — the same file always picks the same winner', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'A1001-A' }]);
    const buffer = await buildWorkbook([
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 9)), 1, 9500],
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 9)), 2, 9500],
      [30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 9)), 3, 9500],
    ]);

    const winnerValue = (preview) => preview.previewRows.find((r) => r.status === 'new').grossActual;
    expect(winnerValue(await previewSalesReportImport(buffer))).toBe(3); // last occurrence always wins
    expect(winnerValue(await previewSalesReportImport(buffer))).toBe(3); // same result, run again on the same file
  });

  test('the write payload always carries a fresh updated_at and never carries created_at, whether inserting or updating', async () => {
    createFakeStoreTable([{ id: '1108', storeCode: '1108', name: 'Store 1108' }]);
    repo.findExistingReportKeys.mockResolvedValue(new Set(['1108|2026-07-09']));
    const buffer = await buildWorkbook([
      [30001, 1108, 'Store 1108', '2026-27', new Date(Date.UTC(2026, 6, 9)), 20000, 9500], // update
      [30002, 1109, 'Store 1109', '2026-27', new Date(Date.UTC(2026, 6, 10)), 15000, 8000], // new
    ]);

    await commitSalesReportImport(buffer, 'uuid-user-1');

    const [records] = repo.upsertRecords.mock.calls[0];
    for (const record of records) {
      expect(record.created_at).toBeUndefined(); // never set by the service — created_at is preserved on update, defaulted on insert entirely at the DB level
      expect(typeof record.updated_at).toBe('string');
      expect(Number.isNaN(Date.parse(record.updated_at))).toBe(false);
    }
  });

  test('if the write itself fails, the commit throws and reports no partial success', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'A1001-A' }]);
    repo.upsertRecords.mockRejectedValue(Object.assign(new Error('constraint violation'), { code: '23505' }));
    const buffer = await buildWorkbook([[30001, 1001, 'A1001-A', '2026-27', new Date(Date.UTC(2026, 6, 9)), 10000, 9500]]);

    await expect(commitSalesReportImport(buffer, 'uuid-user-1')).rejects.toThrow('constraint violation');
  });

  test('real case: an existing (1108, 2026-07-09) row is overwritten by the new file; unrelated new rows still insert normally', async () => {
    createFakeStoreTable([
      { id: '1108', storeCode: '1108', name: 'Store 1108' },
      { id: '1109', storeCode: '1109', name: 'Store 1109' },
    ]);
    repo.findExistingReportKeys.mockResolvedValue(new Set(['1108|2026-07-09']));

    const buffer = await buildWorkbook([
      [30001, 1108, 'Store 1108', '2026-27', new Date(Date.UTC(2026, 6, 9)), 55555, 44444], // different from the "existing DB" values
      [30002, 1109, 'Store 1109', '2026-27', new Date(Date.UTC(2026, 6, 10)), 20000, 15000], // brand-new row, unrelated
    ]);

    // 1. API succeeds — no throw
    const result = await commitSalesReportImport(buffer, 'uuid-user-1');

    // 2. no rejection / no 500-equivalent for the "duplicate"
    expect(result.failed).toHaveLength(0);
    // 3. the existing row is UPDATEd, not skipped
    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(1);

    const [records] = repo.upsertRecords.mock.calls[0];
    // 5. no duplicate row added — exactly one write for the existing key
    expect(records.filter((r) => r.store_id === '1108' && r.report_date === '2026-07-09')).toHaveLength(1);

    // 4. the payload for that key matches the NEW file's data, not the old DB values
    const updatedRecord = records.find((r) => r.store_id === '1108');
    expect(updatedRecord.gross_actual).toBe(55555);
    expect(updatedRecord.gross_budget).toBe(44444);

    // 6. the other, unrelated new row in the file still inserts normally
    const newRecord = records.find((r) => r.store_id === '1109');
    expect(newRecord).toBeDefined();
    expect(newRecord.gross_actual).toBe(20000);

    // upsertRecords is what turns this into a real UPDATE (ON CONFLICT DO UPDATE) at the DB
    // layer rather than a 23505 unique-violation — see salesReportRepository.test.js for
    // proof that an existing key is overwritten in place, not duplicated.
    expect(repo.upsertRecords).toHaveBeenCalledTimes(1);
  });
});
