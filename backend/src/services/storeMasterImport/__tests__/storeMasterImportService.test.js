const crypto = require('crypto');
const ExcelJS = require('exceljs');

// Explicit factory (not automock) so the real module — which creates a
// Supabase client at require-time — is never loaded during tests.
jest.mock('../../../repositories/storeMasterRepository', () => ({
  findAreaCoachesByName: jest.fn(),
  createAreaCoaches: jest.fn(),
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
      id: s.storeCode, // the Excel Store ID IS store.id — never a random UUID
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

function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * In-memory fake `area_coach` table, keyed by normalized name — mirrors
 * createFakeStoreTable so a coach created on one commit is found (not
 * recreated) on a later one. Grouped as an array per key (not a single
 * value) because the real table has no unique constraint on `name`, so an
 * "Ambiguous Area Coach" scenario (2+ existing rows, same name) must stay
 * representable.
 */
function createFakeAreaCoachTable(initial = []) {
  const groups = new Map();
  for (const coach of initial) {
    const key = normalizeName(coach.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(coach);
  }

  repo.findAreaCoachesByName.mockImplementation(async () => groups);

  repo.createAreaCoaches.mockImplementation(async (names) => {
    const created = names.map((name) => ({ id: crypto.randomUUID(), name }));
    for (const coach of created) {
      const key = normalizeName(coach.name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(coach);
    }
    return created;
  });

  return groups;
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
  createFakeAreaCoachTable([]);
});

describe('storeMasterImportService — Area Coach resolution', () => {
  test('existing Area Coach: Zone Update is matched against area_coach.name (case/whitespace normalized)', async () => {
    createFakeStoreTable([]);
    createFakeAreaCoachTable([{ id: 'coach-1', name: 'Alice Area Coach' }]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', '  Alice   Area Coach ']]);

    const preview = await previewStoreMasterImport(buffer);

    expect(preview.rows[0].status).toBe('valid');
    expect(preview.rows[0].resolvedAreaCoachId).toBe('coach-1');
    expect(preview.rows[0].willCreateAreaCoach).toBe(false);
  });

  test('the resolved existing area_coach.id is saved to store.area_coach_id on commit, without creating a new one', async () => {
    createFakeStoreTable([]);
    createFakeAreaCoachTable([{ id: 'coach-1', name: 'Alice Area Coach' }]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', 'Alice Area Coach']]);

    await commitStoreMasterImport(buffer);

    expect(repo.createAreaCoaches).not.toHaveBeenCalled();
    const [newStores] = repo.createStores.mock.calls[0];
    expect(newStores[0].areaCoachId).toBe('coach-1');
  });

  test('new Area Coach: a name with no existing match is auto-created on commit, and the store uses the new id', async () => {
    createFakeStoreTable([]);
    createFakeAreaCoachTable([]); // no Area Coaches exist yet
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', 'Boriphan Ruensuwan']]);

    const preview = await previewStoreMasterImport(buffer);
    expect(preview.rows[0].status).toBe('valid');
    expect(preview.rows[0].willCreateAreaCoach).toBe(true);
    expect(preview.newAreaCoachCount).toBe(1);

    const result = await commitStoreMasterImport(buffer);

    expect(repo.createAreaCoaches).toHaveBeenCalledWith(['Boriphan Ruensuwan']);
    expect(result.areaCoachesCreated).toHaveLength(1);
    expect(result.areaCoachesCreated[0].name).toBe('Boriphan Ruensuwan');
    expect(result.storesCreated[0].area_coach_id).toBe(result.areaCoachesCreated[0].id);
  });

  test('same coach, different casing/whitespace across rows: only ONE area_coach is created and shared by every row', async () => {
    createFakeStoreTable([]);
    createFakeAreaCoachTable([]);
    const buffer = await buildWorkbook([
      ['2026-07-01', 1001, 'Store A', 'Boriphan Ruensuwan'],
      ['2026-07-01', 1002, 'Store B', '  BORIPHAN   RUENSUWAN  '],
      ['2026-07-01', 1003, 'Store C', 'boriphan ruensuwan'],
    ]);

    const result = await commitStoreMasterImport(buffer);

    expect(repo.createAreaCoaches).toHaveBeenCalledTimes(1);
    expect(repo.createAreaCoaches.mock.calls[0][0]).toEqual(['Boriphan Ruensuwan']); // first-seen casing, deduped to one entry
    expect(result.areaCoachesCreated).toHaveLength(1);
    const sharedId = result.areaCoachesCreated[0].id;
    expect(result.storesCreated.map((s) => s.area_coach_id)).toEqual([sharedId, sharedId, sharedId]);
  });

  test('repeated import does not create a duplicate Area Coach — the second commit reuses the one created by the first', async () => {
    createFakeStoreTable([]);
    const areaCoachTable = createFakeAreaCoachTable([]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', 'Boriphan Ruensuwan']]);

    const first = await commitStoreMasterImport(buffer);
    expect(first.areaCoachesCreated).toHaveLength(1);
    const firstId = first.areaCoachesCreated[0].id;

    const second = await commitStoreMasterImport(buffer);

    expect(repo.createAreaCoaches).toHaveBeenCalledTimes(1); // not called again on the second import
    expect(second.areaCoachesCreated).toHaveLength(0);
    expect(second.unchanged).toBe(1); // store already has this Area Coach from the first commit — nothing to write
    expect([...areaCoachTable.values()].flat().filter((c) => normalizeName(c.name) === 'boriphan ruensuwan')).toHaveLength(1);
    expect(firstId).toBeTruthy();
  });

  test('an ambiguous Area Coach (2+ existing rows already share the name) is flagged and the row is invalid, without creating anything', async () => {
    createFakeStoreTable([]);
    createFakeAreaCoachTable([
      { id: 'coach-1', name: 'Alice Area Coach' },
      { id: 'coach-2', name: 'Alice Area Coach' },
    ]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', 'Alice Area Coach']]);

    const preview = await previewStoreMasterImport(buffer);

    expect(preview.rows[0].status).toBe('invalid');
    expect(preview.rows[0].errors).toContain('Ambiguous Area Coach');

    const result = await commitStoreMasterImport(buffer);
    expect(repo.createAreaCoaches).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
  });

  test('blank Zone Update resolves to a NULL Area Coach without an error, and never triggers a create', async () => {
    createFakeStoreTable([]);
    createFakeAreaCoachTable([]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', '']]);

    const preview = await previewStoreMasterImport(buffer);
    expect(preview.rows[0].status).toBe('valid');
    expect(preview.rows[0].resolvedAreaCoachId).toBeNull();
    expect(preview.rows[0].willCreateAreaCoach).toBe(false);

    await commitStoreMasterImport(buffer);
    expect(repo.createAreaCoaches).not.toHaveBeenCalled();
  });
});

describe('storeMasterImportService — API response: storeId is the business Store ID, not the UUID', () => {
  test('Case 1 & 3: preview rows expose storeId as storeCode (string), never the store UUID', async () => {
    createFakeStoreTable([]);
    createFakeAreaCoachTable([]);
    const buffer = await buildWorkbook([
      ['2026-07-01', 1001, 'Bangna Store', ''],
      ['2026-07-01', 1002, 'Siam Store', ''],
    ]);

    const preview = await previewStoreMasterImport(buffer);

    expect(preview.rows.map((r) => r.storeId)).toEqual(['1001', '1002']);
  });

  test('storesCreated/storesUpdated include storeId as an alias of id — both hold the same source Store ID, never a UUID', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'Old Name', area_coach_id: null }]);
    createFakeAreaCoachTable([]);
    const buffer = await buildWorkbook([
      ['2026-07-01', 1001, 'New Name', ''],
      ['2026-07-01', 1002, 'Siam Store', ''],
    ]);

    const result = await commitStoreMasterImport(buffer);

    expect(result.storesUpdated[0]).toMatchObject({ id: '1001', storeId: '1001' });
    expect(result.storesCreated[0]).toMatchObject({ id: '1002', storeId: '1002', storeCode: '1002' });
  });
});

describe('storeMasterImportService — create vs update', () => {
  test('8. an existing Store is updated instead of duplicated', async () => {
    const table = createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'Old Name', area_coach_id: null }]);
    createFakeAreaCoachTable([]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'New Name', '']]);

    const result = await commitStoreMasterImport(buffer);

    expect(repo.createStores).toHaveBeenCalledWith([]);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(table.get('1001').name).toBe('New Name');
  });

  test('9. a new Store is created when storeCode does not exist', async () => {
    createFakeStoreTable([]);
    createFakeAreaCoachTable([]);
    const buffer = await buildWorkbook([['2026-07-01', 1002, 'Siam Store', '']]);

    const result = await commitStoreMasterImport(buffer);

    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.storesCreated[0]).toMatchObject({ storeCode: '1002', name: 'Siam Store' });
  });

  test('a row that already matches the DB exactly resolves to NO_CHANGE and writes nothing', async () => {
    createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'Bangna Store', area_coach_id: null }]);
    createFakeAreaCoachTable([]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', '']]);

    const result = await commitStoreMasterImport(buffer);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(1);
  });

  test('10. Effective Date is never included in the create/update payload', async () => {
    createFakeStoreTable([]);
    createFakeAreaCoachTable([]);
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
    createFakeAreaCoachTable([]);
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
    createFakeAreaCoachTable([]);
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
    createFakeAreaCoachTable([{ id: 'coach-1', name: 'Alice Area Coach' }]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', 'Alice Area Coach']]);

    const first = await commitStoreMasterImport(buffer);
    expect(first.created).toBe(1);
    expect(first.updated).toBe(0);

    const second = await commitStoreMasterImport(buffer);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(1);
  });

  test('18. preview never calls createStores, updateStores, or createAreaCoaches, even for a new Store with a new Area Coach', async () => {
    createFakeStoreTable([]);
    createFakeAreaCoachTable([]);
    const buffer = await buildWorkbook([['2026-07-01', 1001, 'Bangna Store', 'Boriphan Ruensuwan']]);

    await previewStoreMasterImport(buffer);

    expect(repo.createStores).not.toHaveBeenCalled();
    expect(repo.updateStores).not.toHaveBeenCalled();
    expect(repo.createAreaCoaches).not.toHaveBeenCalled();
  });

  test('19. commit creates and updates exactly the right stores in one file', async () => {
    const table = createFakeStoreTable([{ id: '1001', storeCode: '1001', name: 'Old Name', area_coach_id: null }]);
    createFakeAreaCoachTable([{ id: 'coach-1', name: 'Alice Area Coach' }]);
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
