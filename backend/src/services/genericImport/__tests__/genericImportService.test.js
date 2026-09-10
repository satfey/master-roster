const ExcelJS = require('exceljs');

// Explicit factory (not automock) so the real module — which creates a
// Supabase client at require-time — is never loaded during tests. Both
// parsers/storeImport.js and parsers/laborGuidelineImport.js query `store`
// directly (no repository layer for this importer), so the fake needs to
// support .select('id') (plain) and .select('*').in('id', codes) (filtered).
let mockStoreRows;
jest.mock('../../../config/supabase', () => ({
  from: (table) => {
    if (table !== 'store') throw new Error(`unexpected table ${table}`);
    const builder = {
      select: () => builder,
      not: () => builder,
      in: (col, ids) => {
        builder.__filterIds = ids;
        return builder;
      },
      then: (resolve) => {
        const rows = builder.__filterIds ? mockStoreRows.filter((s) => builder.__filterIds.includes(s.id)) : mockStoreRows;
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return builder;
  },
}));

jest.mock('../../../repositories/genericImportRepository', () => ({ bulkInsert: jest.fn() }));
const repo = require('../../../repositories/genericImportRepository');
const { importGeneric } = require('../genericImportService');

async function buildWorkbook(headers, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return wb.xlsx.writeBuffer();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStoreRows = [];
});

describe('genericImportService.importGeneric — unknown entity', () => {
  test('rejects an entity not in the registry, listing what is available', async () => {
    const buffer = await buildWorkbook(['name'], [['A Store']]);
    await expect(importGeneric('notARealEntity', buffer)).rejects.toMatchObject({ status: 400 });
  });
});

describe('genericImportService.importGeneric — entity: store', () => {
  test('inserts a new store using the Excel "code" column as store.id (the real PK — store.code does not exist)', async () => {
    repo.bulkInsert.mockResolvedValue(1);
    const buffer = await buildWorkbook(['name', 'code', 'region'], [['New Store', 'NS9001', 'Bangkok']]);

    const result = await importGeneric('store', buffer);

    expect(result).toEqual({ success: true, total: 1, inserted: 1, failed: 0 });
    expect(repo.bulkInsert).toHaveBeenCalledWith('store', [{ id: 'NS9001', name: 'New Store', region: 'Bangkok' }]);
  });

  test('rejects a row whose code already exists as a store id (regression guard for the store.code -> store.id fix)', async () => {
    mockStoreRows = [{ id: 'EXIST01' }];
    const buffer = await buildWorkbook(['name', 'code'], [['Dup Store', 'EXIST01']]);

    const result = await importGeneric('store', buffer);

    expect(result.success).toBe(false);
    expect(result.errors[0].messages[0]).toMatch(/already exists/);
    expect(repo.bulkInsert).not.toHaveBeenCalled();
  });

  test('rejects the whole file when the required "code" column is missing', async () => {
    const buffer = await buildWorkbook(['name'], [['No Code Store']]);
    await expect(importGeneric('store', buffer)).rejects.toMatchObject({ status: 400 });
  });
});

describe('genericImportService.importGeneric — entity: laborGuideline', () => {
  test('resolves storeCode to the real store (store.id, not store.code) and inserts the guideline', async () => {
    mockStoreRows = [{ id: '1001', name: 'Bangna' }];
    repo.bulkInsert.mockResolvedValue(1);
    const buffer = await buildWorkbook(
      ['storeCode', 'targetProductivity', 'targetColPercent', 'minStaffPerShift'],
      [['1001', 1200, 22, 2]]
    );

    const result = await importGeneric('laborGuideline', buffer);

    expect(result).toEqual({ success: true, total: 1, inserted: 1, failed: 0 });
    expect(repo.bulkInsert).toHaveBeenCalledWith('labor_guideline', [
      { store_id: '1001', target_productivity: 1200, target_col_percent: 22, min_staff_per_shift: 2 },
    ]);
  });

  test('rejects a storeCode that does not match any real store', async () => {
    mockStoreRows = [];
    const buffer = await buildWorkbook(['storeCode'], [['9999']]);

    const result = await importGeneric('laborGuideline', buffer);

    expect(result.success).toBe(false);
    expect(result.errors[0].messages[0]).toMatch(/Unknown storeCode/);
  });
});
