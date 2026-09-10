const { computeHourlyLaborDemand, computeLaborDemand, ABSURD_HEADCOUNT_THRESHOLD } = require('../laborDemandService');
const { operatingHourList } = require('../storeOperatingHours');

describe('laborDemandService.computeHourlyLaborDemand — requiredHeadcount (operational minimum)', () => {
  test('requiredHeadcount is the operational minimum (min_staff_per_shift, else 1) and never scales up with sales', () => {
    const hourlyForecast = [{ hour: 12, forecastedSales: 8000 }];
    const lowSales = computeHourlyLaborDemand({ hourlyForecast: [{ hour: 12, forecastedSales: 10 }], guideline: { target_productivity: 500, min_staff_per_shift: 1 } }).find((h) => h.hour === 12);
    const highSales = computeHourlyLaborDemand({ hourlyForecast, guideline: { target_productivity: 500, min_staff_per_shift: 1 } }).find((h) => h.hour === 12);

    expect(lowSales.requiredHeadcount).toBe(1);
    expect(highSales.requiredHeadcount).toBe(1); // same minimum regardless of sales — requiredHeadcount is not demand-scaled
  });

  test('10. min_staff_per_shift is a floor even when the hour has almost no sales', () => {
    const hourlyForecast = [{ hour: 9, forecastedSales: 100 }];
    const guideline = { target_productivity: 500, min_staff_per_shift: 3 };

    const demand = computeHourlyLaborDemand({ hourlyForecast, guideline }).find((h) => h.hour === 9);

    expect(demand.requiredHeadcount).toBe(3);
  });

  test('11. very low sales still requires at least 1 person during operating hours (never zero staff while open)', () => {
    const hourlyForecast = operatingHourList().map((hour) => ({ hour, forecastedSales: 0 }));
    const guideline = { target_productivity: 500, min_staff_per_shift: 0 };

    const demand = computeHourlyLaborDemand({ hourlyForecast, guideline });

    expect(demand.every((h) => h.requiredHeadcount >= 1)).toBe(true);
  });
});

describe('laborDemandService.computeHourlyLaborDemand — maxJustifiedHeadcount (productivity floor, not a target)', () => {
  test('8. maxJustifiedHeadcount = floor(sales / target_productivity), never ceil — productivity never drops below the floor because of this cap', () => {
    const hourlyForecast = [{ hour: 12, forecastedSales: 8000 }];
    const guideline = { target_productivity: 500, min_staff_per_shift: 1 };

    const [demand] = computeHourlyLaborDemand({ hourlyForecast, guideline }).filter((h) => h.hour === 12);

    expect(demand.requiredLaborHours).toBe(16); // 8000 / 500
    expect(demand.maxJustifiedHeadcount).toBe(16); // exact multiple — floor and ceil coincide here
    expect(8000 / demand.maxJustifiedHeadcount).toBeGreaterThanOrEqual(500);
  });

  test('the system does not add employees just to approach the productivity target — floor rounds down, never up toward it', () => {
    // 751 / 700 = 1.073 -> ceil would give 2 (productivity would fall to 375.5, BELOW the floor); floor correctly gives 1.
    const hourlyForecast = [{ hour: 12, forecastedSales: 751 }];
    const guideline = { target_productivity: 700, min_staff_per_shift: 1 };

    const demand = computeHourlyLaborDemand({ hourlyForecast, guideline }).find((h) => h.hour === 12);

    expect(demand.maxJustifiedHeadcount).toBe(1);
    expect(751 / demand.maxJustifiedHeadcount).toBeGreaterThanOrEqual(700); // never pushed below the floor
  });

  test('productivity can be, and often is, significantly higher than the floor — the cap does not chase the target down', () => {
    const hourlyForecast = [{ hour: 12, forecastedSales: 1350 }]; // just under 2x the floor
    const guideline = { target_productivity: 700, min_staff_per_shift: 1 };

    const demand = computeHourlyLaborDemand({ hourlyForecast, guideline }).find((h) => h.hour === 12);

    expect(demand.maxJustifiedHeadcount).toBe(1); // floor(1350/700) = 1, not 2
    expect(1350 / demand.maxJustifiedHeadcount).toBe(1350); // productivity well above 700, and that's fine — not "corrected" toward the floor
  });

  test('9. a higher target_productivity lowers the justified headcount for the same sales, and vice versa', () => {
    const hourlyForecast = [{ hour: 12, forecastedSales: 8000 }];
    const lean = computeHourlyLaborDemand({ hourlyForecast, guideline: { target_productivity: 1000 } }).find((h) => h.hour === 12);
    const loose = computeHourlyLaborDemand({ hourlyForecast, guideline: { target_productivity: 200 } }).find((h) => h.hour === 12);

    expect(lean.requiredLaborHours).toBe(8);
    expect(loose.requiredLaborHours).toBe(40);
  });

  test('high-sales hours have visibly higher maxJustifiedHeadcount than low-sales hours — the cap still reflects hourly demand shape', () => {
    const guideline = { target_productivity: 700, min_staff_per_shift: 1 };
    const quiet = computeHourlyLaborDemand({ hourlyForecast: [{ hour: 9, forecastedSales: 700 }], guideline }).find((h) => h.hour === 9);
    const peak = computeHourlyLaborDemand({ hourlyForecast: [{ hour: 12, forecastedSales: 3500 }], guideline }).find((h) => h.hour === 12);

    expect(quiet.maxJustifiedHeadcount).toBe(1);
    expect(peak.maxJustifiedHeadcount).toBeGreaterThan(quiet.maxJustifiedHeadcount);
  });

  test('12. very high sales scales the justified headcount up, and computeLaborDemand flags it as a sanity warning', () => {
    const days = [{ date: '2026-08-24', hours: operatingHourList().map((hour) => ({ hour, forecastedSales: hour === 12 ? 10000000 : 1000 })) }];
    const guideline = { target_productivity: 500, min_staff_per_shift: 1 };

    const { days: result, warnings } = computeLaborDemand({ days, guideline });

    const peakHour = result[0].hours.find((h) => h.hour === 12);
    expect(peakHour.maxJustifiedHeadcount).toBeGreaterThan(ABSURD_HEADCOUNT_THRESHOLD);
    expect(warnings.some((w) => w.includes('Unusually high productivity-justified headcount'))).toBe(true);
  });

  test('with no labor guideline at all, both fields collapse to the operational minimum and a warning is raised', () => {
    const days = [{ date: '2026-08-24', hours: operatingHourList().map((hour) => ({ hour, forecastedSales: 5000 })) }];

    const { days: result, warnings } = computeLaborDemand({ days, guideline: null });

    expect(result[0].hours.every((h) => h.requiredHeadcount === 1)).toBe(true);
    expect(result[0].hours.every((h) => h.maxJustifiedHeadcount === 1)).toBe(true);
    expect(result[0].hours.every((h) => h.requiredLaborHours === null)).toBe(true);
    expect(warnings.some((w) => w.includes('No labor guideline configured'))).toBe(true);
  });
});
