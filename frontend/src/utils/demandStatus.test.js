import { describe, test, expect } from "vitest";
import { statusOf, buildDemandRows } from "./rosterUtils.js";
import { ROSTER_STATUS_LEGEND } from "../config/rosterDisplay.js";

describe("statusOf — red below minimum, yellow above what sales justify, green in between", () => {
  test("fewer people than the minimum is understaffed (red)", () => {
    expect(statusOf(1, 3, 0)).toBe("understaffed");
    expect(statusOf(2, 3, 1)).toBe("understaffed");
  });

  test("between the minimum and the justified number is matched (green)", () => {
    expect(statusOf(1, 3, 1)).toBe("matched");
    expect(statusOf(1, 3, 2)).toBe("matched");
    expect(statusOf(1, 3, 3)).toBe("matched");
  });

  test("more people than sales justify is overstaffed (yellow)", () => {
    expect(statusOf(1, 2, 3)).toBe("overstaffed");
  });

  test("the justified number never falls below the minimum", () => {
    // minimum 2, sales justify 1: two people is what the store must have, not overstaffing
    expect(statusOf(2, 1, 2)).toBe("matched");
    expect(statusOf(2, 1, 3)).toBe("overstaffed");
  });

  test("the legend offers all three states", () => {
    expect(ROSTER_STATUS_LEGEND.map((l) => [l.id, l.tone])).toEqual([
      ["understaffed", "red"],
      ["matched", "green"],
      ["overstaffed", "amber"],
    ]);
  });
});

describe("buildDemandRows — cells read scheduled/justified", () => {
  const onShift = (id, start, end, breakStart = null) => ({
    id,
    shifts: { "2026-09-04": { startTime: start, endTime: end, breakStartTime: breakStart } },
  });
  const day = (hours) => [{ date: "2026-09-04", hours }];

  test("2 on the floor where sales justify 3 and 1 is required is green", () => {
    const staff = [onShift("A", "12:00", "16:00"), onShift("B", "14:00", "22:00")];
    const [row] = buildDemandRows(staff, ["2026-09-04"], day([{ hour: 15, requiredHeadcount: 1, maxJustifiedHeadcount: 3 }]));
    expect(row.cells[0]).toMatchObject({ scheduled: 2, demand: 3, required: 1, status: "matched" });
  });

  test("3 on the floor where sales justify 2 is yellow (the 3/2 case)", () => {
    const staff = [onShift("A", "12:00", "16:00"), onShift("B", "14:00", "22:00"), onShift("C", "15:00", "19:00")];
    const [row] = buildDemandRows(staff, ["2026-09-04"], day([{ hour: 15, requiredHeadcount: 1, maxJustifiedHeadcount: 2 }]));
    expect(row.cells[0]).toMatchObject({ scheduled: 3, demand: 2, status: "overstaffed" });
  });

  test("the two mandatory closers at 21:00 are green even when sales justify only one", () => {
    const staff = [onShift("A", "18:00", "22:00"), onShift("B", "18:00", "22:00")];
    const [row] = buildDemandRows(staff, ["2026-09-04"], day([{ hour: 21, requiredHeadcount: 1, maxJustifiedHeadcount: 1 }]));
    expect(row.cells[0]).toMatchObject({ scheduled: 2, required: 2, status: "matched" });
  });

  test("a third body at 21:00 on that same evening is yellow", () => {
    const staff = [onShift("A", "18:00", "22:00"), onShift("B", "18:00", "22:00"), onShift("C", "17:00", "22:00")];
    const [row] = buildDemandRows(staff, ["2026-09-04"], day([{ hour: 21, requiredHeadcount: 1, maxJustifiedHeadcount: 1 }]));
    expect(row.cells[0]).toMatchObject({ scheduled: 3, status: "overstaffed" });
  });

  test("someone on break at that hour does not count as on the floor", () => {
    const staff = [onShift("A", "12:00", "16:00"), onShift("B", "10:00", "19:00", "15:00")];
    const [row] = buildDemandRows(staff, ["2026-09-04"], day([{ hour: 15, requiredHeadcount: 1, maxJustifiedHeadcount: 3 }]));
    expect(row.cells[0].scheduled).toBe(1);
  });
});
