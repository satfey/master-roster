import { describe, test, expect } from "vitest";
import { excelDateToStr } from "./calc.js";

describe("excelDateToStr (extended to handle native Date objects — exceljs returns Date for date-formatted cells, unlike the old xlsx reader without cellDates)", () => {
  test("a native Date object converts directly", () => {
    expect(excelDateToStr(new Date(2026, 6, 9))).toBe("2026-07-09");
  });

  test("an invalid Date returns null instead of throwing", () => {
    expect(excelDateToStr(new Date(NaN))).toBeNull();
  });

  test("a raw Excel serial number still converts (unchanged behavior)", () => {
    expect(excelDateToStr(46212)).toBe("2026-07-09");
  });

  test("an ISO-like date string still converts (unchanged behavior)", () => {
    expect(excelDateToStr("2026-07-09")).toBe("2026-07-09");
  });

  test("a D/M/Y-style date string still converts (unchanged behavior)", () => {
    expect(excelDateToStr("09/07/2026")).toBe("2026-07-09");
  });

  test("an unrecognized string returns null", () => {
    expect(excelDateToStr("not a date")).toBeNull();
  });
});
