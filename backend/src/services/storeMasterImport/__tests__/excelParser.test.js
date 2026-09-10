const ExcelJS = require('exceljs');
const { parseStoreMasterWorkbook } = require('../excelParser');
const { transformRows } = require('../transform');

/**
 * Fixtures deliberately vary preamble length and row count between tests, to
 * prove the parser processes the actual worksheet dynamically rather than
 * being tuned to one specific file's row numbers.
 */
async function buildWorkbook(preambleRowCount, dataRows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');

  for (let i = 0; i < preambleRowCount; i++) {
    ws.addRow(i === 0 ? ['Store Master Report'] : []);
  }
  ws.addRow(['Effective Date', 'ID', 'BRANCH', 'Zone Update']);
  const headerRow = preambleRowCount + 1;

  for (const row of dataRows) ws.addRow(row);

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, expectedHeaderRow: headerRow };
}

describe('storeMasterImport excelParser + transform', () => {
  test.each([6, 2])('1. detects the header row dynamically regardless of preamble length (%i rows above)', async (preambleRowCount) => {
    const { buffer, expectedHeaderRow } = await buildWorkbook(preambleRowCount, [
      ['2026-07-01', 1001, 'Bangna Store', 'Alice Area Coach'],
    ]);
    const { headerRowNumber, rows } = await parseStoreMasterWorkbook(buffer);

    expect(headerRowNumber).toBe(expectedHeaderRow);
    expect(rows.length).toBe(1);
  });

  test('2. a title/preamble before the header does not get misread as data', async () => {
    const { buffer } = await buildWorkbook(6, [['2026-07-01', 1001, 'Bangna Store', 'Alice Area Coach']]);
    const { rows } = await parseStoreMasterWorkbook(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1001);
  });

  test('3. Excel ID maps to storeCode via transform', () => {
    const [row] = transformRows([{ rowNumber: 4, effectiveDate: '2026-07-01', id: 1001, branch: 'Bangna Store', zoneUpdate: 'Alice Area Coach' }]);
    expect(row.storeCode).toBe('1001');
  });

  test('4. leading-zero Store IDs are preserved (text cell, not round-tripped through Number)', () => {
    const [row] = transformRows([{ rowNumber: 4, effectiveDate: '2026-07-01', id: '001001', branch: 'Bangna Store', zoneUpdate: '' }]);
    expect(row.storeCode).toBe('001001');
  });

  test('a plain numeric Store ID becomes plain integer text', () => {
    const [row] = transformRows([{ rowNumber: 4, effectiveDate: '2026-07-01', id: 1001, branch: 'Bangna Store', zoneUpdate: '' }]);
    expect(row.storeCode).toBe('1001');
  });

  test('5. BRANCH column maps to the row\'s branch field', () => {
    const [row] = transformRows([{ rowNumber: 4, effectiveDate: '2026-07-01', id: 1001, branch: 'Bangna Store', zoneUpdate: '' }]);
    expect(row.branch).toBe('Bangna Store');
  });

  test('11. blank rows are ignored completely', async () => {
    const { buffer } = await buildWorkbook(2, [
      ['2026-07-01', 1001, 'Bangna Store', 'Alice Area Coach'],
      [],
      ['2026-07-01', 1002, 'Siam Store', 'Bob Manager'],
    ]);
    const { rows } = await parseStoreMasterWorkbook(buffer);
    expect(rows).toHaveLength(2);
  });

  test('12. multiple stores are all captured, independently', async () => {
    const { buffer } = await buildWorkbook(2, [
      ['2026-07-01', 1001, 'Bangna Store', 'Alice Area Coach'],
      ['2026-07-02', 1002, 'Siam Store', 'Bob Manager'],
      ['2026-07-03', 1003, 'Ekamai Store', ''],
    ]);
    const { rows } = await parseStoreMasterWorkbook(buffer);
    const transformed = transformRows(rows);
    expect(transformed.map((r) => r.storeCode)).toEqual(['1001', '1002', '1003']);
    expect(transformed.map((r) => r.branch)).toEqual(['Bangna Store', 'Siam Store', 'Ekamai Store']);
  });

  test('missing ID is flagged invalid, not dropped', () => {
    const [row] = transformRows([{ rowNumber: 4, effectiveDate: '2026-07-01', id: null, branch: 'Bangna Store', zoneUpdate: '' }]);
    expect(row.errors).toContain('Missing ID');
  });

  test('missing Branch is flagged invalid, not dropped', () => {
    const [row] = transformRows([{ rowNumber: 4, effectiveDate: '2026-07-01', id: 1001, branch: '', zoneUpdate: '' }]);
    expect(row.errors).toContain('Missing Branch');
  });

  test('blank Zone Update is not an error (documented as "no Area Coach")', () => {
    const [row] = transformRows([{ rowNumber: 4, effectiveDate: '2026-07-01', id: 1001, branch: 'Bangna Store', zoneUpdate: '' }]);
    expect(row.errors).toHaveLength(0);
    expect(row.areaCoachName).toBeNull();
    expect(row.areaCoachNameNormalized).toBeNull();
  });

  test('Zone Update matching is normalized for whitespace and case', () => {
    const [row] = transformRows([{ rowNumber: 4, effectiveDate: '2026-07-01', id: 1001, branch: 'Bangna Store', zoneUpdate: '  JOHN   Smith  ' }]);
    expect(row.areaCoachNameNormalized).toBe('john smith');
    expect(row.areaCoachName).toBe('JOHN   Smith');
  });

  test('throws a clear error if no header row can be found', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['nothing', 'matches', 'the', 'expected', 'labels']);
    const buffer = await wb.xlsx.writeBuffer();
    await expect(parseStoreMasterWorkbook(buffer)).rejects.toThrow(/Could not find the store master header row/);
  });
});
