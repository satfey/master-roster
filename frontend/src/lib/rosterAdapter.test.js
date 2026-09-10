import { describe, test, expect } from "vitest";
import { buildRosterView, eachDate, employmentTypeOf, shiftBucket, staffNameOf, weekRange } from "./rosterAdapter.js";

describe("eachDate", () => {
  test("returns every ISO date in the range, inclusive of both ends", () => {
    expect(eachDate("2026-09-01", "2026-09-04")).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]);
  });

  test("a single-day range returns that one day", () => {
    expect(eachDate("2026-09-01", "2026-09-01")).toEqual(["2026-09-01"]);
  });

  test("crosses a month boundary correctly", () => {
    expect(eachDate("2026-08-30", "2026-09-02")).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
  });
});

describe("weekRange — Monday to Sunday", () => {
  test("a Wednesday resolves to that week's Monday and Sunday", () => {
    expect(weekRange("2026-09-09")).toEqual({ startDate: "2026-09-07", endDate: "2026-09-13" });
  });

  test("a Monday is already the start of its own week", () => {
    expect(weekRange("2026-09-07")).toEqual({ startDate: "2026-09-07", endDate: "2026-09-13" });
  });

  // Sunday is the END of its week, not the start — the classic off-by-one here.
  test("a Sunday belongs to the week that started the previous Monday", () => {
    expect(weekRange("2026-09-13")).toEqual({ startDate: "2026-09-07", endDate: "2026-09-13" });
  });
});

describe("shiftBucket", () => {
  test("exact bucket starts map to their own bucket", () => {
    expect(shiftBucket("09:00:00")).toBe("MORNING");
    expect(shiftBucket("11:00:00")).toBe("AFTERNOON");
    expect(shiftBucket("13:00:00")).toBe("EVENING");
  });

  // The generator places shifts at whatever hour demand justifies, so times
  // that match no bucket exactly still have to land somewhere sensible.
  test("an off-bucket start snaps to the nearest bucket", () => {
    expect(shiftBucket("08:00:00")).toBe("MORNING");
    expect(shiftBucket("10:00:00")).toBe("MORNING");
    expect(shiftBucket("12:00:00")).toBe("AFTERNOON");
    expect(shiftBucket("17:00:00")).toBe("EVENING");
  });

  test("a missing or unparseable time is no shift, never a guessed one", () => {
    expect(shiftBucket(null)).toBeNull();
    expect(shiftBucket("")).toBeNull();
    expect(shiftBucket("abc")).toBeNull();
  });
});

describe("employmentTypeOf", () => {
  test("HR's free-text position_time_type maps to the roster's employment types", () => {
    expect(employmentTypeOf({ position_time_type: "Part time" })).toBe("PART_TIME");
    expect(employmentTypeOf({ position_time_type: "part-time" })).toBe("PART_TIME");
    expect(employmentTypeOf({ position_time_type: "Full time" })).toBe("FULL_TIME");
  });

  // FULL_TIME is the stricter weekly-hours contract, so it is the safe default.
  test("an unknown or missing value falls back to FULL_TIME", () => {
    expect(employmentTypeOf({ position_time_type: "Seasonal" })).toBe("FULL_TIME");
    expect(employmentTypeOf({})).toBe("FULL_TIME");
    expect(employmentTypeOf(null)).toBe("FULL_TIME");
  });
});

describe("staffNameOf", () => {
  test("prefers the Thai name when HR supplied one", () => {
    expect(staffNameOf({ first_name_local: "อนงค์ภัสส์", last_name_local: "ทองอร่าม", first_name: "Anongpat", last_name: "Thongaram" })).toBe("อนงค์ภัสส์ ทองอร่าม");
  });

  test("falls back to the latin name, then to the id", () => {
    expect(staffNameOf({ first_name: "Anongpat", last_name: "Thongaram" })).toBe("Anongpat Thongaram");
    expect(staffNameOf({ id: "07132919" })).toBe("07132919");
  });
});

describe("buildRosterView", () => {
  const employees = [
    { id: "e1", first_name_local: "สมชาย", last_name_local: "ใจดี", position_time_type: "Full time", position: "Service Staff" },
    { id: "e2", first_name_local: "มานี", last_name_local: "รักงาน", position_time_type: "Part time", position: "Service Staff" },
  ];
  const days = ["2026-09-07", "2026-09-08"];

  test("places each shift on its own employee and date, bucketed by start time", () => {
    const view = buildRosterView({
      storeId: "1001",
      employees,
      shifts: [
        { employee_id: "e1", shift_date: "2026-09-07", start_time: "09:00:00" },
        { employee_id: "e2", shift_date: "2026-09-08", start_time: "13:00:00" },
      ],
      days,
    });

    expect(view.staff[0].shifts["2026-09-07"]).toMatchObject({ shiftId: "MORNING" });
    expect(view.staff[1].shifts["2026-09-08"]).toMatchObject({ shiftId: "EVENING" });
  });

  // A day the generator gave someone no shift IS a day off — it must render as
  // one rather than being missing from the grid.
  test("a day with no shift for an employee is an explicit day off", () => {
    const view = buildRosterView({ storeId: "1001", employees, shifts: [], days });
    expect(view.staff[0].shifts).toEqual({ "2026-09-07": { shiftId: null }, "2026-09-08": { shiftId: null } });
  });

  // The cell has to carry the real shift row so it can be reassigned to another
  // employee and can show the hours the generator set (which are not editable).
  test("a worked cell carries the real shift id, its clock times and planned hours", () => {
    const view = buildRosterView({
      storeId: "1001",
      employees,
      shifts: [{ id: "shift-9", employee_id: "e1", shift_date: "2026-09-07", start_time: "09:00:00", end_time: "18:00:00", planned_hours: 8, break_start_time: "13:00:00" }],
      days,
    });
    expect(view.staff[0].shifts["2026-09-07"]).toEqual({
      shiftId: "MORNING",
      rosterShiftId: "shift-9",
      startTime: "09:00",
      endTime: "18:00",
      plannedHours: 8,
      breakStartTime: "13:00",
    });
  });

  test("a shift missing its end time renders nothing rather than the text 'undef'", () => {
    const view = buildRosterView({
      storeId: "1001",
      employees,
      shifts: [{ id: "shift-9", employee_id: "e1", shift_date: "2026-09-07", start_time: "09:00:00" }],
      days,
    });
    expect(view.staff[0].shifts["2026-09-07"].endTime).toBeNull();
  });

  test("rows are labelled by position, and the name is kept only for the cell editor", () => {
    const view = buildRosterView({ storeId: "1001", employees, shifts: [], days });
    expect(view.staff.map((s) => s.positionLabel)).toEqual(["Service Staff 1", "Service Staff 2"]);
    expect(view.staff[0].name).toBe("สมชาย ใจดี");
  });

  test("every active employee gets a row, even with no shifts at all", () => {
    const view = buildRosterView({ storeId: "1001", employees, shifts: [], days });
    expect(view.staff.map((s) => s.name)).toEqual(["สมชาย ใจดี", "มานี รักงาน"]);
    expect(view.staff.map((s) => s.employmentType)).toEqual(["FULL_TIME", "PART_TIME"]);
  });

  test("shifts outside the requested days are ignored, not forced onto the grid", () => {
    const view = buildRosterView({
      storeId: "1001",
      employees,
      shifts: [{ employee_id: "e1", shift_date: "2026-10-01", start_time: "09:00:00" }],
      days,
    });
    expect(Object.keys(view.staff[0].shifts)).toEqual(days);
    expect(view.staff[0].shifts["2026-09-07"]).toEqual({ shiftId: null });
  });

  test("dailySales is filled for every day, defaulting a missing day to 0 rather than undefined", () => {
    const view = buildRosterView({ storeId: "1001", employees, shifts: [], days, dailySales: { "2026-09-07": 25000 } });
    expect(view.dailySales).toEqual({ "2026-09-07": 25000, "2026-09-08": 0 });
  });

  test("carries the quota and store id through untouched", () => {
    const view = buildRosterView({ storeId: "1001", employees, shifts: [], days, quota: 840 });
    expect(view.quota).toBe(840);
    expect(view.storeId).toBe("1001");
  });
});
