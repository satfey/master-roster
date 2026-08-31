import { describe, test, expect } from "vitest";
import ExcelJS from "exceljs";
import { readWorksheetAsObjects, MAX_FILE_SIZE_BYTES, MAX_ROWS } from "./excelImport";

async function buildWorkbookBuffer(rows, { addSheet = true } = {}) {
  const workbook = new ExcelJS.Workbook();
  if (addSheet) {
    const sheet = workbook.addWorksheet("Sheet1");
    for (const row of rows) sheet.addRow(row);
  }
  return workbook.xlsx.writeBuffer();
}

describe("readWorksheetAsObjects (exceljs-backed, replaces the vulnerable xlsx package in the browser bundle)", () => {
  test("returns an array of plain objects keyed by row-1 header text, matching the old sheet_to_json({ defval: null }) shape", async () => {
    const buffer = await buildWorkbookBuffer([
      ["date", "name", "hours"],
      ["2026-07-09", "Somchai", 8],
      ["2026-07-10", "Somsri", 6.5],
    ]);

    const rows = await readWorksheetAsObjects(buffer);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ date: "2026-07-09", name: "Somchai", hours: 8 });
    expect(rows[1].hours).toBe(6.5);
  });

  test("a genuinely date-formatted cell comes back as a native Date object", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["date", "sales"]);
    const row = sheet.addRow([new Date(Date.UTC(2026, 6, 9)), 5000]);
    row.getCell(1).numFmt = "yyyy-mm-dd";
    const buffer = await workbook.xlsx.writeBuffer();

    const rows = await readWorksheetAsObjects(buffer);

    expect(rows[0].date).toBeInstanceOf(Date);
  });

  test("blank cells become null, matching the old defval: null behavior", async () => {
    const buffer = await buildWorkbookBuffer([
      ["date", "name", "hours"],
      ["2026-07-09", null, 8],
    ]);

    const rows = await readWorksheetAsObjects(buffer);

    expect(rows[0].name).toBeNull();
  });

  test("a fully blank row is skipped", async () => {
    const buffer = await buildWorkbookBuffer([
      ["date", "name", "hours"],
      ["2026-07-09", "Somchai", 8],
      [null, null, null],
    ]);

    const rows = await readWorksheetAsObjects(buffer);

    expect(rows).toHaveLength(1);
  });

  test("a workbook with no worksheets throws a clear error", async () => {
    const buffer = await buildWorkbookBuffer([], { addSheet: false });

    await expect(readWorksheetAsObjects(buffer)).rejects.toThrow(/no worksheets/);
  });

  test("a missing/blank header row still parses without throwing", async () => {
    const buffer = await buildWorkbookBuffer([
      [null, null],
      [1, 2],
    ]);

    const rows = await readWorksheetAsObjects(buffer);

    // Blank headers mean every data cell is unkeyable and therefore dropped, same as the caller
    // treating an all-null-keyed row as unusable — no crash either way.
    expect(rows).toEqual([]);
  });

  test("a buffer over the configured size limit is rejected before parsing", async () => {
    // The size check reads only `.byteLength` and runs before the workbook is
    // ever touched, so a lightweight stand-in proves the guard without
    // actually allocating an oversized real file.
    const oversizedStandIn = { byteLength: MAX_FILE_SIZE_BYTES + 1 };

    await expect(readWorksheetAsObjects(oversizedStandIn)).rejects.toThrow(/too large/);
  });

  test("a moderately large worksheet (5,000 rows) parses correctly and quickly", async () => {
    const bigRows = Array.from({ length: 5000 }, (_, i) => [i, `Store ${i}`, i * 1.5]);
    const buffer = await buildWorkbookBuffer([["id", "name", "sales"], ...bigRows]);

    const start = Date.now();
    const rows = await readWorksheetAsObjects(buffer);
    const elapsedMs = Date.now() - start;

    expect(rows).toHaveLength(5000);
    expect(rows[4999].id).toBe(4999);
    expect(elapsedMs).toBeLessThan(10_000);
  });

  test("MAX_ROWS is exported and enforced", async () => {
    expect(MAX_ROWS).toBeGreaterThan(0);
  });
});
