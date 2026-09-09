import { describe, test, expect } from "vitest";
import { allowedStoreIds, lockedStoreId } from "./storeAccess.js";

describe("allowedStoreIds — mirrors the backend storeScope.getAllowedStoreIds rule", () => {
  test("ADMIN and EXECUTIVE are unrestricted (null = every store)", () => {
    expect(allowedStoreIds({ role: "ADMIN", storeId: null })).toBeNull();
    expect(allowedStoreIds({ role: "EXECUTIVE", storeId: null })).toBeNull();
  });

  test("STORE_MANAGER is restricted to exactly their own store", () => {
    expect(allowedStoreIds({ role: "STORE_MANAGER", storeId: "1001" })).toEqual(["1001"]);
  });

  test("AREA_COACH is restricted to the stores assigned to them", () => {
    expect(allowedStoreIds({ role: "AREA_COACH", areaStoreIds: ["1001", "1514"] })).toEqual(["1001", "1514"]);
  });

  test("a STORE_MANAGER with no store assigned gets nothing, never everything", () => {
    expect(allowedStoreIds({ role: "STORE_MANAGER", storeId: null })).toEqual([]);
  });

  test("an unknown role or missing user gets nothing, never everything", () => {
    expect(allowedStoreIds({ role: "SOMETHING_ELSE" })).toEqual([]);
    expect(allowedStoreIds(null)).toEqual([]);
  });
});

describe("lockedStoreId — decides whether a store picker is shown at all", () => {
  test("a STORE_MANAGER is locked to their own store (no picker)", () => {
    expect(lockedStoreId({ role: "STORE_MANAGER", storeId: "1001" })).toBe("1001");
  });

  test("an ADMIN is never locked (picker shown)", () => {
    expect(lockedStoreId({ role: "ADMIN", storeId: null })).toBeNull();
  });

  test("an AREA_COACH with several stores is not locked (picker shown)", () => {
    expect(lockedStoreId({ role: "AREA_COACH", areaStoreIds: ["1001", "1514"] })).toBeNull();
  });

  test("an AREA_COACH who happens to have exactly one store is locked to it", () => {
    expect(lockedStoreId({ role: "AREA_COACH", areaStoreIds: ["1514"] })).toBe("1514");
  });

  test("a STORE_MANAGER with no store assigned is not locked to anything (and has no stores to pick either)", () => {
    expect(lockedStoreId({ role: "STORE_MANAGER", storeId: null })).toBeNull();
  });
});
