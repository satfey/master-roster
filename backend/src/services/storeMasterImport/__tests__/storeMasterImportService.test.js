const crypto = require('crypto');
const ExcelJS = require('exceljs');

// Explicit factory (not automock) so the real module — which creates a
// Supabase client at require-time — is never loaded during tests.
jest.mock('../../../repositories/storeMasterRepository', () => ({
  findAreaCoachUsersByName: jest.fn(),
  findStoresByCodes: jest.fn(),
  createStores: jest.fn(),
  updateStores: jest.fn(),
}));
const repo = require('../../../repositories/storeMasterRepository');

const { previewStoreMasterImport, commitStoreMasterImport } = require('../storeMasterImportService');

/** In-memory fake `store` table keyed by storeCode. */
function createFakeStoreTable(initial = []) {
  const byCode = new Map(initial.map((s) => [s.storeCode, s]));

  repo.findStoresByCodes.mockImplementation(async (codes) => {
    const map = new Map();
    for (const code of codes) if (byCode.has(code)) map.set(code, byCode.get(code));
    return map;
  });

  repo.createStores.mockImplementation(async (newStores) => {
    const created = newStores.map((s) => ({
      id: crypto.randomUUID(),
      storeCode: s.storeCode,
      name: s.name,
      area_coach_id: s.areaCoachId ?? null,
      region: null,
    }));
    for (const store of created) byCode.set(store.storeCode, store);
    return created;
  });

  repo.updateStores.mockImplementation(async (updates) => {
    const updated = [];
    for (const u of updates) {
      const existing = [...byCode.values()].find((s) => s.id === u.id);
      if (!existing) continue;
      existing.name = u.name;
      existing.area_coach_id = u.areaCoachId ?? null;
      updated.push({ ...existing });
    }
    return updated;
  });

  return byCode;
}

/** In-memory fake Area Coach lookup map, keyed by normalized full_name. */
function fakeAreaCoachMap(entries) {
  const map = new Map();
  for (const [name, users] of entries) map.set(name, users);
  repo.findAreaCoachUsersByName.mockResolvedValue(map);
  return map;
}

async function buildWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['Effective Date', 'ID', 'BRANCH', 'Zone Update']);
  for (const r of rows) ws.addRow(r);
  return wb.xlsx.writeBuffer();
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.findAreaCoachUsersByName.mockResolvedValue(new Map());
});

describe('storeMasterImportService — Area Coach resolution', () => {
  test('6. Zone Update is matched against users.full_name (case/whitespace normalized)', async () => {
    createFakeStoreTable([]);
    fakeAreaCoachMap([['alice area coach', [{ id: 'coach-1', full_name: 'Alice Area Coach' }]]]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', '  Alice   Area Coach ']]);

    const preview = await previewStoreMasterImport(buffer);

    expect(preview.rows[0].status).toBe('valid');
    expect(preview.rows[0].resolvedAreaCoachId).toBe('coach-1');
  });

  test('7. the resolved Area Coach users.id is saved to store.area_coach_id on commit', async () => {
    createFakeStoreTable([]);
    fakeAreaCoachMap([['alice area coach', [{ id: 'coach-1', full_name: 'Alice Area Coach' }]]]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', 'Alice Area Coach']]);

    await commitStoreMasterImport(buffer);

    const [newStores] = repo.createStores.mock.calls[0];
    expect(newStores[0].areaCoachId).toBe('coach-1');
  });

  test('15. Area Coach not found is a non-blocking warning — the row is still valid, saved with no Area Coach', async () => {
    createFakeStoreTable([]);
    fakeAreaCoachMap([]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', 'Nobody Real']]);

    const preview = await previewStoreMasterImport(buffer);

    expect(preview.rows[0].status).toBe('valid');
    expect(preview.rows[0].errors).toHaveLength(0);
    expect(preview.rows[0].warnings.some((w) => w.includes('Area Coach') && w.includes('not found'))).toBe(true);
    expect(preview.rows[0].resolvedAreaCoachId).toBeNull();
    expect(preview.rows[0].action).toBe('CREATE');
  });

  test('a store is created with area_coach_id = NULL when its Area Coach is not found, and backfills on a later re-import once the coach exists', async () => {
    const table = createFakeStoreTable([]);
    fakeAreaCoachMap([]); // no Area Coaches exist yet
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', 'Boriphan Ruensuwan']]);

    const first = await commitStoreMasterImport(buffer);
    expect(first.created).toBe(1);
    expect(first.storesCreated[0].area_coach_id).toBeNull();

    // The Area Coach gets added to `users` later.
    fakeAreaCoachMap([['boriphan ruensuwan', [{ id: 'coach-9', full_name: 'Boriphan Ruensuwan' }]]]);

    const second = await commitStoreMasterImport(buffer);
    expect(second.updated).toBe(1);
    expect(table.get('1001').area_coach_id).toBe('coach-9');
  });

  test('16. an ambiguous Area Coach (multiple matches) is flagged and the row is invalid', async () => {
    createFakeStoreTable([]);
    fakeAreaCoachMap([['alice area coach', [
      { id: 'coach-1', full_name: 'Alice Area Coach' },
      { id: 'coach-2', full_name: 'Alice Area Coach' },
    ]]]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', 'Alice Area Coach']]);

    const preview = await previewStoreMasterImport(buffer);

    expect(preview.rows[0].status).toBe('invalid');
    expect(preview.rows[0].errors).toContain('Ambiguous Area Coach');
  });

  test('blank Zone Update resolves to a NULL Area Coach without an error', async () => {
    createFakeStoreTable([]);
    fakeAreaCoachMap([]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', '']]);

    const preview = await previewStoreMasterImport(buffer);

    expect(preview.rows[0].status).toBe('valid');
    expect(preview.rows[0].resolvedAreaCoachId).toBeNull();
  });
});

describe('storeMasterImportService — create vs update', () => {
  test('8. an existing Store is updated instead of duplicated', async () => {
    const table = createFakeStoreTable([{ id: 'store-1', storeCode: '1001', name: 'Old Name', area_coach_id: null }]);
    fakeAreaCoachMap([]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'New Name', '']]);

    const result = await commitStoreMasterImport(buffer);

    expect(repo.createStores).toHaveBeenCalledWith([]);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(table.get('1001').name).toBe('New Name');
  });

  test('9. a new Store is created when storeCode does not exist', async () => {
    createFakeStoreTable([]);
    fakeAreaCoachMap([]);
    const buffer = await buildWorkbook([['2026-07-01', 1002, 'Siam Store', '']]);

    const result = await commitStoreMasterImport(buffer);

    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.storesCreated[0]).toMatchObject({ storeCode: '1002', name: 'Siam Store' });
  });

  test('a row that already matches the DB exactly resolves to NO_CHANGE and writes nothing', async () => {
    createFakeStoreTable([{ id: 'store-1', storeCode: '1001', name: 'Bangna Store', area_coach_id: null }]);
    fakeAreaCoachMap([]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', '']]);

    const result = await commitStoreMasterImport(buffer);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(1);
  });

  test('10. Effective Date is never included in the create/update payload', async () => {
    createFakeStoreTable([]);
    fakeAreaCoachMap([]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', '']]);

    await commitStoreMasterImport(buffer);

    const [newStores] = repo.createStores.mock.calls[0];
    expect(newStores[0]).not.toHaveProperty('effectiveDate');
    expect(newStores[0]).not.toHaveProperty('effective_date');
  });
});

describe('storeMasterImportService — duplicate Store IDs within one file', () => {
  test('13. duplicate Store IDs with matching data are written only once', async () => {
    createFakeStoreTable([]);
    fakeAreaCoachMap([]);
    const buffer = await buildWorkbook([
      ['2026-07-01', 1001, 'Bangna Store', ''],
      ['2026-07-01', 1001, 'Bangna Store', ''],
    ]);

    const preview = await previewStoreMasterImport(buffer);
    expect(preview.rows[0].status).toBe('valid');
    expect(preview.rows[1].status).toBe('valid');
    expect(preview.rows[1].action).toBe('NO_CHANGE');
    expect(preview.duplicateRows).toBe(2);

    const result = await commitStoreMasterImport(buffer);
    expect(result.created).toBe(1);
  });

  test('14. conflicting duplicate Store IDs (different Branch) are marked invalid, not silently resolved', async () => {
    createFakeStoreTable([]);
    fakeAreaCoachMap([]);
    const buffer = await buildWorkbook([
      ['2026-07-01', 1001, 'Bangna Store', ''],
      ['2026-07-01', 1001, 'Different Branch Name', ''],
    ]);

    const preview = await previewStoreMasterImport(buffer);

    expect(preview.rows[0].status).toBe('invalid');
    expect(preview.rows[1].status).toBe('invalid');
    expect(preview.rows[0].errors.some((e) => e.includes('Conflicting duplicate Store ID'))).toBe(true);

    const result = await commitStoreMasterImport(buffer);
    expect(result.created).toBe(0);
    expect(result.failed).toHaveLength(2);
  });
});

describe('storeMasterImportService — idempotency and safety', () => {
  test('17. re-importing the same file twice is idempotent (same end state, no duplicate writes)', async () => {
    createFakeStoreTable([]);
    fakeAreaCoachMap([['alice area coach', [{ id: 'coach-1', full_name: 'Alice Area Coach' }]]]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', 'Alice Area Coach']]);

    const first = await commitStoreMasterImport(buffer);
    expect(first.created).toBe(1);
    expect(first.updated).toBe(0);

    const second = await commitStoreMasterImport(buffer);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(1);
  });

  test('18. preview never calls createStores or updateStores, even for a new Store', async () => {
    createFakeStoreTable([]);
    fakeAreaCoachMap([]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', '']]);

    await previewStoreMasterImport(buffer);

    expect(repo.createStores).not.toHaveBeenCalled();
    expect(repo.updateStores).not.toHaveBeenCalled();
  });

  test('19. commit creates and updates exactly the right stores in one file', async () => {
    const table = createFakeStoreTable([{ id: 'store-1', storeCode: '1001', name: 'Old Name', area_coach_id: null }]);
    fakeAreaCoachMap([['alice area coach', [{ id: 'coach-1', full_name: 'Alice Area Coach' }]]]);
    const buffer = await buildWorkbook([
      ['2026-07-01', 1001, 'Bangna Store', 'Alice Area Coach'], // existing -> UPDATE
      ['2026-07-02', 1002, 'Siam Store', ''],                   // new -> CREATE
    ]);

    const result = await commitStoreMasterImport(buffer);

    expect(result.updated).toBe(1);
    expect(result.created).toBe(1);
    expect(table.get('1001')).toMatchObject({ name: 'Bangna Store', area_coach_id: 'coach-1' });
    expect(table.get('1002')).toMatchObject({ name: 'Siam Store', area_coach_id: null });
  });
});
