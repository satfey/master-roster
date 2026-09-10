const ExcelJS = require('exceljs');

jest.mock('../../../repositories/salesImportRepository', () => ({
  findStoresByCodes: jest.fn(),
  getExcelSourceType: jest.fn(),
  findExistingRecordKeys: jest.fn(),
  insertRecords: jest.fn(),
  recordKey: jest.fn((storeId, date) => `${storeId}|${date instanceof Date ? date.toISOString().slice(0, 10) : date}`),
}));
const repo = require('../../../repositories/salesImportRepository');
const { previewSalesImport, commitSalesImport } = require('../salesImportService');

async function buildWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['TYPE', 'CODE', 'SALES', 'DOCKET', 'DATE', 'LABOUR HOURS']);
  for (const r of rows) ws.addRow(r);
  return wb.xlsx.writeBuffer();
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.findExistingRecordKeys.mockResolvedValue(new Set());
  repo.getExcelSourceType.mockResolvedValue({ id: 'source-1' });
});

describe('salesImportService.previewSalesImport', () => {
  test('resolves a store by store.id (regression guard: store.code does not exist — this must call findStoresByCodes and use its id-keyed result)', async () => {
    repo.findStoresByCodes.mockResolvedValue(new Map([['1001', { id: '1001', name: 'Bangna' }]]));
    const buffer = await buildWorkbook([['Retail', '1001', 25000, 120, new Date(Date.UTC(2026, 7, 15)), 40]]);

    const result = await previewSalesImport(buffer);

    expect(result.validRows).toBe(1);
    expect(result.rows[0]).toMatchObject({ storeCode: '1001', storeId: '1001', storeName: 'Bangna', salesAmount: 25000 });
  });

  test('an unresolvable store code is flagged invalid, not silently dropped', async () => {
    repo.findStoresByCodes.mockResolvedValue(new Map());
    const buffer = await buildWorkbook([['Retail', '9999', 25000, 120, new Date(Date.UTC(2026, 7, 15)), 40]]);

    const result = await previewSalesImport(buffer);

    expect(result.invalidRows).toBe(1);
    expect(result.rows[0].errors).toContain('Unknown store code: 9999');
  });
});

describe('salesImportService.commitSalesImport', () => {
  test('inserts using the real sales_record columns (snake_case; no docket/labourHours, which do not exist on that table)', async () => {
    repo.findStoresByCodes.mockResolvedValue(new Map([['1001', { id: '1001', name: 'Bangna' }]]));
    repo.insertRecords.mockResolvedValue(1);
    const buffer = await buildWorkbook([['Retail', '1001', 25000, 120, new Date(Date.UTC(2026, 7, 15)), 40]]);

    await commitSalesImport(buffer);

    expect(repo.insertRecords).toHaveBeenCalledWith([
      { store_id: '1001', sales_date: '2026-08-15', amount: 25000, source_type_id: 'source-1' },
    ]);
    const inserted = repo.insertRecords.mock.calls[0][0][0];
    expect(inserted).not.toHaveProperty('docket');
    expect(inserted).not.toHaveProperty('labourHours');
    expect(inserted).not.toHaveProperty('storeId'); // camelCase — the bug this regression guards against
  });

  test('only valid rows are inserted; invalid/duplicate rows are reported, never written', async () => {
    repo.findStoresByCodes.mockResolvedValue(new Map([['1001', { id: '1001', name: 'Bangna' }]]));
    repo.insertRecords.mockResolvedValue(1);
    const buffer = await buildWorkbook([
      ['Retail', '1001', 25000, 120, new Date(Date.UTC(2026, 7, 15)), 40],
      ['Retail', '1001', '', 10, new Date(Date.UTC(2026, 7, 16)), 8], // missing sales amount — a real store code, so it still reaches validation
    ]);

    const result = await commitSalesImport(buffer);

    expect(result.imported).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(repo.insertRecords).toHaveBeenCalledWith([expect.objectContaining({ store_id: '1001' })]);
  });
});
