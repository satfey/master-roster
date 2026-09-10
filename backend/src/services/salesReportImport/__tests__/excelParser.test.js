const ExcelJS = require('exceljs');
const { parseSalesReportWorkbook } = require('../excelParser');
const { transformRows } = require('../transform');

/**
 * These fixtures deliberately use different row counts, store counts, week
 * counts, and header-row positions than any real sample file, to prove the
 * parser processes the actual worksheet dynamically rather than being tuned
 * to one specific file's row numbers.
 */
function dailyRow(buId, storeId, storeName, week, dateLabel, extra = {}) {
  return [
    buId, storeId, storeName, week, dateLabel,
    extra.grossActual ?? 10000, extra.grossBudget ?? 9500, extra.grossVar ?? '5%',
    extra.grossActualLy ?? 9000, extra.grossLyVar ?? '11%',
    extra.grossActualMtd ?? 40000, extra.grossBudgetMtd ?? 38000, extra.grossMtdVar ?? '5%',
    extra.grossActualLyMtd ?? 36000,
    extra.docketActual ?? 120, extra.docketBudget ?? 110, extra.docketVar ?? '9%',
    extra.docketActualLy ?? 100, extra.docketLyVar ?? '20%',
    extra.customerActual ?? 80, extra.customerBudget ?? 75, extra.customerVar ?? '6%',
    extra.customerActualLy ?? 70, extra.customerLyVar ?? '14%',
    extra.otherSales ?? 500, extra.serviceCharge ?? 200,
  ];
}

async function buildWorkbook(preambleRowCount) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');

  for (let i = 0; i < preambleRowCount; i++) {
    ws.addRow(i === 0 ? ['Company Sales Report'] : []);
  }
  // multi-level group header row — must NOT be mistaken for the real header
  ws.addRow(['', '', '', '', '', 'Gross Sales', '', '', '', '', '', '', '', '', 'Docket']);

  ws.addRow([
    'Store BU Id', 'Store Id', 'Store Name', 'Week', 'Date',
    'Gross Actual', 'Budget', '% Variance', 'Gross Actual (LY)', '% LY Variance',
    'Gross Actual (MTD)', 'Budget (MTD)', '% Variance (MTD)', 'Gross Actual LY (MTD)',
    'Docket Actual', 'Docket Budget', '% Variance', 'Docket Actual LY', '% LY Variance',
    'Customer Actual', 'Customer Budget', '% Variance', 'Customer Actual LY', '% LY Variance',
    'Other Sales', 'Service Charge',
  ]);
  const headerRow = preambleRowCount + 2; // preamble rows + group-header row, 1-indexed next row is the label row

  ws.addRow(dailyRow(30001, 1001, 'A1001-A', '2026-27', 'Wed, 01-Jul-2026'));
  ws.addRow(dailyRow(null, null, null, null, 'Thu, 02-Jul-2026'));
  ws.addRow(dailyRow(null, null, null, null, 'Fri, 03-Jul-2026', { grossVar: '(13.41%)', docketLyVar: '(4.11%)' }));
  ws.addRow(['', '', '', '2026-27 Total', '', 999999, 999999]);

  ws.addRow(dailyRow(30001, 1001, 'A1001-A', '2026-28', 'Wed, 08-Jul-2026'));
  ws.addRow(dailyRow(null, null, null, null, 'Thu, 09-Jul-2026'));
  ws.addRow(['', '', '', '2026-28 Total', '', 999999, 999999]);

  ws.addRow([]);
  ws.addRow(['', '', 'A1001-A Total', '', '', 999999, 999999]);

  ws.addRow(dailyRow(30002, 2002, 'B2002-B', '2026-27', 'Wed, 01-Jul-2026', { otherSales: '0.77%' }));
  ws.addRow(dailyRow(null, null, null, null, 'Thu, 02-Jul-2026'));
  ws.addRow(['', '', '', '2026-27 Total', '', 999999]);
  ws.addRow(['', '', 'B2002-B Total', '', '', 999999]);

  ws.addRow(dailyRow(30003, 9999, 'C3003-C', '2026-27', 'Fri, 03-Jul-2026'));
  ws.addRow(dailyRow(null, null, null, null, null)); // missing date, no Total label -> invalid, not skipped

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, expectedHeaderRow: headerRow };
}

describe('salesReportImport excelParser + transform', () => {
  test.each([8, 3])('detects the header row dynamically regardless of preamble length (%i rows above)', async (preambleRowCount) => {
    const { buffer, expectedHeaderRow } = await buildWorkbook(preambleRowCount);
    const { headerRowNumber, rows } = await parseSalesReportWorkbook(buffer);

    expect(headerRowNumber).toBe(expectedHeaderRow);
    // 3 + 2 + 2 + 2 daily rows = 9, regardless of where the header row landed
    expect(rows.length).toBe(9);
  });

  test('processes every group and never stops after the first Store or Week', async () => {
    const { buffer } = await buildWorkbook(8);
    const { rows } = await parseSalesReportWorkbook(buffer);
    const transformed = transformRows(rows);

    const storeIds = new Set(transformed.map((r) => r.reportStoreId));
    expect(storeIds).toEqual(new Set([1001, 9999, 2002]));

    const store1001Weeks = new Set(transformed.filter((r) => r.reportStoreId === 1001).map((r) => r.week));
    expect(store1001Weeks).toEqual(new Set(['2026-27', '2026-28']));
  });

  test('forward-fills Store BU Id / Store Id / Store Name / Week across merged/blank continuation rows', async () => {
    const { buffer } = await buildWorkbook(8);
    const { rows } = await parseSalesReportWorkbook(buffer);
    const transformed = transformRows(rows);

    const storeAWeek27 = transformed.filter((r) => r.reportStoreId === 1001 && r.week === '2026-27');
    expect(storeAWeek27).toHaveLength(3);
    expect(storeAWeek27.every((r) => r.storeBuId === 30001 && r.storeName === 'A1001-A')).toBe(true);
    expect(storeAWeek27.map((r) => r.reportDate.toISOString().slice(0, 10))).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
  });

  test('resets group state cleanly when a new Store begins (no leakage from the previous Store)', async () => {
    const { buffer } = await buildWorkbook(8);
    const { rows } = await parseSalesReportWorkbook(buffer);
    const transformed = transformRows(rows);

    const storeB = transformed.filter((r) => r.reportStoreId === 2002);
    expect(storeB).toHaveLength(2);
    expect(storeB.every((r) => r.storeBuId === 30002 && r.storeName === 'B2002-B')).toBe(true);
  });

  test('Week Total and Store Total rows never appear in the output', async () => {
    const { buffer } = await buildWorkbook(8);
    const { rows } = await parseSalesReportWorkbook(buffer);
    const transformed = transformRows(rows);

    expect(transformed.some((r) => String(r.storeName).includes('Total') || String(r.week).includes('Total'))).toBe(false);
  });

  test('blank rows between data groups are skipped without breaking extraction', async () => {
    const { buffer } = await buildWorkbook(8);
    const { rows } = await parseSalesReportWorkbook(buffer);
    // The fixture includes one blank formatting row after Store A's Store Total
    // and before Store B's first row — extraction must continue past it cleanly.
    expect(rows.length).toBe(9);
  });

  test('parses "Wed, DD-Mon-YYYY" dates without timezone drift', async () => {
    const { buffer } = await buildWorkbook(8);
    const { rows } = await parseSalesReportWorkbook(buffer);
    const transformed = transformRows(rows);
    const first = transformed.find((r) => r.reportStoreId === 1001 && r.week === '2026-27');
    expect(first.reportDate.toISOString().slice(0, 10)).toBe('2026-07-01');
  });

  test('parses parenthesized negative percentages correctly', async () => {
    const { buffer } = await buildWorkbook(8);
    const { rows } = await parseSalesReportWorkbook(buffer);
    const transformed = transformRows(rows);
    const row = transformed.find((r) => r.reportStoreId === 1001 && r.reportDate?.toISOString().slice(0, 10) === '2026-07-03');
    expect(row.grossVariancePercent).toBeCloseTo(-0.1341, 9);
    expect(row.docketLyVariancePercent).toBeCloseTo(-0.0411, 9);
  });

  test('parses small percentages correctly', async () => {
    const { buffer } = await buildWorkbook(8);
    const { rows } = await parseSalesReportWorkbook(buffer);
    const transformed = transformRows(rows);
    const row = transformed.find((r) => r.reportStoreId === 2002);
    expect(row.otherSales).toBeCloseTo(0.0077, 9);
  });

  test('a row missing Date but NOT a Total row is marked invalid, not silently dropped', async () => {
    const { buffer } = await buildWorkbook(8);
    const { rows } = await parseSalesReportWorkbook(buffer);
    const transformed = transformRows(rows);
    const missingDateRow = transformed.find((r) => r.reportStoreId === 9999 && r.reportDate === null);
    expect(missingDateRow).toBeDefined();
    expect(missingDateRow.errors).toContain('Missing Date (column E)');
  });

  test('missing Store BU Id / Store Id are flagged as required-field errors', () => {
    const [row] = transformRows([{ rowNumber: 99, storeBuId: null, reportStoreId: null, storeName: 'X', week: '2026-27', reportDate: 'Wed, 01-Jul-2026' }]);
    expect(row.errors).toContain('Missing Store BU Id (column A)');
    expect(row.errors).toContain('Missing or invalid Store ID (column B)');
  });

  test('throws a clear error if no header row can be found', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['nothing', 'matches', 'the', 'expected', 'labels']);
    const buffer = await wb.xlsx.writeBuffer();
    await expect(parseSalesReportWorkbook(buffer)).rejects.toThrow(/Could not find the sales report header row/);
  });
});
