import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api.js", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

const api = await import("../lib/api.js");
const {
  employmentTypeOf,
  toStaffRow,
  buildCreatePayload,
  listEmployees,
  createEmployee,
  changeEmploymentType,
  removeEmployee,
  removalMessage,
} = await import("./employeeService.js");

beforeEach(() => vi.clearAllMocks());

describe("employmentTypeOf", () => {
  test("reads the backend spellings in any case", () => {
    expect(employmentTypeOf("Full time")).toBe("FULL_TIME");
    expect(employmentTypeOf("part time")).toBe("PART_TIME");
  });

  test("anything the generator cannot schedule is null, never a guessed default", () => {
    expect(employmentTypeOf(null)).toBeNull();
    expect(employmentTypeOf("Contractor")).toBeNull();
  });
});

describe("toStaffRow", () => {
  test("prefers the local name, and falls back to 48 weekly hours like the backend", () => {
    expect(
      toStaffRow({ id: "07123675", first_name: "Nida", last_name: "S", first_name_local: "นิดา", last_name_local: "สุขใจ", position: "Service Staff", position_time_type: "Part time", default_weekly_hours: null })
    ).toEqual({ id: "07123675", name: "นิดา สุขใจ", position: "Service Staff", employmentType: "PART_TIME", weeklyHours: 48 });
  });
});

describe("buildCreatePayload", () => {
  test("a complete form becomes the POST body with the backend's type spelling", () => {
    const { errors, payload } = buildCreatePayload("1001", { employeeId: " 07999999 ", firstName: "Nida", lastName: "", position: "", employmentType: "PART_TIME" });
    expect(errors).toEqual([]);
    expect(payload).toEqual({ employeeId: "07999999", storeId: "1001", firstName: "Nida", lastName: null, position: null, positionTimeType: "Part time" });
  });

  test("missing store, ID, name and type are all reported at once", () => {
    const { errors, payload } = buildCreatePayload(null, { employeeId: "", firstName: " ", employmentType: "DUAL_VOCATIONAL" });
    expect(payload).toBeNull();
    expect(errors).toHaveLength(4);
  });
});

describe("calls to the backend", () => {
  test("list reads the store's employees", async () => {
    api.apiGet.mockResolvedValue([{ id: "1", first_name: "A", position_time_type: "Full time" }]);
    const rows = await listEmployees("1001");
    expect(api.apiGet).toHaveBeenCalledWith("/employee?storeId=1001");
    expect(rows[0]).toMatchObject({ id: "1", employmentType: "FULL_TIME" });
  });

  test("create posts to the database and never sends an invalid form", async () => {
    api.apiPost.mockResolvedValue({ id: "07999999", first_name: "Nida", position_time_type: "Part time" });
    await createEmployee("1001", { employeeId: "07999999", firstName: "Nida", employmentType: "PART_TIME" });
    expect(api.apiPost).toHaveBeenCalledWith("/employee", expect.objectContaining({ employeeId: "07999999", storeId: "1001", positionTimeType: "Part time" }));

    await expect(createEmployee("1001", { employeeId: "", firstName: "", employmentType: "PART_TIME" })).rejects.toThrow();
    expect(api.apiPost).toHaveBeenCalledTimes(1);
  });

  test("changing the type sends only the type", async () => {
    api.apiPut.mockResolvedValue({ id: "1", first_name: "A", position_time_type: "Part time" });
    await changeEmploymentType("00011402", "PART_TIME");
    expect(api.apiPut).toHaveBeenCalledWith("/employee/00011402", { positionTimeType: "Part time" });
  });

  test("remove calls DELETE on the employee", async () => {
    api.apiDelete.mockResolvedValue({ deleted: true });
    await removeEmployee("00011402");
    expect(api.apiDelete).toHaveBeenCalledWith("/employee/00011402");
  });
});

describe("removalMessage", () => {
  test("a real delete says it was deleted", () => {
    expect(removalMessage("นิดา", { deleted: true })).toContain("ลบ นิดา ออกจากระบบแล้ว");
  });

  test("an employee with roster history is reported as deactivated, with any future shifts", () => {
    const msg = removalMessage("นิดา", { deleted: false, deactivated: true, futureShiftCount: 3 });
    expect(msg).toContain("ปิดการใช้งานแทนการลบ");
    expect(msg).toContain("3 กะ");
  });
});
