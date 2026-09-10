import { describe, test, expect, vi } from "vitest";
import { resolveRoster, forceRegenerateRoster, filterShiftsInRange } from "./autoRoster.js";

const STORE_ID = "1001";
const START = "2026-09-01";
const END = "2026-09-07";

function existingRosterResponse() {
  return [
    {
      id: "roster-1",
      shift: [
        { id: "s1", shift_date: "2026-09-02", employee_id: "e1" },
        { id: "s2", shift_date: "2026-09-03", employee_id: "e1" },
      ],
    },
  ];
}

function generatedShiftsResponse() {
  return { id: "roster-2", shift: [{ id: "s3", shift_date: "2026-09-01", employee_id: "e2" }] };
}

describe("filterShiftsInRange", () => {
  test("keeps only shifts whose date falls within the inclusive range", () => {
    const rosters = [
      { shift: [{ shift_date: "2026-08-31" }, { shift_date: "2026-09-01" }, { shift_date: "2026-09-07" }, { shift_date: "2026-09-08" }] },
    ];
    expect(filterShiftsInRange(rosters, "2026-09-01", "2026-09-07").map((s) => s.shift_date)).toEqual(["2026-09-01", "2026-09-07"]);
  });

  test("flattens shifts across multiple rosters", () => {
    const rosters = [{ shift: [{ shift_date: "2026-09-01" }] }, { shift: [{ shift_date: "2026-09-02" }] }];
    expect(filterShiftsInRange(rosters, "2026-09-01", "2026-09-07")).toHaveLength(2);
  });
});

describe("resolveRoster (Auto Generate button)", () => {
  test("no existing roster: generates for the first time with regenerate: false, and never calls it any other way", async () => {
    const apiGet = vi.fn((path) => {
      if (path.startsWith("/roster?storeId=")) return Promise.resolve([]); // nothing exists yet
      if (path === "/roster/roster-2") return Promise.resolve(generatedShiftsResponse());
      throw new Error("unexpected apiGet " + path);
    });
    const apiPost = vi.fn(() => Promise.resolve({ rosterIds: ["roster-2"], generatedShifts: 1, totalLaborHours: 8 }));

    const out = await resolveRoster({ apiGet, apiPost }, { storeId: STORE_ID, startDate: START, endDate: END });

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith("/roster/auto-generate", { storeId: STORE_ID, startDate: START, endDate: END, regenerate: false });
    expect(out.status).toBe("generated");
    expect(out.shifts).toEqual([{ id: "s3", shift_date: "2026-09-01", employee_id: "e2" }]);
  });

  test("an existing roster: returns it and never calls the write endpoint", async () => {
    const apiGet = vi.fn((path) => {
      if (path.startsWith("/roster?storeId=")) return Promise.resolve(existingRosterResponse());
      throw new Error("unexpected apiGet " + path);
    });
    const apiPost = vi.fn();

    const out = await resolveRoster({ apiGet, apiPost }, { storeId: STORE_ID, startDate: START, endDate: END });

    expect(apiPost).not.toHaveBeenCalled();
    expect(out.status).toBe("existing");
    expect(out.shifts).toHaveLength(2);
    expect(out.result).toBeNull();
  });

  test("calling it repeatedly once a roster exists never creates a duplicate (write endpoint stays untouched every time)", async () => {
    const apiGet = vi.fn((path) => {
      if (path.startsWith("/roster?storeId=")) return Promise.resolve(existingRosterResponse());
      throw new Error("unexpected apiGet " + path);
    });
    const apiPost = vi.fn();

    await resolveRoster({ apiGet, apiPost }, { storeId: STORE_ID, startDate: START, endDate: END });
    await resolveRoster({ apiGet, apiPost }, { storeId: STORE_ID, startDate: START, endDate: END });
    await resolveRoster({ apiGet, apiPost }, { storeId: STORE_ID, startDate: START, endDate: END });

    expect(apiPost).not.toHaveBeenCalled();
  });

  test("propagates an error unchanged (e.g. a 401 from api.js) instead of swallowing it", async () => {
    const apiGet = vi.fn(() => Promise.reject(new Error("Not authenticated")));
    const apiPost = vi.fn();

    await expect(resolveRoster({ apiGet, apiPost }, { storeId: STORE_ID, startDate: START, endDate: END })).rejects.toThrow("Not authenticated");
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe("forceRegenerateRoster (Regenerate button, only reached after UI confirmation)", () => {
  test("always sends regenerate: true, even when a roster already exists", async () => {
    const apiGet = vi.fn((path) => {
      if (path === "/roster/roster-2") return Promise.resolve(generatedShiftsResponse());
      throw new Error("unexpected apiGet " + path);
    });
    const apiPost = vi.fn(() => Promise.resolve({ rosterIds: ["roster-2"], generatedShifts: 1, totalLaborHours: 8 }));

    const out = await forceRegenerateRoster({ apiGet, apiPost }, { storeId: STORE_ID, startDate: START, endDate: END });

    expect(apiPost).toHaveBeenCalledWith("/roster/auto-generate", { storeId: STORE_ID, startDate: START, endDate: END, regenerate: true });
    expect(out.status).toBe("generated");
  });
});
