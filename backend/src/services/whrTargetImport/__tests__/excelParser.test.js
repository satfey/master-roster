const ExcelJS = require('exceljs');
const { parseWhrTargetWorkbook } = require('../excelParser');

/**
 * Mirrors the REAL WHR Target file's confirmed structure — inspected
 * directly with ExcelJS against two real files: the original "clean"
 * template (header row 12, no filled data) and a real 265-store, 323-row
 * upload (header row 9 — confirmed the header row's exact position is NOT
 * fixed between files, which is why findHeaderRow scans for it rather than
 * assuming a row number). Confirmed real layout: an "ASSUMPTION & DATA
 * LOOKUP" scaffolding section above the real table; a PERIOD cell (label in
 * column L, date value in column M) above the header row; the header row
 * itself at A="TYPE", B="CODE", C="SALES", H="PRODUCTIVITY" (a super-header-
 * only label, row 12/9 itself is blank there), J="BAHT" (COG's sub-label),
 * L="Code", M="Store Name"; and, one row ABOVE the header (the same row
 * PRODUCTIVITY/COG's super-headers live on), a "WHRS (OPS)" label whose
 * column holds the real per-store WHRS figure — column G ("WHRS", under an
 * "ORIGINAL" super-header) looked like the obvious WHRS column but is
 * confirmed (live, against the 265-store file) to be a budget/target figure
 * with only 17 distinct values total, not the real monthly result.
 */
async function buildWhrTargetWorkbook({ scaffoldingRows = 11, periodDate = new Date(Date.UTC(2026, 6, 1)), whrsOpsColumn = 84, dataRows = [] } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');

  // Scaffolding rows above the header (assumption/lookup section) — enough rows that a
  // parser naively assuming "header is always row 1" or "row 2" would fail.
  for (let i = 0; i < scaffoldingRows; i++) ws.addRow([`SCAFFOLD_ROW_${i}`]);

  // PERIOD row, somewhere above the header, label in column L (12), value in column M (13).
  const periodRow = ws.addRow([]);
  periodRow.getCell(12).value = 'PERIOD  '; // trailing spaces, exactly as in the real file
  periodRow.getCell(13).value = periodDate;

  // Super-header row, directly above the header row — carries "WHRS (OPS)" (the real WHRS
  // source), plus PRODUCTIVITY/COG's own super-headers for structural fidelity.
  const superHeaderRow = ws.addRow([]);
  superHeaderRow.getCell(2).value = 'ORIGINAL';
  superHeaderRow.getCell(8).value = 'PRODUCTIVITY';
  superHeaderRow.getCell(10).value = 'COG';
  superHeaderRow.getCell(whrsOpsColumn).value = 'WHRS (OPS)';

  // Header row: column-position layout confirmed against the real file.
  const headerRow = ws.addRow([]);
  headerRow.getCell(1).value = 'TYPE';
  headerRow.getCell(2).value = 'CODE';
  headerRow.getCell(3).value = 'SALES';
  headerRow.getCell(4).value = 'DOCKET';
  headerRow.getCell(5).value = 'TA';
  headerRow.getCell(6).value = 'CONFIRM DOCKET FOR MONITOR';
  headerRow.getCell(7).value = 'WHRS'; // the budget/target column — never read as the WHRS value (see module comment)
  // column 8 (PRODUCTIVITY) and 9 (CPLH) intentionally left blank here too — in the real
  // file their label lives only in the row above (a super-header), the header row itself is blank.
  headerRow.getCell(10).value = 'BAHT';
  headerRow.getCell(12).value = 'Code';
  headerRow.getCell(13).value = 'Store Name';
  headerRow.getCell(whrsOpsColumn).value = 'WHRS'; // the OPS section's own sub-label, real column, real value below

  for (const row of dataRows) {
    const r = ws.addRow([]);
    r.getCell(1).value = row.type ?? 'EQ';
    r.getCell(2).value = row.storeCode;
    r.getCell(3).value = row.monthlySales;
    r.getCell(7).value = row.whrsOriginal ?? 999999; // the budget column — deliberately a different, obviously-wrong value in tests, to prove it's never what gets read
    r.getCell(8).value = row.productivity;
    r.getCell(10).value = row.cog;
    r.getCell(13).value = row.storeNameRaw;
    r.getCell(whrsOpsColumn).value = row.whrs; // the real value, from the dynamically-located WHRS (OPS) column
  }

  return wb.xlsx.writeBuffer();
}

describe('whrTargetImport/excelParser — real file structure (scaffolding + PERIOD + fixed-column data)', () => {
  test('1. finds the header row by scanning for TYPE/CODE, regardless of how much scaffolding sits above it', async () => {
    const buffer = await buildWhrTargetWorkbook({ scaffoldingRows: 20, dataRows: [{ storeCode: 1001, monthlySales: 100000, whrs: 500, productivity: 200, cog: 20000, storeNameRaw: 'Store A' }] });

    const { headerRowNumber } = await parseWhrTargetWorkbook(buffer);

    expect(headerRowNumber).toBe(23); // 20 scaffold rows (1-20) + PERIOD row (21) + super-header row (22) + header (23)
  });

  test('reads the reporting month from the PERIOD cell, never a fixed/hardcoded month', async () => {
    const buffer = await buildWhrTargetWorkbook({ periodDate: new Date(Date.UTC(2026, 9, 1)), dataRows: [{ storeCode: 1001 }] }); // October, not July

    const { periodDate } = await parseWhrTargetWorkbook(buffer);

    expect(periodDate.getUTCFullYear()).toBe(2026);
    expect(periodDate.getUTCMonth()).toBe(9); // October (0-indexed)
  });

  test('extracts CODE, SALES, WHRS, PRODUCTIVITY, COG, and Store Name from their real fixed columns', async () => {
    const buffer = await buildWhrTargetWorkbook({
      dataRows: [{ storeCode: 1001, monthlySales: 500000, whrs: 620, productivity: 190.5, cog: 150000, storeNameRaw: 'Store Name ABC' }],
    });

    const { rows } = await parseWhrTargetWorkbook(buffer);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      storeCode: 1001,
      monthlySales: 500000,
      whrs: 620,
      productivity: 190.5,
      cog: 150000,
      storeNameRaw: 'Store Name ABC',
    });
  });

  test('extracts multiple store rows in file order', async () => {
    const buffer = await buildWhrTargetWorkbook({
      dataRows: [
        { storeCode: 1001, monthlySales: 100000, whrs: 500, productivity: 200, cog: 20000, storeNameRaw: 'Store A' },
        { storeCode: 1002, monthlySales: 200000, whrs: 600, productivity: 210, cog: 40000, storeNameRaw: 'Store B' },
        { storeCode: 1003, monthlySales: 300000, whrs: 700, productivity: 220, cog: 60000, storeNameRaw: 'Store C' },
      ],
    });

    const { rows } = await parseWhrTargetWorkbook(buffer);

    expect(rows.map((r) => r.storeCode)).toEqual([1001, 1002, 1003]);
  });

  test('stops at the end of the real data table (2 consecutive blank rows), ignoring anything below it', async () => {
    const buffer = await buildWhrTargetWorkbook({ dataRows: [{ storeCode: 1001, monthlySales: 100000 }] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buffer);
    const ws = wb.worksheets[0];
    ws.addRow([]); // blank
    ws.addRow([]); // blank -> end of table
    ws.addRow(['NOTES: this is footer text below the table, must never be read as a store row']);
    const rebuiltBuffer = await wb.xlsx.writeBuffer();

    const { rows } = await parseWhrTargetWorkbook(rebuiltBuffer);

    expect(rows).toHaveLength(1);
  });

  test('throws a 400 when no TYPE/CODE header row can be found', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['not a WHR Target file']);
    const buffer = await wb.xlsx.writeBuffer();

    await expect(parseWhrTargetWorkbook(buffer)).rejects.toMatchObject({ status: 400 });
  });

  test('throws a 400 when no PERIOD cell can be found above the header', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    const headerRow = ws.addRow([]);
    headerRow.getCell(1).value = 'TYPE';
    headerRow.getCell(2).value = 'CODE';
    const buffer = await wb.xlsx.writeBuffer();

    await expect(parseWhrTargetWorkbook(buffer)).rejects.toMatchObject({ status: 400 });
  });

  test('throws a 400 when no "WHRS (OPS)" column can be found (e.g. only the budget "WHRS" column exists)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    const periodRow = ws.addRow([]);
    periodRow.getCell(12).value = 'PERIOD';
    periodRow.getCell(13).value = new Date(Date.UTC(2026, 6, 1));
    const headerRow = ws.addRow([]);
    headerRow.getCell(1).value = 'TYPE';
    headerRow.getCell(2).value = 'CODE';
    headerRow.getCell(7).value = 'WHRS'; // the budget column only — no "WHRS (OPS)" super-header anywhere
    const buffer = await wb.xlsx.writeBuffer();

    await expect(parseWhrTargetWorkbook(buffer)).rejects.toMatchObject({ status: 400 });
  });

  test('finds the real WHRS (OPS) value even when it sits in a very different column position than the budget "WHRS" column (position is searched for, never assumed)', async () => {
    const buffer = await buildWhrTargetWorkbook({
      whrsOpsColumn: 40, // a deliberately different position than the real file's 84, to prove nothing is hardcoded
      dataRows: [{ storeCode: 1001, monthlySales: 500000, whrs: 733, whrsOriginal: 1100, productivity: 190, cog: 100000, storeNameRaw: 'Store A' }],
    });

    const { rows } = await parseWhrTargetWorkbook(buffer);

    expect(rows[0].whrs).toBe(733); // the real (OPS) value, not the budget column's 1100
  });
});
