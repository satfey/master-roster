// rosterGenerationService.js pulls in forecastService (real, not mocked, so
// the actual forecast math runs) plus rosterValidationService (also real).
// Only the repositories — the actual Supabase boundary — are mocked,
// matching the pattern used elsewhere in this codebase (e.g.
// dashboardService.test.js).
jest.mock('../../config/supabase', () => ({})); // forecastService.js requires this directly at module load

jest.mock('../../repositories/rosterRepository', () => ({
  findGuideline: jest.fn(),
  findActiveEmployees: jest.fn(),
  findShiftsForEmployeesInRange: jest.fn(),
  findRosterByStoreAndWeek: jest.fn(),
  findOrCreateRoster: jest.fn(),
  deleteShiftsForRosterInRange: jest.fn(),
  insertShifts: jest.fn(),
  findRosterWithShifts: jest.fn(),
  findShiftsForStoreInRange: jest.fn(),
}));
jest.mock('../../repositories/forecastRepository', () => ({
  findDailySalesHistory: jest.fn(),
  findHourlySalesHistory: jest.fn(),
  findAllHourlySalesHistory: jest.fn(),
  createModelRun: jest.fn(),
  upsertForecastRows: jest.fn(),
  findForecastRows: jest.fn(),
}));
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

const rosterRepo = require('../../repositories/rosterRepository');
const forecastRepo = require('../../repositories/forecastRepository');
const laborBudgetRepo = require('../../repositories/laborBudgetRepository');
const { generateDraftRoster } = require('../rosterGenerationService');
const { operatingHourList } = require('../storeOperatingHours');

function makeEmployee(id, overrides = {}) {
  return {
    id, store_id: '1005', is_active: true, default_weekly_hours: 48,
    first_name: 'Test', last_name: id, pay_rate_type: 'Hourly', hr_comp_amount: 50, hr_comp_frequency: 'Hourly',
    position_time_type: 'Full time',
    ...overrides,
  };
}

function makePartTime(id, overrides = {}) {
  return makeEmployee(id, { position_time_type: 'Part time', ...overrides });
}

/** Longest run of consecutive calendar dates ('YYYY-MM-DD') in a sorted array. */
function maxConsecutiveRun(sortedDates) {
  if (!sortedDates.length) return 0;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(`${sortedDates[i - 1]}T00:00:00Z`).getTime();
    const next = new Date(`${sortedDates[i]}T00:00:00Z`).getTime();
    current = next - prev === 24 * 60 * 60 * 1000 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

/** A minimal in-memory fake of the roster/shift tables, wired to the mocked rosterRepository so generateDraftRoster's persistence + the internal post-write validateRoster() call both operate on the same state. */
function createFakeStore({ guideline = { target_productivity: 500, min_staff_per_shift: 1 }, employees = [] } = {}) {
  const employeesById = new Map(employees.map((e) => [e.id, e]));
  let shifts = [];
  const rostersByWeek = new Map();
  let shiftIdCounter = 0;
  let rosterIdCounter = 0;

  rosterRepo.findGuideline.mockResolvedValue(guideline);
  rosterRepo.findActiveEmployees.mockResolvedValue(employees);

  rosterRepo.findOrCreateRoster.mockImplementation(async ({ storeId, weekStart }) => {
    if (!rostersByWeek.has(weekStart)) {
      rosterIdCounter += 1;
      rostersByWeek.set(weekStart, { id: `roster-${rosterIdCounter}`, store_id: storeId, week_start: weekStart, status: 'DRAFT', approved_by: null });
    }
    return rostersByWeek.get(weekStart);
  });

  rosterRepo.deleteShiftsForRosterInRange.mockImplementation(async (rosterId, from, to) => {
    shifts = shifts.filter((s) => !(s.roster_id === rosterId && s.shift_date >= from && s.shift_date <= to));
  });

  rosterRepo.insertShifts.mockImplementation(async (rows) => {
    const inserted = rows.map((r) => ({ id: `shift-${(shiftIdCounter += 1)}`, ...r }));
    shifts.push(...inserted);
    return inserted;
  });

  rosterRepo.findShiftsForStoreInRange.mockImplementation(async (storeId, from, to) =>
    shifts.filter((s) => s.shift_date >= from && s.shift_date <= to).map((s) => ({ ...s, employee: employeesById.get(s.employee_id) || null }))
  );

  rosterRepo.findShiftsForEmployeesInRange.mockImplementation(async (employeeIds, from, to) =>
    shifts.filter((s) => employeeIds.includes(s.employee_id) && s.shift_date >= from && s.shift_date <= to)
  );

  const actualHours = []; // { actual_date, actual_hours }
  laborBudgetRepo.upsertStoreActualHours.mockImplementation(async ({ actualDate, actualHours: hours }) => {
    const existing = actualHours.find((a) => a.actual_date === actualDate);
    if (existing) existing.actual_hours = hours;
    else actualHours.push({ actual_date: actualDate, actual_hours: hours });
    return { actual_date: actualDate, actual_hours: hours };
  });
  laborBudgetRepo.findStoreActualHours.mockImplementation(async (storeId, { from, to } = {}) =>
    actualHours.filter((a) => (!from || a.actual_date >= from) && (!to || a.actual_date <= to))
  );

  return {
    get shifts() { return shifts; },
    get rosters() { return [...rostersByWeek.values()]; },
    recordActualHours: async (date, hours) => laborBudgetRepo.upsertStoreActualHours({ storeId: '1005', actualDate: date, actualHours: hours }),
  };
}

/** Flat, forecast-generating history: same amount for every weekday (>= MIN_WEEKDAY_SAMPLES) and an even hourly shape, so demand is predictable across the whole operating window. */
function mockFlatForecastHistory(dailyAmount) {
  const rows = [];
  const end = new Date('2026-08-01T00:00:00Z');
  for (let i = 1; i <= 14; i++) {
    const d = new Date(end.getTime() - i * 24 * 60 * 60 * 1000);
    rows.push({ report_date: d.toISOString().slice(0, 10), gross_actual: dailyAmount });
  }
  forecastRepo.findDailySalesHistory.mockResolvedValue(rows);
  forecastRepo.findHourlySalesHistory.mockResolvedValue([]); // uniform shape fallback — predictable per-hour split
  forecastRepo.findAllHourlySalesHistory.mockResolvedValue([]);
  forecastRepo.createModelRun.mockResolvedValue({ id: 'model-x' });

  let forecastRows = [];
  forecastRepo.upsertForecastRows.mockImplementation(async (rows2) => {
    forecastRows.push(...rows2);
    return rows2;
  });
  forecastRepo.findForecastRows.mockImplementation(async ({ storeId, startDate, endDate, hourly }) =>
    forecastRows.filter((r) => r.store_id === storeId && r.forecast_date >= startDate && r.forecast_date <= endDate && (hourly ? r.daypart !== 'FULL_DAY' : r.daypart === 'FULL_DAY'))
  );
}

/** Same as mockFlatForecastHistory, but with a non-uniform hour-of-day shape (via findHourlySalesHistory) so forecastedSales genuinely differs by hour — needed to prove the roster reacts to hourly demand shape, not just the daily total. `hourWeights` is a partial { hour: weight } map; unlisted hours get weight 1. */
function mockShapedForecastHistory(dailyAmount, hourWeights) {
  mockFlatForecastHistory(dailyAmount);
  const rows = operatingHourList().map((hour) => ({ report_month: '2026-07-01', hour, gross_sale: hourWeights[hour] ?? 1 }));
  forecastRepo.findHourlySalesHistory.mockResolvedValue(rows);
}

/**
 * The daily labor_hour_guideline_tier bracket table no longer sizes scheduling (see
 * rosterGenerationService.js) — a day's budget is now always monthly guideline hours x that
 * day's share of the month's forecasted sales. Under mockFlatForecastHistory (every day of
 * August forecasts identically), that share is exactly 1/31, so setting monthly_labor_hours to
 * hoursPerDay*31 reproduces precisely the same fixed daily budget a tier used to control
 * directly — this is how these tests can still pin an exact dailyBudgetHours figure.
 */
function dailyBudgetViaMonthlyGuideline(hoursPerDay, daysInMonth = 31) {
  return hoursPerDay * daysInMonth;
}

/** No Sales/Budget tier configured and no gross_budget/actual-hours entered — the Phase 2 default state, so generation falls back to Phase 1's target_productivity-only sizing exactly as documented. */
function mockNoBudgetOverrides() {
  laborBudgetRepo.findGrossBudget.mockResolvedValue(null);
  laborBudgetRepo.findGrossBudgetRange.mockResolvedValue([]);
  laborBudgetRepo.findGuidelineTiers.mockResolvedValue([]);
  laborBudgetRepo.findStoreActualHours.mockResolvedValue([]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNoBudgetOverrides();
});

describe('rosterGenerationService.generateDraftRoster — PHASE 1/2 regression (no tier, target_productivity fallback)', () => {
  test('13. every generated day has opening coverage (a shift starting at store-open, 09:00)', async () => {
    mockFlatForecastHistory(20000);
    createFakeStore({ employees: Array.from({ length: 6 }, (_, i) => makeEmployee(`E${i}`)) });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.validation.openingCoverageOk).toBe(true);
  });

  test('14. every generated day has closing coverage through 22:00', async () => {
    mockFlatForecastHistory(20000);
    createFakeStore({ employees: Array.from({ length: 6 }, (_, i) => makeEmployee(`E${i}`)) });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.validation.closingCoverageOk).toBe(true);
  });

  test('15. no employee is assigned more than one shift on the same day', async () => {
    mockFlatForecastHistory(20000);
    const store = createFakeStore({ employees: Array.from({ length: 8 }, (_, i) => makeEmployee(`E${i}`)) });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-26' });

    const seen = new Set();
    for (const s of store.shifts) {
      const key = `${s.employee_id}-${s.shift_date}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test('16. generation never schedules an employee beyond their derived monthly hour cap', async () => {
    mockFlatForecastHistory(20000);
    // One Full-time employee with just enough weekly room for a single 8h shift.
    const lowCapEmployee = makeEmployee('E1', { default_weekly_hours: 8 });
    createFakeStore({ employees: [lowCapEmployee] });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-01', endDate: '2026-08-07' });

    expect(result.validation.employeesOverLimit).toHaveLength(0);
  });

  test('17 & 18. only active employees belonging to this store ever receive a shift', async () => {
    mockFlatForecastHistory(20000);
    // findActiveEmployees mock stands in for the DB's is_active + store_id filter — every id it returns is a legitimate candidate.
    const activeStoreEmployees = ['E1', 'E2', 'E3'].map((id) => makeEmployee(id));
    const store = createFakeStore({ employees: activeStoreEmployees });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    const allowedIds = new Set(activeStoreEmployees.map((e) => e.id));
    expect(store.shifts.every((s) => allowedIds.has(s.employee_id))).toBe(true);
  });

  test('throws a 400 when the store has no active employees', async () => {
    mockFlatForecastHistory(20000);
    createFakeStore({ employees: [] });

    await expect(generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' })).rejects.toMatchObject({ status: 400 });
  });

  test('roster always stays DRAFT — the generator never sets or requests APPROVED/PUBLISHED', async () => {
    mockFlatForecastHistory(20000);
    const store = createFakeStore({ employees: [makeEmployee('E1'), makeEmployee('E2')] });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(store.rosters.length).toBeGreaterThan(0);
    expect(store.rosters.every((r) => r.status === 'DRAFT')).toBe(true);
  });

  test('refuses to overwrite existing shifts in the range unless regenerate: true is passed', async () => {
    mockFlatForecastHistory(20000);
    const store = createFakeStore({ employees: [makeEmployee('E1'), makeEmployee('E2')] });
    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });
    const firstRunShiftCount = store.shifts.length;
    expect(firstRunShiftCount).toBeGreaterThan(0);

    await expect(generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' })).rejects.toMatchObject({ status: 409 });

    // regenerate: true replaces them without error
    await expect(
      generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24', regenerate: true })
    ).resolves.toBeDefined();
  });
});

describe('rosterGenerationService.generateDraftRoster — PHASE 3 Full-time / Part-time shift rules', () => {
  test('1. a Full-time employee always gets exactly an 8-hour shift', async () => {
    mockFlatForecastHistory(20000); // no tier -> falls back to a large natural demand, so every employee gets used
    const store = createFakeStore({ employees: Array.from({ length: 5 }, (_, i) => makeEmployee(`FT${i}`)) });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(store.shifts.length).toBeGreaterThan(0);
    expect(store.shifts.every((s) => s.planned_hours === 8)).toBe(true);
  });

  test('2. a Part-time employee always gets a shift between 4 and 8 hours', async () => {
    mockFlatForecastHistory(20000);
    const store = createFakeStore({ employees: Array.from({ length: 6 }, (_, i) => makePartTime(`PT${i}`)) });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(store.shifts.length).toBeGreaterThan(0);
    expect(store.shifts.every((s) => s.planned_hours >= 4 && s.planned_hours <= 8)).toBe(true);
  });

  test('3. the opening shift always starts at 09:00', async () => {
    mockFlatForecastHistory(20000);
    const store = createFakeStore({ employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1')] });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(store.shifts.some((s) => s.start_time === '09:00')).toBe(true);
  });

  test('4. the closing shift always ends at 22:00', async () => {
    mockFlatForecastHistory(20000);
    const store = createFakeStore({ employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1')] });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(store.shifts.some((s) => s.end_time === '22:00')).toBe(true);
  });

  test('5. the daily labor-hour budget derived from the monthly guideline is respected: Opening FT (8h) + Closing FT (8h) + Closing PT (4h) = 20h exactly', async () => {
    mockFlatForecastHistory(1000); // modest demand so no extra fill shift is needed beyond opening/closing
    const store = createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: dailyBudgetViaMonthlyGuideline(20) },
      employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1')],
    });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.totalLaborHours).toBe(20);
    expect(result.generatedShifts).toBe(3);
    // FT's clock span is 9h (8 working + 1h break 13:00-14:00), not 8h — planned_hours (WORKING hours) stays 8.
    expect(store.shifts.find((s) => s.start_time === '09:00')).toMatchObject({ end_time: '18:00', planned_hours: 8 });
    // Closing requires 2 employees ending exactly at 22:00 — one Full-time (13:00-22:00, matching the business example), one Part-time sized to fit the remaining budget.
    const closingShifts = store.shifts.filter((s) => s.end_time === '22:00');
    expect(closingShifts).toHaveLength(2);
    expect(closingShifts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ start_time: '13:00', planned_hours: 8 }),
        expect.objectContaining({ start_time: '18:00', planned_hours: 4 }),
      ])
    );
    expect(result.budgetShortfalls.find((b) => b.date === '2026-08-24')).toBeUndefined();
  });

  test('6. monthly remaining capacity is respected: the fill phase stops even though the daily budget alone would allow more', async () => {
    mockFlatForecastHistory(20000); // no tier -> a ~52h/day natural demand, far more than the 28h monthly guideline
    createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: 28 },
      employees: Array.from({ length: 4 }, (_, i) => makeEmployee(`FT${i}`)), // no Part-time employee -> every mandatory shift is Full-time (8h)
    });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    // Opening (8h) + 2 mandatory closers (8h each, no Part-time employee in the pool) = 24h
    // fits inside the 28h monthly guideline; a discretionary 4th shift would need at least
    // 8h (the only remaining eligible employee is Full-time) but only 4h of monthly room is
    // left — so discretionary filling stops. Mandatory coverage itself is never limited by
    // the monthly guideline (it bypasses the store cap, same as before this rule existed).
    expect(result.generatedShifts).toBe(3);
    expect(result.totalLaborHours).toBe(24);
    expect(result.validation.monthlyCapacity[0].remainingHours).toBe(4);
    expect(result.validation.monthlyCapacity[0].hoursUsedOrCommitted).toBe(24);
  });

  test("7. an earlier day's actual-hours overage (an event) reduces the remaining capacity seen by the next generation call", async () => {
    mockFlatForecastHistory(5000);
    const store = createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: 200 },
      employees: Array.from({ length: 6 }, (_, i) => makeEmployee(`E${i}`)),
    });

    const day1 = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-03', endDate: '2026-08-03' });

    // An event occurs: day 1's actual hours come in well above what was planned.
    const actualDay1 = day1.totalLaborHours + 20;
    await store.recordActualHours('2026-08-03', actualDay1);

    const day2 = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-04', endDate: '2026-08-04' });

    expect(day2.monthlyCapacityBeforeGeneration[0].remainingHoursBeforeThisRun).toBe(200 - actualDay1);
  });

  test('8a. a Full-time + Part-time combination satisfies a 12-hour guideline (business example 1)', async () => {
    mockFlatForecastHistory(1000);
    const store = createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: dailyBudgetViaMonthlyGuideline(12) },
      employees: [makeEmployee('FT1'), makePartTime('PT1')],
    });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.totalLaborHours).toBe(12);
    expect(store.shifts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ employee_id: 'FT1', start_time: '09:00', end_time: '18:00', planned_hours: 8 }),
        expect.objectContaining({ employee_id: 'PT1', start_time: '18:00', end_time: '22:00', planned_hours: 4 }),
      ])
    );
  });

  test('8b. a Part-time + Part-time combination satisfies a 12-hour guideline (no Full-time employees at all)', async () => {
    mockFlatForecastHistory(1000);
    const store = createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: dailyBudgetViaMonthlyGuideline(12) },
      employees: [makePartTime('PT1'), makePartTime('PT2')], // no Full-time employees at all
    });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.totalLaborHours).toBe(12);
    // Opening PT is sized up to the 8h ceiling since the full 12h budget is available — more
    // than 5 continuous working hours, so a 1h break is required (Labour Protection Act s.27),
    // pushing end_time to 18:00 even though planned (working) hours stays 8. The closing PT
    // gets whatever's left (4h, the PT minimum, no break needed at <=5h) — still exactly 12h combined.
    expect(store.shifts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ start_time: '09:00', end_time: '18:00', planned_hours: 8, break_start_time: '14:00', break_end_time: '15:00' }),
        expect.objectContaining({ start_time: '18:00', end_time: '22:00', planned_hours: 4, break_start_time: null }),
      ])
    );
  });

  test('9. a warning (with required/allowed/shortage/date/reason) is returned when opening+closing coverage cannot fit the daily labor-hour budget', async () => {
    mockFlatForecastHistory(1000);
    createFakeStore({
      // deliberately tiny — monthly_labor_hours chosen so today's derived share is exactly 4h
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: dailyBudgetViaMonthlyGuideline(4) },
      employees: [makePartTime('PT1'), makePartTime('PT2'), makePartTime('PT3')], // enough for 1 opener + 2 closers
    });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    // Coverage is still guaranteed (never silently dropped)...
    expect(result.validation.openingCoverageOk).toBe(true);
    expect(result.validation.closingCoverageOk).toBe(true);
    // ...but the shortfall against the guideline is explicitly reported. Opening (4h, PT
    // minimum) + 2 closers (4h each, PT minimum, clamped up from the exhausted budget) = 12h
    // mandatory coverage against a deliberately tiny 4h guideline.
    const shortfall = result.budgetShortfalls.find((b) => b.date === '2026-08-24');
    expect(shortfall).toMatchObject({ date: '2026-08-24', requiredHours: 12, allowedHours: 4, shortageHours: 8 });
    expect(typeof shortfall.reason).toBe('string');
    expect(shortfall.reason.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('shortage'))).toBe(true);
  });
});

describe('rosterGenerationService.generateDraftRoster — PHASE 4: productivity is a floor, not a target; staffing is minimized', () => {
  test('high-sales hours receive extra staff and low-sales hours do not — driven by the hourly forecast shape, not just the daily total', async () => {
    // Hour 12 gets 20x the weight of every other operating hour: dailyForecast 3200 -> hour 12 = 2000, every other hour = 100.
    mockShapedForecastHistory(3200, { 12: 20 });
    // Mandatory coverage (PT-only pool, 8h capped each): 1 opener + 2 closers = 24h, plus a 4h
    // backfill shift for the hour both closers' mandatory rest breaks land on simultaneously
    // (13:00 start -> break at 18:00 for both) = 28h. 40h leaves room beyond that for discretionary fill.
    const store = createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: dailyBudgetViaMonthlyGuideline(40) },
      employees: Array.from({ length: 6 }, (_, i) => makePartTime(`PT${i}`)),
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    function coverageAt(hour) {
      return store.shifts.filter((s) => Number(s.start_time.slice(0, 2)) <= hour && hour < Number(s.end_time.slice(0, 2))).length;
    }

    expect(coverageAt(12)).toBeGreaterThan(coverageAt(10)); // the peak hour gets more staff than a quiet hour
    expect(coverageAt(10)).toBe(1); // the quiet hour gets exactly the operational minimum, nothing extra
  });

  test('with NO daily tier configured, a peak sales hour still pulls in extra staff — the monthly-guideline-derived daily budget replaces the old flat floor that this used to be impossible under', async () => {
    // No findGuidelineTiers override -> mockNoBudgetOverrides() default of [] -> no daily tier ever matches.
    // Hour 12 gets 20x the weight of every other operating hour, on a large enough daily total (40,000) that
    // its August monthly forecast (31 x 40,000 = 1,240,000) lands in the 950,001-1,500,000 -> 1290h bracket,
    // and no monthly_labor_hours is manually set, so that sales-derived guideline is what actually applies.
    mockShapedForecastHistory(40000, { 12: 20 });
    const store = createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      employees: [makeEmployee('FT1'), ...Array.from({ length: 5 }, (_, i) => makePartTime(`PT${i}`))],
    });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    function coverageAt(hour) {
      return store.shifts.filter((s) => Number(s.start_time.slice(0, 2)) <= hour && hour < Number(s.end_time.slice(0, 2))).length;
    }

    // Today's derived budget is ~41.6h (1290h x 40,000/1,240,000) — far beyond the old "1 person x 13
    // operating hours" = 13h floor, which mandatory opening/closing coverage (>= 16h) already exceeded on
    // its own, permanently starving this exact mechanism. With real headroom, the peak hour now visibly
    // gets more staff than a quiet one, purely because its real sales justify it.
    expect(coverageAt(12)).toBeGreaterThan(coverageAt(10));
    expect(coverageAt(10)).toBe(1); // the quiet hour still gets exactly the operational minimum, never padded
    expect(result.totalLaborHours).toBeGreaterThan(16); // more than the bare 1-opener + 1-closer structural minimum
  });

  test('total labor hours are an OUTPUT of the optimization, not padded toward the monthly guideline', async () => {
    mockFlatForecastHistory(5000); // no daily tier -> today's budget is instead this monthly guideline's share of today's forecast
    const store = createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: 1000 }, // manual monthly cap, generous/non-binding
      employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1'), makePartTime('PT2')],
    });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    // FT1 opens (8h, 09:00-18:00, break 13:00-14:00). Full-time must fill toward 48h
    // before Part-time is used at all, so the first required closer is FT2 (8h,
    // 13:00-22:00) — FT2's shift also happens to cover FT1's break hour (13:00), so no
    // coverage gap is left there. The second required closer, with both Full-time
    // employees already scheduled today, falls to Part-time: today's derived budget is
    // 1000h x (today's 5000 forecast / August's 155,000 forecasted total) ~= 32.26h, so
    // PT1 is sized to fill the remaining ~16h, clamped to its 8h ceiling. 8+8+8=24h
    // total: still an OUTPUT of the optimization (every hour is driven by an actual
    // coverage requirement, never padded toward the guideline) — it just no longer
    // under-uses either the second Full-time employee or the Part-time closer because of
    // an unrealistically tiny fallback budget.
    expect(result.totalLaborHours).toBe(24);
    expect(result.generatedShifts).toBe(3);
    expect(result.totalLaborHours).toBeLessThan(50); // nowhere close to the 1000h monthly guideline — it is a ceiling, never a fill target
  });

  test('labor cost is minimized along with hours — a low-demand day does not carry inflated cost', async () => {
    mockFlatForecastHistory(5000);
    createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 }, // no monthly_labor_hours -> the guideline itself falls back to the Sales -> Labor Hours table, keyed to August's forecasted sales (155,000 -> 840h bracket)
      employees: [makeEmployee('FT1', { pay_rate_type: 'Hourly', hr_comp_amount: 50 }), makePartTime('PT1', { hr_comp_amount: 50 })],
    });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    // Today's derived budget: 840h x (5000 / 155,000) ~= 27.1h. FT1 opens (8h); PT1 is
    // the only eligible closer left, sized to the ~19.1h remaining, clamped to its 8h
    // ceiling. 8+8=16h — still exactly hours x rate, no padding beyond what coverage +
    // the sales-derived budget actually call for.
    expect(result.totalLaborHours).toBe(16);
    expect(result.estimatedLaborCost).toBe(16 * 50); // exactly hours x rate — no padding
  });

  test('monthly_labor_hours remains a hard maximum for discretionary (productivity-justified) staffing, even when a tier would otherwise allow more', async () => {
    mockFlatForecastHistory(20000); // sizeable demand — plenty of room for extra fill if capacity allowed it
    laborBudgetRepo.findGuidelineTiers.mockResolvedValue([{ id: 't1', store_id: null, sales_min: 0, sales_max: 49999, allowed_labor_hours: 40 }]); // generous daily allowance
    createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: 16 }, // tight monthly ceiling
      employees: Array.from({ length: 6 }, (_, i) => makeEmployee(`FT${i}`)),
    });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    // Mandatory coverage (opening 8h + 2 required closers, 8h each — no Part-time employee in the
    // pool) = 24h, which already exceeds the 16h monthly guideline on its own (mandatory coverage
    // bypasses the store cap, same as it already did for a single closer before this rule). No
    // discretionary extra fill can be added on top once the store's remaining capacity is negative.
    expect(result.generatedShifts).toBe(3);
    expect(result.totalLaborHours).toBe(24);
    expect(result.validation.monthlyCapacity[0].remainingHours).toBe(-8);
  });
});

describe('rosterGenerationService.generateDraftRoster — Full-time working hours, break, and weekly-rest rules', () => {
  test('every Full-time shift includes exactly a 1-hour break, and planned_hours (working hours) excludes it', async () => {
    mockFlatForecastHistory(20000); // sizeable demand -> every employee gets used
    const store = createFakeStore({ employees: Array.from({ length: 5 }, (_, i) => makeEmployee(`FT${i}`)) });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(store.shifts.length).toBeGreaterThan(0);
    for (const s of store.shifts) {
      expect(s.break_start_time).not.toBeNull();
      expect(s.break_end_time).not.toBeNull();
      const breakStart = Number(s.break_start_time.slice(0, 2));
      const breakEnd = Number(s.break_end_time.slice(0, 2));
      expect(breakEnd - breakStart).toBe(1);
      expect(s.planned_hours).toBe(8); // WORKING hours only — the break is unpaid
      const clockSpan = Number(s.end_time.slice(0, 2)) - Number(s.start_time.slice(0, 2));
      expect(clockSpan).toBe(9); // 8 working + 1 break
    }
  });

  test('the break starts within the first 5 working hours of the shift (never more than 5 consecutive hours before it)', async () => {
    mockFlatForecastHistory(20000);
    const store = createFakeStore({ employees: Array.from({ length: 5 }, (_, i) => makeEmployee(`FT${i}`)) });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(store.shifts.length).toBeGreaterThan(0);
    for (const s of store.shifts) {
      const startHour = Number(s.start_time.slice(0, 2));
      const breakStartHour = Number(s.break_start_time.slice(0, 2));
      const hoursBeforeBreak = breakStartHour - startHour;
      expect(hoursBeforeBreak).toBeGreaterThan(0);
      expect(hoursBeforeBreak).toBeLessThanOrEqual(5);
    }
  });

  test("a Full-time employee's break hour is backfilled by another employee, never left as a silent coverage gap", async () => {
    mockFlatForecastHistory(5000); // no tier -> daily budget falls back to the bare operational minimum (13h)
    const store = createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      // FT1 opens, PT1 + PT2 are the 2 required closers — a 4th employee (PT3) is needed
      // to be available for the minimum-staffing phase to backfill FT1's break hour.
      employees: [makeEmployee('FT1'), makePartTime('PT1'), makePartTime('PT2'), makePartTime('PT3')],
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    const ftShift = store.shifts.find((s) => s.employee_id === 'FT1');
    const breakHour = Number(ftShift.break_start_time.slice(0, 2));
    const coverageAtBreak = store.shifts.filter((s) => {
      if (s.employee_id === 'FT1') return false; // FT1 itself is on break, not coverage
      const start = Number(s.start_time.slice(0, 2));
      const end = Number(s.end_time.slice(0, 2));
      return start <= breakHour && breakHour < end;
    }).length;

    expect(coverageAtBreak).toBeGreaterThanOrEqual(1);
  });

  test('a Full-time employee already at a 6-day working streak is not scheduled a 7th consecutive day', async () => {
    mockFlatForecastHistory(20000);
    const store = createFakeStore({ employees: [makeEmployee('FT1'), makeEmployee('FT2'), makeEmployee('FT3')] });

    // Seed FT1 with 6 consecutive prior working days, ending the day before the generation date.
    const priorDates = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22'];
    await rosterRepo.insertShifts(
      priorDates.map((d) => ({
        roster_id: 'seed-roster',
        employee_id: 'FT1',
        shift_date: d,
        start_time: '09:00',
        end_time: '18:00',
        break_start_time: '13:00',
        break_end_time: '14:00',
        planned_hours: 8,
      }))
    );

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-23', endDate: '2026-08-23' });

    const day7Shifts = store.shifts.filter((s) => s.shift_date === '2026-08-23');
    expect(day7Shifts.some((s) => s.employee_id === 'FT1')).toBe(false); // FT1's 7th consecutive day is refused
    expect(day7Shifts.length).toBeGreaterThan(0); // coverage is still achieved by another eligible employee
  });

  test('the 6-consecutive-day limit holds across two separate generation calls spanning a month boundary', async () => {
    mockFlatForecastHistory(20000);
    // A single Full-time employee, no alternative — if a day can't be covered, it's simply left uncovered
    // (with a warning), not covered by bending the rule.
    const store = createFakeStore({ employees: [makeEmployee('SOLO')] });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-07-28', endDate: '2026-08-01' });
    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-02', endDate: '2026-08-05' });

    const soloDates = store.shifts.filter((s) => s.employee_id === 'SOLO').map((s) => s.shift_date).sort();
    expect(maxConsecutiveRun(soloDates)).toBeLessThanOrEqual(6);
    // The 7-day run (2026-07-28..2026-08-03) must have a rest day somewhere in it.
    expect(soloDates).not.toEqual(expect.arrayContaining(['2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02', '2026-08-03']));
  });
});

describe('regression guard: Full-time must be exactly 8 WORKING hours, never 7 — the break is not part of planned_hours', () => {
  test('a Full-time opening shift is exactly 09:00-18:00 with break 13:00-14:00 and planned_hours 8', async () => {
    mockFlatForecastHistory(20000);
    const store = createFakeStore({ employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1')] });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    const ftShift = store.shifts.find((s) => ['FT1', 'FT2'].includes(s.employee_id) && s.start_time === '09:00');
    expect(ftShift).toMatchObject({ start_time: '09:00', end_time: '18:00', break_start_time: '13:00', break_end_time: '14:00', planned_hours: 8 });
  });

  test('the break is exactly 1 hour on every Full-time shift', async () => {
    mockFlatForecastHistory(20000);
    const store = createFakeStore({ employees: Array.from({ length: 5 }, (_, i) => makeEmployee(`FT${i}`)) });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(store.shifts.length).toBeGreaterThan(0);
    for (const s of store.shifts) {
      const breakStart = Number(s.break_start_time.slice(0, 2));
      const breakEnd = Number(s.break_end_time.slice(0, 2));
      expect(breakEnd - breakStart).toBe(1);
    }
  });

  test('a Full-time shift NEVER has planned_hours 7 — every generated Full-time shift is exactly 8, regardless of guideline, demand, or day', async () => {
    // Sweep several distinct scenarios that previously could have produced a 7h clock-span-minus-break
    // miscalculation (no tier, a tight tier, a generous tier, low demand, high demand).
    const scenarios = [
      { forecast: 20000, tiers: [] },
      { forecast: 1000, tiers: [{ id: 't1', store_id: null, sales_min: 0, sales_max: 49999, allowed_labor_hours: 12 }] },
      { forecast: 1000, tiers: [{ id: 't2', store_id: null, sales_min: 0, sales_max: 49999, allowed_labor_hours: 4 }] },
      { forecast: 5000, tiers: [] },
    ];

    for (const scenario of scenarios) {
      jest.clearAllMocks();
      mockNoBudgetOverrides();
      mockFlatForecastHistory(scenario.forecast);
      laborBudgetRepo.findGuidelineTiers.mockResolvedValue(scenario.tiers);
      const store = createFakeStore({ employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1'), makePartTime('PT2')] });

      await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

      const ftShifts = store.shifts.filter((s) => ['FT1', 'FT2'].includes(s.employee_id));
      for (const s of ftShifts) {
        expect(s.planned_hours).not.toBe(7);
        expect(s.planned_hours).toBe(8);
      }
    }
  });

  test('Part-time remains 4-8 hours, unaffected by the Full-time break fix', async () => {
    mockFlatForecastHistory(20000);
    const store = createFakeStore({ employees: Array.from({ length: 6 }, (_, i) => makePartTime(`PT${i}`)) });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(store.shifts.length).toBeGreaterThan(0);
    expect(store.shifts.every((s) => s.planned_hours >= 4 && s.planned_hours <= 8)).toBe(true);
    // A Part-time shift of 5h or less still has no break; only one worked for MORE than 5
    // continuous hours gets the mandatory 1h rest break (Labour Protection Act s.27) — this is
    // a separate, deliberate rule (see the dedicated describe block below), not something the
    // Full-time break fix should have touched.
    expect(store.shifts.every((s) => (s.planned_hours <= 5 ? s.break_start_time === null : s.break_start_time !== null))).toBe(true);
  });

  test('opening (09:00) and closing (22:00) coverage both still hold with the 9-hour Full-time clock span', async () => {
    mockFlatForecastHistory(20000);
    createFakeStore({ employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1')] });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.validation.openingCoverageOk).toBe(true);
    expect(result.validation.closingCoverageOk).toBe(true);
  });

  test('monthly capacity is consumed using WORKING hours (8), not the 9-hour clock span, for a Full-time shift', async () => {
    mockFlatForecastHistory(1000);
    laborBudgetRepo.findGuidelineTiers.mockResolvedValue([{ id: 't1', store_id: null, sales_min: 0, sales_max: 49999, allowed_labor_hours: 8 }]);
    createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: 1000 },
      employees: [makeEmployee('FT1')],
    });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    // A single Full-time shift (09:00-18:00, 9 clock hours, 1h break) must consume exactly 8h of
    // monthly capacity — 9h would mean the break was wrongly counted as labor.
    expect(result.totalLaborHours).toBe(8);
    expect(result.validation.monthlyCapacity[0].hoursUsedOrCommitted).toBe(8);
    expect(result.validation.monthlyCapacity[0].remainingHours).toBe(992);
  });
});

describe('rosterGenerationService.generateDraftRoster — closing coverage requires 2 employees ending exactly at closing time', () => {
  test('A. every generated day has at least 2 shifts ending exactly at 22:00, and they are 2 distinct employees', async () => {
    mockFlatForecastHistory(20000);
    const store = createFakeStore({ employees: Array.from({ length: 6 }, (_, i) => makeEmployee(`E${i}`)) });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    const closers = store.shifts.filter((s) => s.end_time === '22:00');
    expect(closers.length).toBeGreaterThanOrEqual(2);
    expect(new Set(closers.map((s) => s.employee_id)).size).toBe(closers.length); // never the same employee twice
  });

  test('business example: Full-time 13:00-22:00 + Part-time 16:00-22:00 both closing is valid', async () => {
    mockFlatForecastHistory(1000);
    const store = createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: dailyBudgetViaMonthlyGuideline(22) },
      employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1')],
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    const closers = store.shifts.filter((s) => s.end_time === '22:00');
    expect(closers).toHaveLength(2);
    // The Part-time closer's 6 working hours are more than the 5-hour continuous-work
    // threshold, so it now needs the mandatory 1h break (Labour Protection Act s.27) —
    // start moves back to 15:00 (break 20:00-21:00) so it still ends exactly at closing.
    expect(closers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ start_time: '13:00', planned_hours: 8 }),
        expect.objectContaining({ start_time: '15:00', planned_hours: 6, break_start_time: '20:00', break_end_time: '21:00' }),
      ])
    );
  });

  test('business example: Full-time 13:00-22:00 + Full-time 13:00-22:00 both closing is valid (no Part-time employee in the pool)', async () => {
    mockFlatForecastHistory(1000);
    laborBudgetRepo.findGuidelineTiers.mockResolvedValue([{ id: 't1', store_id: null, sales_min: 0, sales_max: 49999, allowed_labor_hours: 24 }]);
    const store = createFakeStore({ employees: [makeEmployee('FT1'), makeEmployee('FT2'), makeEmployee('FT3')] });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    const closers = store.shifts.filter((s) => s.end_time === '22:00');
    expect(closers).toHaveLength(2);
    for (const c of closers) expect(c).toMatchObject({ start_time: '13:00', planned_hours: 8 });
  });

  test('invalid under the old rule: a single closer plus someone merely present in the last hour is no longer treated as valid closing coverage', async () => {
    // 1 employee ends at 21:00 (present during the last operating hour, but NOT at closing) — under
    // the old "someone scheduled during 21:00-22:00" check this looked fine; it no longer does.
    mockFlatForecastHistory(1000);
    laborBudgetRepo.findGuidelineTiers.mockResolvedValue([{ id: 't1', store_id: null, sales_min: 0, sales_max: 49999, allowed_labor_hours: 8 }]);
    const store = createFakeStore({ employees: [makePartTime('PT1')] });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(store.shifts.filter((s) => s.end_time === '22:00')).toHaveLength(0);
    expect(result.validation.closingCoverageOk).toBe(false);
  });

  test('G. a warning + budgetShortfall (never a silently accepted partial roster) is produced when the pool can only supply 1 of the 2 required closers', async () => {
    mockFlatForecastHistory(20000); // sizeable demand -> both employees get fully used on opening + the 1 available closer
    const store = createFakeStore({ employees: [makeEmployee('E1'), makeEmployee('E2')] }); // enough for 1 opener + 1 closer, not 2 closers

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(store.shifts.filter((s) => s.end_time === '22:00')).toHaveLength(1);
    expect(result.validation.closingCoverageOk).toBe(false);
    expect(result.warnings.some((w) => w.includes('closing coverage'))).toBe(true);
    expect(result.budgetShortfalls.some((b) => b.reason.includes('closing'))).toBe(true);
  });

  test('G. opening coverage still only requires 1 employee — unchanged by the closing rule', async () => {
    mockFlatForecastHistory(20000);
    const store = createFakeStore({ employees: Array.from({ length: 6 }, (_, i) => makeEmployee(`E${i}`)) });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(store.shifts.filter((s) => s.start_time === '09:00').length).toBeGreaterThanOrEqual(1);
  });

  test('G. no coverage gap exists anywhere in the operating window (09:00-22:00) with a generous employee pool', async () => {
    mockFlatForecastHistory(20000);
    const store = createFakeStore({ employees: Array.from({ length: 6 }, (_, i) => makeEmployee(`E${i}`)) });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    for (let hour = 9; hour < 22; hour++) {
      const coverage = store.shifts.filter((s) => {
        const start = Number(s.start_time.slice(0, 2));
        const end = Number(s.end_time.slice(0, 2));
        const breakStart = s.break_start_time ? Number(s.break_start_time.slice(0, 2)) : null;
        return start <= hour && hour < end && hour !== breakStart;
      }).length;
      expect(coverage).toBeGreaterThanOrEqual(1);
    }
  });

  test('H. a Full-time employee already at their weekly hour cap is never picked as a closer', async () => {
    mockFlatForecastHistory(20000);
    const cappedEmployee = makeEmployee('FT_CAPPED', { default_weekly_hours: 8 }); // exactly 1 shift's worth
    const store = createFakeStore({ employees: [cappedEmployee, makeEmployee('FT2'), makeEmployee('FT3')] });
    // Consume FT_CAPPED's entire weekly cap on an earlier day in the SAME ISO week (Mon 2026-08-17 - Sun 2026-08-23).
    await rosterRepo.insertShifts([
      { roster_id: 'seed', employee_id: 'FT_CAPPED', shift_date: '2026-08-18', start_time: '09:00', end_time: '18:00', break_start_time: '13:00', break_end_time: '14:00', planned_hours: 8 },
    ]);

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-20', endDate: '2026-08-20' });

    const generatedShifts = store.shifts.filter((s) => s.shift_date === '2026-08-20'); // excludes the seeded prior-week shift itself
    expect(generatedShifts.some((s) => s.employee_id === 'FT_CAPPED')).toBe(false);
  });

  test('H. the 6-consecutive-day rest rule still applies to a would-be closer', async () => {
    mockFlatForecastHistory(20000);
    const store = createFakeStore({ employees: [makeEmployee('FT1'), makeEmployee('FT2'), makeEmployee('FT3')] });
    const priorDates = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22'];
    await rosterRepo.insertShifts(
      priorDates.map((d) => ({
        roster_id: 'seed-roster', employee_id: 'FT1', shift_date: d,
        start_time: '13:00', end_time: '22:00', break_start_time: '17:00', break_end_time: '18:00', planned_hours: 8,
      }))
    );

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-23', endDate: '2026-08-23' });

    const day7Shifts = store.shifts.filter((s) => s.shift_date === '2026-08-23');
    expect(day7Shifts.some((s) => s.employee_id === 'FT1')).toBe(false); // FT1's 7th consecutive day is refused, even as a closer
    expect(day7Shifts.filter((s) => s.end_time === '22:00').length).toBeGreaterThanOrEqual(1); // covered by someone else instead
  });

  test('F. swapping the employee pool (different ids, different size) still produces valid 2-person closing coverage — nothing is hardcoded by id', async () => {
    mockFlatForecastHistory(20000);
    const storeA = createFakeStore({ employees: [makeEmployee('Alpha'), makeEmployee('Beta'), makeEmployee('Gamma')] });
    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });
    expect(storeA.shifts.filter((s) => s.end_time === '22:00')).toHaveLength(2);

    jest.clearAllMocks();
    mockNoBudgetOverrides();
    mockFlatForecastHistory(20000);
    const storeB = createFakeStore({ employees: Array.from({ length: 8 }, (_, i) => makeEmployee(`Zeta${i}`)) });
    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });
    expect(storeB.shifts.filter((s) => s.end_time === '22:00')).toHaveLength(2);
  });

  test('E. target_productivity 700 (the business floor) never causes extra staff at a quiet hour just to bring productivity down toward it', async () => {
    // Hour 12 gets 20x the weight of every other hour: dailyForecast 3200 -> hour 12 = 2000 (justifies floor(2000/700)=2), every other hour = 100 (justifies floor(100/700)=0, clamped up to the 1-person operational floor).
    mockShapedForecastHistory(3200, { 12: 20 });
    laborBudgetRepo.findGuidelineTiers.mockResolvedValue([{ id: 't1', store_id: null, sales_min: 0, sales_max: 49999, allowed_labor_hours: 30 }]);
    const store = createFakeStore({
      guideline: { target_productivity: 700, min_staff_per_shift: 1 },
      employees: Array.from({ length: 6 }, (_, i) => makePartTime(`PT${i}`)),
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    function coverageAt(hour) {
      return store.shifts.filter((s) => Number(s.start_time.slice(0, 2)) <= hour && hour < Number(s.end_time.slice(0, 2))).length;
    }
    expect(coverageAt(10)).toBe(1); // quiet hour: never padded up just to approach the 700 floor
  });

  test('D. a low-demand day is not padded up to the guideline\'s 43h bracket (950,001-1,500,000 tier) just because that tier matched', async () => {
    mockFlatForecastHistory(1000); // real demand is tiny — the tier match alone must not inflate staffing
    laborBudgetRepo.findGuidelineTiers.mockResolvedValue([{ id: 't1', store_id: null, sales_min: 950001, sales_max: 1500000, allowed_labor_hours: 43 }]);
    laborBudgetRepo.findGrossBudget.mockResolvedValue(1200000); // this date's actual sales/budget genuinely falls in the 43h bracket
    const store = createFakeStore({ employees: Array.from({ length: 6 }, (_, i) => makeEmployee(`E${i}`)) });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.totalLaborHours).toBeLessThan(43); // the 43h bracket is the ceiling this day is allowed to use, not a fill target
    expect(store.shifts.length).toBeLessThan(6); // not every employee in the pool was pressed into service just to approach 43h
  });
});

describe('rosterGenerationService.generateDraftRoster — Full-time hours are concentrated on one employee before spreading to another', () => {
  // NOTE: these two tests used to also assert exactly which structural ROLE (opener vs.
  // closer) and which specific calendar date each employee held — that got intentionally
  // less predictable once Full-time day-off staggering was added (see the describe block
  // below): who opens vs. closes on a given day can now shift depending on whose staggered
  // preferred rest day that is. The property that actually matters — concentration, and
  // "the second employee is never ignored forever" — is what's asserted here instead.
  test('with 2 Full-time employees, hours concentrate to each employee\'s full 48h over the week — never split into a partial/uneven share', async () => {
    mockFlatForecastHistory(1000);
    laborBudgetRepo.findGuidelineTiers.mockResolvedValue([{ id: 't1', store_id: null, sales_min: 0, sales_max: 49999, allowed_labor_hours: 12 }]);
    const store = createFakeStore({
      employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1'), makePartTime('PT2'), makePartTime('PT3')],
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-17', endDate: '2026-08-22' }); // Mon-Sat, one ISO week

    for (const id of ['FT1', 'FT2']) {
      const hours = store.shifts.filter((s) => s.employee_id === id).reduce((sum, s) => sum + s.planned_hours, 0);
      expect(hours).toBe(48); // both fully use their weekly cap — never a "fair" 24/24 split
    }
  });

  test('once the first Full-time employee is genuinely out of weekly hours, the second one picks up the remaining days — concentration does not mean the second is ignored forever', async () => {
    mockFlatForecastHistory(1000);
    laborBudgetRepo.findGuidelineTiers.mockResolvedValue([{ id: 't1', store_id: null, sales_min: 0, sales_max: 49999, allowed_labor_hours: 12 }]);
    const store = createFakeStore({
      employees: [
        makeEmployee('FT1', { default_weekly_hours: 8 }), // can only take a single 8h shift this week
        makeEmployee('FT2'),
        makePartTime('PT1'),
        makePartTime('PT2'),
        makePartTime('PT3'),
      ],
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-17', endDate: '2026-08-19' }); // Mon-Wed

    const ft1Hours = store.shifts.filter((s) => s.employee_id === 'FT1').reduce((sum, s) => sum + s.planned_hours, 0);
    const ft2Hours = store.shifts.filter((s) => s.employee_id === 'FT2').reduce((sum, s) => sum + s.planned_hours, 0);
    expect(ft1Hours).toBe(8); // used exactly up to (never beyond) its capped weekly limit
    expect(ft2Hours).toBe(24); // picks up every day across the whole range that FT1 couldn't cover — never ignored
  });
});

describe('rosterGenerationService.generateDraftRoster — Part-time rest-period rule (Labour Protection Act s.27): break required after more than 5 consecutive working hours', () => {
  test('1. a Part-time shift of exactly 4 continuous hours is valid with no break required', async () => {
    mockFlatForecastHistory(1000);
    const store = createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: dailyBudgetViaMonthlyGuideline(4) },
      employees: [makePartTime('PT1')],
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    const shift = store.shifts.find((s) => s.employee_id === 'PT1');
    expect(shift).toMatchObject({ start_time: '09:00', end_time: '13:00', planned_hours: 4, break_start_time: null, break_end_time: null });
  });

  test('2. a Part-time shift of exactly 5 continuous hours is valid with no break required — 5h itself is not "more than 5"', async () => {
    mockFlatForecastHistory(1000);
    const store = createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: dailyBudgetViaMonthlyGuideline(5) },
      employees: [makePartTime('PT1')],
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    const shift = store.shifts.find((s) => s.employee_id === 'PT1');
    expect(shift).toMatchObject({ start_time: '09:00', end_time: '14:00', planned_hours: 5, break_start_time: null, break_end_time: null });
  });

  test('3. a Part-time shift of more than 5 continuous hours requires a break (Labour Protection Act s.27)', async () => {
    mockFlatForecastHistory(1000);
    const store = createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: dailyBudgetViaMonthlyGuideline(6) },
      employees: [makePartTime('PT1')],
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    const shift = store.shifts.find((s) => s.employee_id === 'PT1');
    expect(shift.break_start_time).not.toBeNull();
    expect(shift.break_end_time).not.toBeNull();
    // the break itself is exactly 1 hour, per PART_TIME_BREAK_HOURS
    expect(Number(shift.break_end_time.slice(0, 2)) - Number(shift.break_start_time.slice(0, 2))).toBe(1);
    // no more than 5 consecutive working hours precede the break
    expect(Number(shift.break_start_time.slice(0, 2)) - Number(shift.start_time.slice(0, 2))).toBeLessThanOrEqual(5);
  });

  test('4. a Part-time shift of 6 working hours with its 1h break has planned_hours 6 and a 7-hour clock span', async () => {
    mockFlatForecastHistory(1000);
    const store = createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: dailyBudgetViaMonthlyGuideline(6) },
      employees: [makePartTime('PT1')],
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    const shift = store.shifts.find((s) => s.employee_id === 'PT1');
    expect(shift).toMatchObject({ start_time: '09:00', end_time: '16:00', planned_hours: 6, break_start_time: '14:00', break_end_time: '15:00' });
    const clockSpan = Number(shift.end_time.slice(0, 2)) - Number(shift.start_time.slice(0, 2));
    expect(clockSpan).toBe(7); // 6 working hours + 1 break hour
  });

  test('5. the Part-time break is unpaid and never counted as a working hour', async () => {
    mockFlatForecastHistory(1000);
    const store = createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: dailyBudgetViaMonthlyGuideline(6) },
      employees: [makePartTime('PT1')],
    });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    const shift = store.shifts.find((s) => s.employee_id === 'PT1');
    const clockSpan = Number(shift.end_time.slice(0, 2)) - Number(shift.start_time.slice(0, 2));
    const breakHours = Number(shift.break_end_time.slice(0, 2)) - Number(shift.break_start_time.slice(0, 2));
    expect(shift.planned_hours).toBe(clockSpan - breakHours); // planned_hours excludes the break
    expect(result.totalLaborHours).toBe(shift.planned_hours); // the store-wide total doesn't count it either
  });

  test('7. Part-time is added only when Full-time + required minimum coverage is not enough', async () => {
    mockFlatForecastHistory(1000); // modest demand — no discretionary fill beyond mandatory coverage
    // Enough Full-time employees (3) to cover 1 opener + 2 closers entirely -> Part-time should never be touched.
    const sufficientFtStore = createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: dailyBudgetViaMonthlyGuideline(24) },
      employees: [makeEmployee('FT1'), makeEmployee('FT2'), makeEmployee('FT3'), makePartTime('PT1')],
    });
    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });
    expect(sufficientFtStore.shifts.filter((s) => s.employee_id === 'PT1')).toHaveLength(0);

    jest.clearAllMocks();
    mockNoBudgetOverrides();
    mockFlatForecastHistory(1000);
    // Only 2 Full-time employees -> can cover the opener + 1 closer, but a 2nd closer has no
    // remaining eligible Full-time employee that day, so Part-time must be used.
    const insufficientFtStore = createFakeStore({
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: dailyBudgetViaMonthlyGuideline(20) },
      employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1')],
    });
    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });
    expect(insufficientFtStore.shifts.filter((s) => s.employee_id === 'PT1')).toHaveLength(1);
  });

  test('8. Part-time is never added just because labor budget remains — no padding toward the guideline', async () => {
    mockFlatForecastHistory(1000); // modest, sales-independent demand
    const store = createFakeStore({
      // A huge monthly guideline — plenty of budget left after mandatory coverage — but demand
      // stays tiny, so no hour ever justifies more staff than the operational minimum.
      guideline: { target_productivity: 500, min_staff_per_shift: 1, monthly_labor_hours: dailyBudgetViaMonthlyGuideline(1000) },
      employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1'), makePartTime('PT2'), makePartTime('PT3')],
    });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    // Opening (FT1, 8h) + 2 mandatory closers (FT2 + one Part-time, since only 2 Full-time
    // employees exist) is the entire mandatory requirement; the other 2 Part-time employees
    // must stay completely unscheduled despite the ~1000h of "room" in the guideline.
    const usedPtIds = new Set(store.shifts.filter((s) => s.employee_id.startsWith('PT')).map((s) => s.employee_id));
    expect(usedPtIds.size).toBeLessThanOrEqual(1);
    expect(result.totalLaborHours).toBeLessThan(30); // nowhere close to the huge guideline — an output, never a fill target
  });
});

describe('rosterGenerationService.generateDraftRoster — Full-time rest days are staggered, biased away from the highest-demand day', () => {
  /** Sunday gets 3x the sales of every other day, so it's unambiguously this week's busiest day. */
  function mockSundayHeavyForecastHistory({ sundayAmount, otherDaysAmount }) {
    const rows = [];
    const end = new Date('2026-08-01T00:00:00Z');
    for (let i = 1; i <= 28; i++) {
      const d = new Date(end.getTime() - i * 24 * 60 * 60 * 1000);
      rows.push({ report_date: d.toISOString().slice(0, 10), gross_actual: d.getUTCDay() === 0 ? sundayAmount : otherDaysAmount });
    }
    forecastRepo.findDailySalesHistory.mockResolvedValue(rows);
    forecastRepo.findHourlySalesHistory.mockResolvedValue([]);
    forecastRepo.findAllHourlySalesHistory.mockResolvedValue([]);
    forecastRepo.createModelRun.mockResolvedValue({ id: 'model-x' });
    let forecastRows = [];
    forecastRepo.upsertForecastRows.mockImplementation(async (rows2) => { forecastRows.push(...rows2); return rows2; });
    forecastRepo.findForecastRows.mockImplementation(async ({ storeId, startDate, endDate, hourly }) =>
      forecastRows.filter((r) => r.store_id === storeId && r.forecast_date >= startDate && r.forecast_date <= endDate && (hourly ? r.daypart !== 'FULL_DAY' : r.daypart === 'FULL_DAY'))
    );
  }

  test('with 2 Full-time employees over a full ISO week, neither one\'s day off lands on the week\'s highest-demand day', async () => {
    mockSundayHeavyForecastHistory({ sundayAmount: 3000, otherDaysAmount: 1000 });
    laborBudgetRepo.findGuidelineTiers.mockResolvedValue([{ id: 't1', store_id: null, sales_min: 0, sales_max: 49999, allowed_labor_hours: 30 }]);
    const store = createFakeStore({
      employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1'), makePartTime('PT2'), makePartTime('PT3')],
    });

    // 2026-08-17 (Mon) .. 2026-08-23 (Sun) — a full 7-day ISO week, so each Full-time
    // employee's 48h/6-day cap leaves exactly one real day off to place.
    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-17', endDate: '2026-08-23' });

    for (const id of ['FT1', 'FT2']) {
      const workedDates = new Set(store.shifts.filter((s) => s.employee_id === id).map((s) => s.shift_date));
      expect(workedDates.has('2026-08-23')).toBe(true); // Sunday, the busiest day — never this employee's day off
    }
  });

  test('with 2 Full-time employees over a full ISO week, their one real day off falls on different dates from each other', async () => {
    mockSundayHeavyForecastHistory({ sundayAmount: 3000, otherDaysAmount: 1000 });
    laborBudgetRepo.findGuidelineTiers.mockResolvedValue([{ id: 't1', store_id: null, sales_min: 0, sales_max: 49999, allowed_labor_hours: 30 }]);
    const store = createFakeStore({
      employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1'), makePartTime('PT2'), makePartTime('PT3')],
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-17', endDate: '2026-08-23' });

    const allDates = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'];
    const dayOffFor = (id) => {
      const worked = new Set(store.shifts.filter((s) => s.employee_id === id).map((s) => s.shift_date));
      return allDates.find((d) => !worked.has(d));
    };
    const ft1DayOff = dayOffFor('FT1');
    const ft2DayOff = dayOffFor('FT2');
    expect(ft1DayOff).toBeDefined(); // each genuinely gets a day off within the full week
    expect(ft2DayOff).toBeDefined();
    expect(ft1DayOff).not.toBe(ft2DayOff); // staggered — not both resting on the same date
  });
});

// A tight daily labor-hour guideline (or none at all — see mockNoBudgetOverrides, the default
// for this whole file) used to make guaranteeCoverage() downgrade a second/third required
// Full-time slot (closing) to Part-time whenever the day's budget didn't happen to fit an 8h
// shift — silently starving every Full-time employee but the opener, and producing exactly the
// reported bug: 2 Full-time employees each getting a handful of non-consecutive days (e.g.
// Tue/Thu/Sat vs Wed/Fri/Sun, 24h each) instead of one filling to 48h before the other starts.
// guaranteeCoverage() now tries Full-time unconditionally first (see rosterGenerationService.js);
// the guideline stays a reported target (budgetShortfalls/warnings), never a gate on Full-time
// placement. 2026-08-17 is a Monday, so 2026-08-17..22 is one ISO week's Mon-Sat (6 days) and
// 2026-08-17..23 is the full Mon-Sun (7-day) week.
describe('rosterGenerationService.generateDraftRoster — Full-time day-off scheduling: 8h/day, 48h/week, never split into a few days each', () => {
  test('Case 1: a single Full-time employee gets 6 days x 8h = 48h, with exactly 1 day off', async () => {
    mockFlatForecastHistory(1000);
    const store = createFakeStore({
      employees: [makeEmployee('FT1'), makePartTime('PT1'), makePartTime('PT2'), makePartTime('PT3')],
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-17', endDate: '2026-08-23' });

    const ft1Shifts = store.shifts.filter((s) => s.employee_id === 'FT1');
    const workedDates = [...new Set(ft1Shifts.map((s) => s.shift_date))].sort();
    expect(workedDates).toHaveLength(6);
    expect(ft1Shifts.reduce((sum, s) => sum + s.planned_hours, 0)).toBe(48);
    const allDates = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'];
    expect(allDates.filter((d) => !workedDates.includes(d))).toHaveLength(1); // exactly 1 day off
  });

  test('Case 2: 2 Full-time employees each reach 6 days x 8h = 48h — never split into 3 days each', async () => {
    mockFlatForecastHistory(1000);
    const store = createFakeStore({
      employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1'), makePartTime('PT2'), makePartTime('PT3')],
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-17', endDate: '2026-08-22' }); // Mon-Sat, one ISO week

    for (const id of ['FT1', 'FT2']) {
      const shifts = store.shifts.filter((s) => s.employee_id === id);
      expect(shifts.reduce((sum, s) => sum + s.planned_hours, 0)).toBe(48);
      expect(new Set(shifts.map((s) => s.shift_date)).size).toBe(6); // full 6-day week, not 3 alternating days
    }
  });

  test('Case 3: 3 Full-time employees each try for 48h — nobody is left at 24h because the system spread hours to someone else', async () => {
    mockFlatForecastHistory(1000);
    const store = createFakeStore({
      employees: [makeEmployee('FT1'), makeEmployee('FT2'), makeEmployee('FT3'), makePartTime('PT1'), makePartTime('PT2')],
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-17', endDate: '2026-08-22' });

    for (const id of ['FT1', 'FT2', 'FT3']) {
      const shifts = store.shifts.filter((s) => s.employee_id === id);
      expect(shifts.reduce((sum, s) => sum + s.planned_hours, 0)).toBe(48);
    }
  });

  test('Case 4: no Full-time employee ever exceeds 48h in any rolling 7-day window', async () => {
    mockFlatForecastHistory(1000);
    const store = createFakeStore({
      employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1'), makePartTime('PT2'), makePartTime('PT3')],
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-17', endDate: '2026-09-06' }); // 3 full ISO weeks

    const byEmployee = new Map();
    for (const s of store.shifts) {
      if (!byEmployee.has(s.employee_id)) byEmployee.set(s.employee_id, new Map());
      const m = byEmployee.get(s.employee_id);
      m.set(s.shift_date, (m.get(s.shift_date) || 0) + s.planned_hours);
    }

    for (const hoursByDate of byEmployee.values()) {
      for (const anchor of hoursByDate.keys()) {
        const anchorMs = new Date(`${anchor}T00:00:00Z`).getTime();
        let windowTotal = 0;
        for (const [date, hours] of hoursByDate) {
          const ms = new Date(`${date}T00:00:00Z`).getTime();
          if (ms >= anchorMs && ms < anchorMs + 7 * 24 * 60 * 60 * 1000) windowTotal += hours;
        }
        expect(windowTotal).toBeLessThanOrEqual(48);
      }
    }
  });

  test('Case 5: no Full-time employee ever works 7 consecutive calendar days', async () => {
    mockFlatForecastHistory(1000);
    const store = createFakeStore({
      employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1'), makePartTime('PT2'), makePartTime('PT3')],
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-17', endDate: '2026-09-06' });

    const byEmployee = new Map();
    for (const s of store.shifts) {
      if (!byEmployee.has(s.employee_id)) byEmployee.set(s.employee_id, new Set());
      byEmployee.get(s.employee_id).add(s.shift_date);
    }
    for (const dateSet of byEmployee.values()) {
      expect(maxConsecutiveRun([...dateSet].sort())).toBeLessThanOrEqual(6);
    }
  });

  test('Case 6: every Full-time shift is a 9-clock-hour span with a 1-hour break starting 4 working hours in, and planned_hours 8', async () => {
    mockFlatForecastHistory(1000);
    const store = createFakeStore({
      employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1'), makePartTime('PT2')],
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-17', endDate: '2026-08-22' });

    const ftShifts = store.shifts.filter((s) => s.employee_id === 'FT1' || s.employee_id === 'FT2');
    expect(ftShifts.length).toBeGreaterThan(0);
    for (const s of ftShifts) {
      const start = Number(s.start_time.slice(0, 2));
      const end = Number(s.end_time.slice(0, 2));
      const breakStart = Number(s.break_start_time.slice(0, 2));
      const breakEnd = Number(s.break_end_time.slice(0, 2));
      expect(end - start).toBe(9); // 9 clock hours: 8 working + 1h break
      expect(breakStart).toBe(start + 4);
      expect(breakEnd - breakStart).toBe(1);
      expect(s.planned_hours).toBe(8);
    }
  });

  test('Case 7: coverage is maintained through opening, closing, and every Full-time break', async () => {
    mockFlatForecastHistory(1000);
    const store = createFakeStore({
      employees: [makeEmployee('FT1'), makeEmployee('FT2'), makePartTime('PT1'), makePartTime('PT2'), makePartTime('PT3')],
    });

    const result = await generateDraftRoster({ storeId: '1005', startDate: '2026-08-17', endDate: '2026-08-22' });

    expect(result.validation.openingCoverageOk).toBe(true);
    expect(result.validation.closingCoverageOk).toBe(true);

    function coverageAt(date, hour) {
      return store.shifts.filter((s) => {
        if (s.shift_date !== date) return false;
        const start = Number(s.start_time.slice(0, 2));
        const end = Number(s.end_time.slice(0, 2));
        if (!(start <= hour && hour < end)) return false;
        if (s.break_start_time && Number(s.break_start_time.slice(0, 2)) === hour) return false; // on break -> not coverage
        return true;
      }).length;
    }
    for (const date of ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22']) {
      for (let h = 9; h < 22; h++) expect(coverageAt(date, h)).toBeGreaterThanOrEqual(1);
    }
  });

  test('Case 8: Part-time only fills a slot once no under-48h Full-time employee is left eligible — never used instead of an available one', async () => {
    mockFlatForecastHistory(1000);
    const store = createFakeStore({
      employees: [makeEmployee('FT1'), makePartTime('PT1'), makePartTime('PT2'), makePartTime('PT3')],
    });

    await generateDraftRoster({ storeId: '1005', startDate: '2026-08-17', endDate: '2026-08-23' }); // Mon-Sun

    // Days 1-6: FT1 is still under its 48h cap, so it always wins the opening slot over Part-time.
    for (const date of ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22']) {
      const opener = store.shifts.find((s) => s.shift_date === date && s.start_time === '09:00');
      expect(opener.employee_id).toBe('FT1');
    }
    // Day 7: FT1 has already used its full 48h — coverage still gets filled, now by Part-time.
    const day7Opener = store.shifts.find((s) => s.shift_date === '2026-08-23' && s.start_time === '09:00');
    expect(day7Opener.employee_id).not.toBe('FT1');
    expect(day7Opener.employee_id.startsWith('PT')).toBe(true);
  });
});
