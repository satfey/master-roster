const ExcelJS = require('exceljs');
const { parseSalesByHourWorkbook } = require('../excelParser');
const { transformRows } = require('../transform');

/**
 * These fixtures deliberately vary preamble length, store count, and row
 * count between tests, to prove the parser processes the actual worksheet
 * dynamically rather than being tuned to one specific file's row numbers.
 */
async function buildWorkbook(preambleRowCount, dataRows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');

  for (let i = 0; i < preambleRowCount; i++) {
    ws.addRow(i === 0 ? ['Sales by Hour Report'] : []);
  }
  ws.addRow(['Brand Name', 'Store Id', 'Store Name', 'Gross Sale', 'Hour']);
  const headerRow = preambleRowCount + 1;

  for (const row of dataRows) ws.addRow(row);

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, expectedHeaderRow: headerRow };
}

describe('salesByHourImport excelParser + transform', () => {
  test.each([8, 3])('1. detects the header row dynamically regardless of preamble length (%i rows above)', async (preambleRowCount) => {
    const { buffer, expectedHeaderRow } = await buildWorkbook(preambleRowCount, [
      ['ABC', 1001, 'ABC Central', 1150, 1],
    ]);
    const { headerRowNumber, rows } = await parseSalesByHourWorkbook(buffer);

    expect(headerRowNumber).toBe(expectedHeaderRow);
    expect(rows.length).toBe(1);
  });

  test('2. a title/preamble before the header does not get misread as data', async () => {
    const { buffer } = await buildWorkbook(8, [['ABC', 1001, 'ABC Central', 1150, 1]]);
    const { rows } = await parseSalesByHourWorkbook(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0].reportStoreId).toBe(1001);
  });

  test('3. forward-fills Brand Name across merged/blank continuation rows', async () => {
    const { buffer } = await buildWorkbook(2, [
      ['ABC', 1001, 'ABC Central', 1150, 1],
      [null, null, null, 1280, 9],
      [null, null, null, 1860, 10],
    ]);
    const { rows } = await parseSalesByHourWorkbook(buffer);
    const transformed = transformRows(rows);
    expect(transformed.every((r) => r.brandName === 'ABC')).toBe(true);
  });

  test('4. forward-fills Store Id across merged/blank continuation rows', async () => {
    const { buffer } = await buildWorkbook(2, [
      ['ABC', 1001, 'ABC Central', 1150, 1],
      [null, null, null, 1280, 9],
      [null, null, null, 1860, 10],
    ]);
    const { rows } = await parseSalesByHourWorkbook(buffer);
    const transformed = transformRows(rows);
    expect(transformed.every((r) => r.reportStoreId === 1001)).toBe(true);
  });

  test('5. forward-fills Store Name across merged/blank continuation rows', async () => {
    const { buffer } = await buildWorkbook(2, [
      ['ABC', 1001, 'ABC Central', 1150, 1],
      [null, null, null, 1280, 9],
      [null, null, null, 1860, 10],
    ]);
    const { rows } = await parseSalesByHourWorkbook(buffer);
    const transformed = transformRows(rows);
    expect(transformed.every((r) => r.storeName === 'ABC Central')).toBe(true);
  });

  test('6. multiple Stores in one workbook are all processed, with group state reset cleanly on each new Store', async () => {
    const { buffer } = await buildWorkbook(2, [
      ['ABC', 1001, 'ABC Central', 1150, 1],
      [null, null, null, 1280, 9],
      ['XYZ', 2002, 'XYZ North', 900, 1],
      [null, null, null, 950, 9],
    ]);
    const { rows } = await parseSalesByHourWorkbook(buffer);
    const transformed = transformRows(rows);

    const storeA = transformed.filter((r) => r.reportStoreId === 1001);
    const storeB = transformed.filter((r) => r.reportStoreId === 2002);
    expect(storeA).toHaveLength(2);
    expect(storeB).toHaveLength(2);
    expect(storeA.every((r) => r.brandName === 'ABC' && r.storeName === 'ABC Central')).toBe(true);
    expect(storeB.every((r) => r.brandName === 'XYZ' && r.storeName === 'XYZ North')).toBe(true);
  });

  test('7. multiple hours for one Store are all captured', async () => {
    const { buffer } = await buildWorkbook(2, [
      ['ABC', 1001, 'ABC Central', 1150, 1],
      [null, null, null, 1280, 9],
      [null, null, null, 1860, 10],
      [null, null, null, 3420, 11],
    ]);
    const { rows } = await parseSalesByHourWorkbook(buffer);
    const transformed = transformRows(rows);
    expect(transformed.map((r) => r.hour)).toEqual([1, 9, 10, 11]);
  });

  test('8. handles a large file (hundreds of rows) without stopping early', async () => {
    const dataRows = [];
    for (let store = 1; store <= 5; store++) {
      for (let hour = 0; hour < 24; hour++) {
        dataRows.push(hour === 0
          ? [`Brand${store}`, 1000 + store, `Store ${store}`, 1000 + hour, hour]
          : [null, null, null, 1000 + hour, hour]);
      }
    }
    const { buffer } = await buildWorkbook(2, dataRows);
    const { rows } = await parseSalesByHourWorkbook(buffer);
    expect(rows).toHaveLength(120); // 5 stores * 24 hours
    const transformed = transformRows(rows);
    expect(new Set(transformed.map((r) => r.reportStoreId)).size).toBe(5);
  });

  test('9. blank rows are ignored completely', async () => {
    const { buffer } = await buildWorkbook(2, [
      ['ABC', 1001, 'ABC Central', 1150, 1],
      [],
      [null, null, null, 1280, 9],
    ]);
    const { rows } = await parseSalesByHourWorkbook(buffer);
    expect(rows).toHaveLength(2);
  });

  test('10. an invalid/missing Store Id is flagged invalid, not dropped', async () => {
    const [row] = transformRows([{ rowNumber: 5, brandName: 'ABC', reportStoreId: null, storeName: 'ABC Central', grossSale: 1000, hour: 9 }]);
    expect(row.errors).toContain('Missing Store Id');
  });

  test('11. an invalid Gross Sale is flagged', async () => {
    const [row] = transformRows([{ rowNumber: 5, brandName: 'ABC', reportStoreId: 1001, storeName: 'ABC Central', grossSale: 'not-a-number', hour: 9 }]);
    expect(row.errors).toContain('Invalid Gross Sale');
  });

  test('12. an invalid Hour is flagged', async () => {
    const [row] = transformRows([{ rowNumber: 5, brandName: 'ABC', reportStoreId: 1001, storeName: 'ABC Central', grossSale: 1000, hour: 'not-an-hour' }]);
    expect(row.errors).toContain('Invalid Hour');
  });

  test('Hour surviving a time-formatted Excel cell (Date object) is extracted, not rejected', () => {
    const [row] = transformRows([{ rowNumber: 5, brandName: 'ABC', reportStoreId: 1001, storeName: 'ABC Central', grossSale: 1000, hour: new Date(Date.UTC(1899, 11, 30, 9, 0, 0)) }]);
    expect(row.errors).not.toContain('Invalid Hour');
    expect(row.hour).toBe(9);
  });

  test('missing Store Name is flagged, but missing Brand Name is not an error', () => {
    const [row] = transformRows([{ rowNumber: 5, brandName: null, reportStoreId: 1001, storeName: null, grossSale: 1000, hour: 9 }]);
    expect(row.errors).toContain('Missing Store Name');
    expect(row.errors.some((e) => e.includes('Brand'))).toBe(false);
    expect(row.brandName).toBeNull();
  });

  test('throws a clear error if no header row can be found', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['nothing', 'matches', 'the', 'expected', 'labels']);
    const buffer = await wb.xlsx.writeBuffer();
    await expect(parseSalesByHourWorkbook(buffer)).rejects.toThrow(/Could not find the sales by hour header row/);
  });
});
