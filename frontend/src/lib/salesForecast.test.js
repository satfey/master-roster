import { describe, test, expect, vi } from "vitest";
import { fetchForecastPreview, fetchHourlyForecastPreview, summarizeForecast } from "./salesForecast.js";

describe("fetchForecastPreview", () => {
  test("calls GET /forecast/preview with storeId/startDate/endDate as query params", async () => {
    const apiGet = vi.fn().mockResolvedValue({ storeId: "1001", days: [] });

    await fetchForecastPreview(apiGet, { storeId: "1001", startDate: "2026-10-01", endDate: "2026-10-31" });

    expect(apiGet).toHaveBeenCalledWith("/forecast/preview?storeId=1001&startDate=2026-10-01&endDate=2026-10-31");
  });
});

describe("fetchHourlyForecastPreview", () => {
  test("calls GET /forecast/hourly/preview (never POST /forecast/hourly, which persists) with the same query shape", async () => {
    const apiGet = vi.fn().mockResolvedValue({ storeId: "1001", hourShapeSource: "STORE_HOUR_SHAPE", totalForecast: 0, days: [] });

    const result = await fetchHourlyForecastPreview(apiGet, { storeId: "1001", startDate: "2026-10-01", endDate: "2026-10-01" });

    expect(apiGet).toHaveBeenCalledWith("/forecast/hourly/preview?storeId=1001&startDate=2026-10-01&endDate=2026-10-01");
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(result.storeId).toBe("1001");
  });
});

describe("summarizeForecast", () => {
  test("returns null for an empty series", () => {
    expect(summarizeForecast([])).toBeNull();
  });

  test("computes total/average/peak/low across the day series", () => {
    const days = [
      { date: "2026-10-01", forecastedSales: 10000 },
      { date: "2026-10-02", forecastedSales: 30000 },
      { date: "2026-10-03", forecastedSales: 5000 },
    ];

    const summary = summarizeForecast(days);

    expect(summary.total).toBe(45000);
    expect(summary.average).toBe(15000);
    expect(summary.peak.date).toBe("2026-10-02");
    expect(summary.low.date).toBe("2026-10-03");
  });
});
