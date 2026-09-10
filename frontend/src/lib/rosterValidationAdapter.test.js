import { describe, test, expect } from "vitest";
import { hourIssueCountsByDate, toDisplayValidation, toStaffResults, toStoreIssues, violationDaysForStaff } from "./rosterValidationAdapter.js";

const staff = [
  { id: "e1", name: "สมชาย ใจดี" },
  { id: "e2", name: "มานี รักงาน" },
];

describe("toStoreIssues — store-level findings come from the backend verdict", () => {
  test("failed closing cover is an error, and states the real 2-person rule", () => {
    const issues = toStoreIssues({ openingCoverageOk: true, closingCoverageOk: false });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "NO_CLOSER", severity: "error" });
    expect(issues[0].message).toContain("2 คน");
  });

  test("understaffed hours are grouped into one line per day, not one per hour", () => {
    const issues = toStoreIssues({
      understaffedHours: ["2026-09-01 14:00", "2026-09-01 15:00", "2026-09-02 09:00"],
    });
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ code: "UNDERSTAFFED", day: "2026-09-01", severity: "warning" });
    expect(issues[0].message).toContain("2 ชั่วโมง");
  });

  // The backend grades these as WARNING, never FAILED — the display must agree,
  // or a manager sees a blocking error the generator never raised.
  test("under/overstaffing is a warning, matching how the backend grades it", () => {
    const issues = toStoreIssues({ understaffedHours: ["2026-09-01 14:00"], overstaffedHours: ["2026-09-02 10:00"] });
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
  });

  test("a clean validation produces no issues at all", () => {
    expect(toStoreIssues({ openingCoverageOk: true, closingCoverageOk: true })).toEqual([]);
  });

  test("a missing validation response is empty, never a fabricated pass or fail", () => {
    expect(toStoreIssues(null)).toEqual([]);
  });
});

describe("toStaffResults — per-employee findings regroup onto staff rows", () => {
  test("groups every violation type onto the right employee, with their name", () => {
    const results = toStaffResults(
      {
        ftWorkingHoursViolations: [{ employeeId: "e1", date: "2026-09-01", plannedHours: 7 }],
        ptHoursViolations: [{ employeeId: "e2", date: "2026-09-02", plannedHours: 3 }],
        consecutiveDayViolations: [{ employeeId: "e1", consecutiveWorkingDays: 7 }],
      },
      staff
    );

    const e1 = results.find((r) => r.staffId === "e1");
    expect(e1.name).toBe("สมชาย ใจดี");
    expect(e1.violations.map((v) => v.code).sort()).toEqual(["CONSECUTIVE_DAYS", "FT_HOURS"]);
    expect(results.find((r) => r.staffId === "e2").violations[0].code).toBe("PT_HOURS");
  });

  test("the 09:00-22:00 shift window violation is reported with the real hours", () => {
    const results = toStaffResults(
      { shiftWindowViolations: [{ employeeId: "e1", date: "2026-09-01", startTime: "08:00:00", endTime: "23:00:00" }] },
      staff
    );
    expect(results[0].violations[0].message).toContain("09:00-22:00");
  });

  test("an employee with no violations does not appear at all", () => {
    const results = toStaffResults({ ftWorkingHoursViolations: [{ employeeId: "e1", date: "2026-09-01", plannedHours: 7 }] }, staff);
    expect(results.map((r) => r.staffId)).toEqual(["e1"]);
  });

  test("an unknown employee id still reports, falling back to the id as the name", () => {
    const results = toStaffResults({ ptHoursViolations: [{ employeeId: "ghost", date: "2026-09-01", plannedHours: 2 }] }, staff);
    expect(results[0]).toMatchObject({ staffId: "ghost", name: "ghost" });
  });
});

describe("hourIssueCountsByDate — replaces the old sales-band headcount guess", () => {
  test("counts flagged hours per day for each direction", () => {
    const counts = hourIssueCountsByDate({
      understaffedHours: ["2026-09-01 14:00", "2026-09-01 15:00"],
      overstaffedHours: ["2026-09-01 10:00", "2026-09-02 11:00"],
    });
    expect(counts["2026-09-01"]).toEqual({ understaffed: 2, overstaffed: 1 });
    expect(counts["2026-09-02"]).toEqual({ understaffed: 0, overstaffed: 1 });
  });

  test("a day the backend never flagged simply has no entry", () => {
    expect(hourIssueCountsByDate({ understaffedHours: [] })["2026-09-01"]).toBeUndefined();
  });
});

describe("violationDaysForStaff", () => {
  test("returns only the dated violations for that employee", () => {
    const staffResults = [
      { staffId: "e1", violations: [{ day: "2026-09-01" }, { day: "2026-09-03" }, { severity: "error" }] },
      { staffId: "e2", violations: [{ day: "2026-09-02" }] },
    ];
    expect([...violationDaysForStaff(staffResults, "e1")]).toEqual(["2026-09-01", "2026-09-03"]);
    expect([...violationDaysForStaff(staffResults, "unknown")]).toEqual([]);
  });
});

describe("toDisplayValidation", () => {
  test("returns all three views plus the backend's own status", () => {
    const result = toDisplayValidation(
      { status: "WARNING", understaffedHours: ["2026-09-01 14:00"], ptHoursViolations: [{ employeeId: "e2", date: "2026-09-01", plannedHours: 2 }] },
      staff
    );
    expect(result.status).toBe("WARNING");
    expect(result.storeIssues).toHaveLength(1);
    expect(result.staffResults).toHaveLength(1);
    expect(result.hourIssuesByDate["2026-09-01"].understaffed).toBe(1);
  });
});
