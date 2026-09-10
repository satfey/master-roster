import { describe, test, expect } from "vitest";
import { buildRosterView, eachDate } from "../lib/rosterAdapter.js";
import { cellWorkHours, staffWeeklyHours, totalScheduledHours } from "./rosterUtils.js";

// Real shift rows as the backend returns them: the generator sizes shifts to demand, so a
// Part-timer's day is routinely 4 or 5 hours, not the flat 6 their contract type suggests.
const employees = [
  { id: "FT1", first_name_local: "สมชาย", last_name_local: "ใจดี", position_time_type: "Full time", position: "Service Staff" },
  { id: "PT1", first_name_local: "มานี", last_name_local: "รักงาน", position_time_type: "Part time", position: "Service Staff" },
  { id: "PT2", first_name_local: "วิภา", last_name_local: "ทองดี", position_time_type: "Part time", position: "Service Staff" },
];
const days = eachDate("2026-09-07", "2026-09-08");
const shifts = [
  { id: "s1", employee_id: "FT1", shift_date: "2026-09-07", start_time: "09:00:00", end_time: "18:00:00", planned_hours: 8 },
  { id: "s2", employee_id: "PT1", shift_date: "2026-09-07", start_time: "18:00:00", end_time: "22:00:00", planned_hours: 4 },
  { id: "s3", employee_id: "PT2", shift_date: "2026-09-07", start_time: "16:00:00", end_time: "21:00:00", planned_hours: 5 },
  { id: "s4", employee_id: "FT1", shift_date: "2026-09-08", start_time: "09:00:00", end_time: "18:00:00", planned_hours: 8 },
];
const view = buildRosterView({ storeId: "1001", employees, shifts, days, dailySales: {}, quota: 840, blocks: [] });

describe("cellWorkHours — real planned hours, not the assumed contract length", () => {
  test("a 4-hour Part-time shift counts as 4, not the contract's 6", () => {
    expect(cellWorkHours(view.staff[1].shifts["2026-09-07"], "PART_TIME")).toBe(4);
  });

  test("a 5-hour Part-time shift counts as 5", () => {
    expect(cellWorkHours(view.staff[2].shifts["2026-09-07"], "PART_TIME")).toBe(5);
  });

  test("a day off counts as 0", () => {
    expect(cellWorkHours(view.staff[1].shifts["2026-09-08"], "PART_TIME")).toBe(0);
  });

  // Mock screens still pass cells with no real shift behind them; those keep the old behaviour.
  test("a cell with no real shift falls back to the contract length", () => {
    expect(cellWorkHours({ shiftId: "MORNING" }, "PART_TIME")).toBe(6);
    expect(cellWorkHours({ shiftId: "MORNING" }, "FULL_TIME")).toBe(8);
  });
});

describe("hour totals agree across the screen", () => {
  const backendTotal = shifts.reduce((sum, s) => sum + s.planned_hours, 0); // 8+4+5+8 = 25

  // The bug this pins: Schedule Generation summed assumed contract hours (8+6+6+8 = 28) while the
  // grid's own per-day row summed real planned hours (25), so the two panels on the same screen
  // disagreed about the same week.
  test("Schedule Generation's total equals the grid's per-day total equals the real planned hours", () => {
    const scheduleGeneration = totalScheduledHours(view.staff, days);
    const gridPerDay = view.staff.reduce(
      (sum, member) => sum + days.reduce((d, day) => d + (member.shifts[day]?.plannedHours ?? 0), 0),
      0
    );

    expect(scheduleGeneration).toBe(backendTotal);
    expect(gridPerDay).toBe(backendTotal);
    expect(scheduleGeneration).toBe(gridPerDay);
  });

  test("one employee's row total is their own real hours", () => {
    expect(staffWeeklyHours(view.staff[0], days)).toBe(16); // FT1: 8 + 8
    expect(staffWeeklyHours(view.staff[1], days)).toBe(4); // PT1: 4 + day off
  });

  test("per-day totals match that day's shifts", () => {
    const dayTotal = (day) => view.staff.reduce((sum, m) => sum + (m.shifts[day]?.plannedHours ?? 0), 0);
    expect(dayTotal("2026-09-07")).toBe(17); // 8 + 4 + 5
    expect(dayTotal("2026-09-08")).toBe(8);
  });
});
