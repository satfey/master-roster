jest.mock('../../repositories/laborBudgetRepository', () => ({
  findGrossBudget: jest.fn(),
  findGrossBudgetRange: jest.fn(),
  findGuidelineTiers: jest.fn(),
  findAllGuidelineTiers: jest.fn(),
  createGuidelineTier: jest.fn(),
  updateGuidelineTier: jest.fn(),
  deleteGuidelineTier: jest.fn(),
  upsertStoreActualHours: jest.fn(),
  findStoreActualHours: jest.fn(),
}));
const laborBudgetRepo = require('../../repositories/laborBudgetRepository');
const { resolveSalesLevel, matchTier, computeDailyLaborHoursBudget, computeLaborCostBudget } = require('../laborBudgetService');

function tier({ storeId = null, salesMin, salesMax, allowedLaborHours = null, weekdayLaborHours = null, weekendLaborHours = null, level = null, standardWorkingHours = null, minStaffCount = null }) {
  return {
    id: `tier-${salesMin}-${salesMax}-${storeId ?? 'global'}`,
    store_id: storeId, sales_min: salesMin, sales_max: salesMax, allowed_labor_hours: allowedLaborHours,
    weekday_labor_hours: weekdayLaborHours, weekend_labor_hours: weekendLaborHours,
    level, standard_working_hours: standardWorkingHours, min_staff_count: minStaffCount,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('laborBudgetService.resolveSalesLevel — gross_budget preferred, forecast fallback', () => {
  test('uses sales_report.gross_budget when a budget has been entered for the date', async () => {
    laborBudgetRepo.findGrossBudget.mockResolvedValue(45900);

    const result = await resolveSalesLevel({ storeId: '1001', date: '2026-08-24', forecastValue: 30000 });

    expect(result).toEqual({ value: 45900, source: 'GROSS_BUDGET' });
  });

  test('falls back to the forecast value when no budget is entered for the date', async () => {
    laborBudgetRepo.findGrossBudget.mockResolvedValue(null);

    const result = await resolveSalesLevel({ storeId: '1001', date: '2026-08-24', forecastValue: 30000 });

    expect(result).toEqual({ value: 30000, source: 'FORECAST' });
  });

  test('returns a null sales level when neither a budget nor a forecast is available', async () => {
    laborBudgetRepo.findGrossBudget.mockResolvedValue(null);

    const result = await resolveSalesLevel({ storeId: '1001', date: '2026-08-24', forecastValue: null });

    expect(result).toEqual({ value: null, source: null });
  });
});

describe('laborBudgetService.matchTier', () => {
  test('1. matches the tier whose range contains the sales level', () => {
    const tiers = [tier({ salesMin: 0, salesMax: 49999, allowedLaborHours: 12 }), tier({ salesMin: 50000, salesMax: 99999, allowedLaborHours: 20 })];

    expect(matchTier(tiers, 30000)).toMatchObject({ allowedLaborHours: 12 });
    expect(matchTier(tiers, 75000)).toMatchObject({ allowedLaborHours: 20 });
  });

  test('returns null when no tier is configured at all (the default, empty-table state)', () => {
    expect(matchTier([], 30000)).toBeNull();
  });

  test('returns null when the sales level falls outside every configured range', () => {
    const tiers = [tier({ salesMin: 0, salesMax: 49999, allowedLaborHours: 12 })];
    expect(matchTier(tiers, 500000)).toBeNull();
  });

  test('a store-specific override takes priority over the global default tier', () => {
    const tiers = [tier({ storeId: null, salesMin: 0, salesMax: 49999, allowedLaborHours: 12 }), tier({ storeId: '1001', salesMin: 0, salesMax: 49999, allowedLaborHours: 18 })];

    const match = matchTier(tiers, 30000);

    expect(match.allowedLaborHours).toBe(18);
    expect(match.tierSource).toBe('STORE_TIER');
  });

  test('weekday_labor_hours / weekend_labor_hours take priority over the legacy flat allowed_labor_hours when set', () => {
    const tiers = [tier({ salesMin: 200000, salesMax: 249999, weekdayLaborHours: 25, weekendLaborHours: 28 })];

    expect(matchTier(tiers, 220000, { isWeekend: false })).toMatchObject({ allowedLaborHours: 25, dayType: 'WEEKDAY' });
    expect(matchTier(tiers, 220000, { isWeekend: true })).toMatchObject({ allowedLaborHours: 28, dayType: 'WEEKEND' });
  });

  test('falls back to the legacy flat allowed_labor_hours when a tier has no weekday/weekend split', () => {
    const tiers = [tier({ salesMin: 0, salesMax: 6000, allowedLaborHours: 12 })]; // Level 1-12 style row, no split given

    expect(matchTier(tiers, 3000, { isWeekend: false })).toMatchObject({ allowedLaborHours: 12 });
    expect(matchTier(tiers, 3000, { isWeekend: true })).toMatchObject({ allowedLaborHours: 12 });
  });
});

describe('laborBudgetService.computeDailyLaborHoursBudget', () => {
  test('1. daily budget constraint: resolves the sales level and the matching tier together', async () => {
    laborBudgetRepo.findGrossBudget.mockResolvedValue(45900);
    laborBudgetRepo.findGuidelineTiers.mockResolvedValue([tier({ salesMin: 0, salesMax: 49999, allowedLaborHours: 12 })]);

    const result = await computeDailyLaborHoursBudget({ storeId: '1001', date: '2026-08-24', forecastValue: null });

    expect(result).toEqual({
      salesLevel: 45900, salesLevelSource: 'GROSS_BUDGET', allowedLaborHours: 12, tierSource: 'GLOBAL_TIER', dayType: 'WEEKDAY',
      level: null, standardWorkingHours: null, minStaffCount: null,
    });
  });

  test('the Master-Revise sheet\'s level/standard-working-hours/staff-count columns pass through when present on the matched tier', async () => {
    laborBudgetRepo.findGrossBudget.mockResolvedValue(9500); // within the 8,001-10,000 range -> Level 3
    laborBudgetRepo.findGuidelineTiers.mockResolvedValue([tier({ salesMin: 8001, salesMax: 10000, allowedLaborHours: 12, level: 3 })]);

    const result = await computeDailyLaborHoursBudget({ storeId: '1001', date: '2026-08-24', forecastValue: null });

    expect(result.level).toBe(3);
    expect(result.allowedLaborHours).toBe(12);
  });

  test('a Saturday/Sunday date resolves to weekend_labor_hours, a weekday date to weekday_labor_hours', async () => {
    laborBudgetRepo.findGrossBudget.mockResolvedValue(220000); // 200,000-249,999 range
    laborBudgetRepo.findGuidelineTiers.mockResolvedValue([tier({ salesMin: 200000, salesMax: 249999, weekdayLaborHours: 25, weekendLaborHours: 28 })]);

    const monday = await computeDailyLaborHoursBudget({ storeId: '1001', date: '2026-08-31' }); // Monday
    const saturday = await computeDailyLaborHoursBudget({ storeId: '1001', date: '2026-08-29' }); // Saturday
    const sunday = await computeDailyLaborHoursBudget({ storeId: '1001', date: '2026-08-30' }); // Sunday

    expect(monday).toMatchObject({ allowedLaborHours: 25, dayType: 'WEEKDAY' });
    expect(saturday).toMatchObject({ allowedLaborHours: 28, dayType: 'WEEKEND' });
    expect(sunday).toMatchObject({ allowedLaborHours: 28, dayType: 'WEEKEND' });
  });

  test('allowedLaborHours is null when no tier is configured — the documented fallback-to-target_productivity signal', async () => {
    laborBudgetRepo.findGrossBudget.mockResolvedValue(45900);
    laborBudgetRepo.findGuidelineTiers.mockResolvedValue([]);

    const result = await computeDailyLaborHoursBudget({ storeId: '1001', date: '2026-08-24', forecastValue: null });

    expect(result.allowedLaborHours).toBeNull();
  });
});

describe('laborBudgetService.matchTier — the new flat Sales/Day -> Standard Working Hours guideline (MON-FRI = SAT-SUN, no weekday/weekend split needed)', () => {
  // One test per bracket of the given table — a flat allowed_labor_hours tier (no
  // weekday_labor_hours/weekend_labor_hours) already resolves to the same hour value
  // on both a weekday and a weekend date, so no code change was needed for "MON-FRI
  // and SAT-SUN are equal in this table" — this locks in the exact given values.
  test.each([
    [0, 250000, 100000, 28],
    [250001, 330000, 300000, 26],
    [330001, 410000, 370000, 27],
    [410001, 500000, 450000, 28],
    [500001, 540000, 520000, 33],
    [540001, 620000, 580000, 34],
    [620001, 660000, 640000, 35],
    [660001, 700000, 680000, 36],
    [700001, 780000, 740000, 38],
    [780001, 870000, 820000, 43],
    [870001, 950000, 900000, 43],
    [950001, 1500000, 1200000, 43],
  ])('sales %i-%i (sample %i) -> %i standard working hours/day, identical on a weekday and a weekend date', (salesMin, salesMax, sample, expectedHours) => {
    const tiers = [tier({ salesMin, salesMax, allowedLaborHours: expectedHours })];

    const weekday = matchTier(tiers, sample, { isWeekend: false });
    const weekend = matchTier(tiers, sample, { isWeekend: true });

    expect(weekday.allowedLaborHours).toBe(expectedHours);
    expect(weekend.allowedLaborHours).toBe(expectedHours);
  });
});

describe('laborBudgetService.computeLaborCostBudget', () => {
  test('2. labor budget constraint: laborBudget = salesLevel x (target_col_percent / 100)', () => {
    const result = computeLaborCostBudget({ salesLevel: 50000, guideline: { target_col_percent: 15 } });
    expect(result).toBe(7500);
  });

  test('returns null when there is no sales level or no target_col_percent configured', () => {
    expect(computeLaborCostBudget({ salesLevel: null, guideline: { target_col_percent: 15 } })).toBeNull();
    expect(computeLaborCostBudget({ salesLevel: 50000, guideline: null })).toBeNull();
    expect(computeLaborCostBudget({ salesLevel: 50000, guideline: {} })).toBeNull();
  });
});
