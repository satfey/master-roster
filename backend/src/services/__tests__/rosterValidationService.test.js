jest.mock('../../config/supabase', () => ({})); // laborBudgetService -> forecastService requires this directly at module load
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
const { validateRoster } = require('../rosterValidationService');

function makeEmployee(id, overrides = {}) {
  return {
    id, store_id: '1005', is_active: true, default_weekly_hours: 48,
    first_name: 'Test', last_name: id, pay_rate_type: 'Hourly', hr_comp_amount: 50, hr_comp_frequency: 'Hourly',
    ...overrides,
  };
}

function makeShift({ id, employeeId, date, start, end, hours, employee, breakStart = null, breakEnd = null }) {
  return { id, employee_id: employeeId, shift_date: date, start_time: start, end_time: end, planned_hours: hours, employee, break_start_time: breakStart, break_end_time: breakEnd };
}

function forecastRow(date, hour, sales) {
  return { store_id: '1005', forecast_date: date, daypart: `HOUR_${String(hour).padStart(2, '0')}`, forecasted_sales: sales, model_run_id: 'm1' };
}

function mockData({ guideline = null, shifts = [], grossBudgetRows = [], actualHoursRows = [] }) {
  rosterRepo.findGuideline.mockResolvedValue(guideline);
  rosterRepo.findShiftsForStoreInRange.mockResolvedValue(shifts);
  rosterRepo.findShiftsForEmployeesInRange.mockImplementation(async (employeeIds, from, to) =>
    shifts.filter((s) => employeeIds.includes(s.employee_id) && s.shift_date >= from && s.shift_date <= to)
  );
  laborBudgetRepo.findGrossBudgetRange.mockResolvedValue(grossBudgetRows);
  laborBudgetRepo.findGrossBudget.mockImplementation(async (storeId, date) => {
    const row = grossBudgetRows.find((r) => r.report_date === date);
    return row ? Number(row.gross_budget) : null;
  });
  laborBudgetRepo.findGuidelineTiers.mockResolvedValue([]);
  laborBudgetRepo.findStoreActualHours.mockImplementation(async (storeId, { from, to } = {}) =>
    actualHoursRows.filter((r) => (!from || r.actual_date >= from) && (!to || r.actual_date <= to))
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // validateRoster's monthly-capacity check now falls back to a sales-FORECASTED monthly
  // guideline (via laborBudgetService/forecastService) whenever a store has no manually-
  // entered monthly_labor_hours — exercised in laborBudgetService.test.js /
  // forecastService.hourly.test.js, not here. Empty history keeps that fallback a no-op
  // (forecastedSales 0 -> no tier match -> guideline stays null) unless a test explicitly
  // configures findDailySalesHistory itself.
  forecastRepo.findDailySalesHistory.mockResolvedValue([]);
});

describe('rosterValidationService.validateRoster', () => {
  test('opening coverage fails when nobody is scheduled at store-open (09:00)', async () => {
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      shifts: [makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '12:00', end: '20:00', hours: 7, employee: makeEmployee('E1') })],
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 9, 1000)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.openingCoverageOk).toBe(false);
    expect(result.status).toBe('FAILED');
  });

  test('closing coverage fails when nobody is scheduled through the last operating hour (21:00-22:00)', async () => {
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      shifts: [makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '17:00', hours: 7, employee: makeEmployee('E1') })],
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 21, 1000)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.closingCoverageOk).toBe(false);
    expect(result.status).toBe('FAILED');
  });

  test('closing coverage fails when only 1 shift ends exactly at closing time (2 are required) — even though someone is present during the last hour', async () => {
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      shifts: [makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '13:00', end: '22:00', hours: 8, employee: makeEmployee('E1') })],
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 21, 1000)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.closingCoverageOk).toBe(false);
    expect(result.status).toBe('FAILED');
  });

  test('closing coverage passes when 2 shifts both end exactly at closing time', async () => {
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      shifts: [
        makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '18:00', hours: 8, employee: makeEmployee('E1'), breakStart: '13:00', breakEnd: '14:00' }),
        makeShift({ id: 's2', employeeId: 'E2', date: '2026-08-24', start: '13:00', end: '22:00', hours: 8, employee: makeEmployee('E2') }),
        makeShift({ id: 's3', employeeId: 'E3', date: '2026-08-24', start: '16:00', end: '22:00', hours: 6, employee: makeEmployee('E3') }),
      ],
    });
    forecastRepo.findForecastRows.mockResolvedValue(Array.from({ length: 13 }, (_, i) => forecastRow('2026-08-24', 9 + i, 500)));

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.closingCoverageOk).toBe(true);
  });

  test('19. understaffing is detected when scheduled headcount is below the operational minimum (min_staff_per_shift) — never derived from sales alone', async () => {
    // min_staff_per_shift 2: every hour needs at least 2 people regardless of sales; only 1 is scheduled at hour 12.
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 2 },
      shifts: [
        makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '17:00', hours: 7, employee: makeEmployee('E1') }),
        makeShift({ id: 's2', employeeId: 'E2', date: '2026-08-24', start: '14:00', end: '22:00', hours: 7, employee: makeEmployee('E2') }),
      ],
    });
    // High sales at hour 12 must NOT be why it's flagged — the flag comes from being below min_staff_per_shift, which is sales-independent.
    forecastRepo.findForecastRows.mockResolvedValue([
      forecastRow('2026-08-24', 9, 500), forecastRow('2026-08-24', 12, 3000), forecastRow('2026-08-24', 21, 500),
    ]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    // Only 1 person covers hour 12 (E1's 09-17 shift; E2 starts at 14) but min_staff_per_shift requires 2.
    expect(result.understaffedHours).toContain('2026-08-24 12:00');
    expect(result.status).not.toBe('OK');
  });

  test('20. overstaffing is detected when scheduled headcount well exceeds the requirement', async () => {
    // Low forecast at 14:00 (requires only the min_staff_per_shift floor of 1), but 5 employees scheduled through it.
    const employees = ['E1', 'E2', 'E3', 'E4', 'E5'];
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      shifts: employees.map((id, i) => makeShift({ id: `s${i}`, employeeId: id, date: '2026-08-24', start: '09:00', end: '22:00', hours: 12, employee: makeEmployee(id) })),
    });
    forecastRepo.findForecastRows.mockResolvedValue(
      Array.from({ length: 13 }, (_, i) => forecastRow('2026-08-24', 9 + i, 100)) // low sales -> low requirement everywhere
    );

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.overstaffedHours.length).toBeGreaterThan(0);
    expect(result.status).toBe('WARNING');
  });

  test('21. labor cost is computed from planned hours x employee hourly wage', async () => {
    mockData({
      guideline: { target_productivity: 500, target_col_percent: 15, min_staff_per_shift: 1 },
      shifts: [
        makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '17:00', hours: 7, employee: makeEmployee('E1', { hr_comp_amount: 50 }) }),
        makeShift({ id: 's2', employeeId: 'E2', date: '2026-08-24', start: '14:00', end: '22:00', hours: 7, employee: makeEmployee('E2', { hr_comp_amount: 60 }) }),
      ],
    });
    forecastRepo.findForecastRows.mockResolvedValue(Array.from({ length: 13 }, (_, i) => forecastRow('2026-08-24', 9 + i, 1000)));

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.plannedLaborCost).toBe(7 * 50 + 7 * 60); // 770
    expect(result.plannedLaborCostBreakdown).toEqual({ hourly: 770, monthlySalaried: 0 });
    expect(result.salesForecastTotal).toBe(13000);
    expect(result.laborCostPercent).toBeCloseTo((770 / 13000) * 100, 2);
    expect(result.targetLaborCostPercent).toBe(15);
  });

  test('22. productivity is computed as sales / labor hours', async () => {
    mockData({
      guideline: { target_productivity: 500 },
      shifts: [makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '19:00', hours: 20, employee: makeEmployee('E1') })],
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 12, 10000)]); // sales 10,000, labor hours 20 -> 500 THB/hr

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.plannedLaborHours).toBe(20);
    expect(result.productivity).toBe(500);
    expect(result.targetProductivity).toBe(500);
  });

  test('an employee scheduled beyond their derived monthly hour cap is flagged and fails validation', async () => {
    const emp = makeEmployee('E1', { default_weekly_hours: 7 }); // ~31 hour monthly cap for a 31-day month
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      shifts: [
        makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-03', start: '09:00', end: '17:00', hours: 7, employee: emp }),
        makeShift({ id: 's2', employeeId: 'E1', date: '2026-08-10', start: '09:00', end: '17:00', hours: 7, employee: emp }),
        makeShift({ id: 's3', employeeId: 'E1', date: '2026-08-17', start: '09:00', end: '17:00', hours: 7, employee: emp }),
        makeShift({ id: 's4', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '17:00', hours: 7, employee: emp }),
        makeShift({ id: 's5', employeeId: 'E1', date: '2026-08-25', start: '09:00', end: '17:00', hours: 7, employee: emp }), // 35h total > ~31h cap
      ],
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 9, 500)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-25' });

    expect(result.employeesOverLimit).toHaveLength(1);
    expect(result.employeesOverLimit[0].employeeId).toBe('E1');
    expect(result.status).toBe('FAILED');
  });

  test('with no labor guideline, targets are null and a warning is raised, but coverage checks still run', async () => {
    mockData({
      guideline: null,
      shifts: [makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '22:00', hours: 12, employee: makeEmployee('E1') })],
    });
    forecastRepo.findForecastRows.mockResolvedValue([]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.targetProductivity).toBeNull();
    expect(result.targetLaborCostPercent).toBeNull();
    expect(result.warnings.some((w) => w.includes('No labor guideline configured'))).toBe(true);
  });

  test('7. HOURLY employee cost = planned hours x hr_comp_amount', async () => {
    mockData({
      guideline: { target_productivity: 500 },
      shifts: [makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '17:00', hours: 7, employee: makeEmployee('E1', { pay_rate_type: 'Hourly', hr_comp_amount: 55, sl_comp_amount: null }) })],
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 12, 1000)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.plannedLaborCostBreakdown).toEqual({ hourly: 7 * 55, monthlySalaried: 0 });
    expect(result.plannedLaborCost).toBe(7 * 55);
  });

  test('8. MONTHLY employee cost = sl_comp_amount (flat), never hours x hr_comp_amount', async () => {
    mockData({
      guideline: { target_productivity: 500 },
      shifts: [
        makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '17:00', hours: 7, employee: makeEmployee('E1', { pay_rate_type: 'Monthly', hr_comp_amount: null, sl_comp_amount: 12000 }) }),
        makeShift({ id: 's2', employeeId: 'E1', date: '2026-08-25', start: '09:00', end: '17:00', hours: 7, employee: makeEmployee('E1', { pay_rate_type: 'Monthly', hr_comp_amount: null, sl_comp_amount: 12000 }) }),
      ],
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 12, 1000), forecastRow('2026-08-25', 12, 1000)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-25' });

    // Charged once (12000), not per shift (24000) and not hours x a rate.
    expect(result.plannedLaborCostBreakdown).toEqual({ hourly: 0, monthlySalaried: 12000 });
    expect(result.plannedLaborCost).toBe(12000);
  });

  test('a mix of HOURLY and MONTHLY employees combines correctly into plannedLaborCost', async () => {
    mockData({
      guideline: { target_productivity: 500 },
      shifts: [
        makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '17:00', hours: 7, employee: makeEmployee('E1', { pay_rate_type: 'Hourly', hr_comp_amount: 50, sl_comp_amount: null }) }),
        makeShift({ id: 's2', employeeId: 'E2', date: '2026-08-24', start: '14:00', end: '22:00', hours: 7, employee: makeEmployee('E2', { pay_rate_type: 'Monthly', hr_comp_amount: null, sl_comp_amount: 15000 }) }),
      ],
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 12, 1000)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.plannedLaborCostBreakdown).toEqual({ hourly: 350, monthlySalaried: 15000 });
    expect(result.plannedLaborCost).toBe(15350);
  });

  test('2. planned labor cost exceeding the sales-budget-derived labor budget is flagged as a WARNING', async () => {
    mockData({
      guideline: { target_productivity: 500, target_col_percent: 5 }, // a tight 5% COL target
      shifts: [
        makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '22:00', hours: 12, employee: makeEmployee('E1', { hr_comp_amount: 100 }) }),
      ],
      grossBudgetRows: [{ report_date: '2026-08-24', gross_budget: 10000 }], // laborBudget = 10,000 x 5% = 500; planned cost = 1,200
    });
    forecastRepo.findForecastRows.mockResolvedValue(Array.from({ length: 13 }, (_, i) => forecastRow('2026-08-24', 9 + i, 500)));

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.salesBudgetTotal).toBe(10000);
    expect(result.laborBudgetTotal).toBe(500);
    expect(result.plannedLaborCost).toBe(1200);
    expect(result.warnings.some((w) => w.includes('exceeds the labor budget'))).toBe(true);
  });

  test('5 & 11. actual hours recorded for the store reduce remaining monthly capacity, surfaced in validation without failing the roster', async () => {
    mockData({
      guideline: { target_productivity: 500, monthly_labor_hours: 1000 },
      shifts: [
        makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '22:00', hours: 12, employee: makeEmployee('E1') }),
        makeShift({ id: 's2', employeeId: 'E2', date: '2026-08-24', start: '18:00', end: '22:00', hours: 4, employee: makeEmployee('E2') }), // 2nd closer, required for closingCoverageOk
      ],
      actualHoursRows: [{ actual_date: '2026-08-24', actual_hours: 20 }], // an event: 20 actual vs planned
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 12, 1000)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.actualLaborHours).toBe(20);
    expect(result.actualHoursVariance).toBe(4); // +4h over the 16h planned (12 + 4)
    expect(result.monthlyCapacity[0].hoursUsedOrCommitted).toBe(20); // actual, not planned, counts toward the month
    expect(result.monthlyCapacity[0].remainingHours).toBe(980);
    expect(result.status).not.toBe('FAILED'); // extra usage is a warning, never an invalidating error
  });

  test('a store that has already used more hours than its monthly guideline allows fails validation', async () => {
    mockData({
      guideline: { target_productivity: 500, monthly_labor_hours: 10 },
      shifts: [makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '22:00', hours: 12, employee: makeEmployee('E1') })],
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 12, 1000)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.monthlyCapacity[0].remainingHours).toBeLessThan(0);
    expect(result.status).toBe('FAILED');
    expect(result.warnings.some((w) => w.includes('monthly labor-hour guideline exceeded'))).toBe(true);
  });
});

describe('rosterValidationService.validateRoster — Full-time working hours, break, and weekly-rest checks', () => {
  test('a Full-time shift without exactly 8 working hours is flagged (ftWorkingHoursViolations)', async () => {
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      shifts: [
        makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '18:00', hours: 7, employee: makeEmployee('E1', { position_time_type: 'Full time' }), breakStart: '13:00', breakEnd: '14:00' }),
      ],
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 9, 500)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.ftWorkingHoursViolations).toHaveLength(1);
    expect(result.ftWorkingHoursViolations[0]).toMatchObject({ employeeId: 'E1', plannedHours: 7 });
    expect(result.status).toBe('FAILED');
  });

  test('a Full-time shift missing its meal break is flagged (ftBreakViolations)', async () => {
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      shifts: [makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '17:00', hours: 8, employee: makeEmployee('E1', { position_time_type: 'Full time' }) })], // no break fields
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 9, 500)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.ftBreakViolations).toHaveLength(1);
    expect(result.ftBreakViolations[0]).toMatchObject({ employeeId: 'E1', reason: 'missing meal break' });
    expect(result.status).toBe('FAILED');
  });

  test('a Full-time shift with a break longer or shorter than 1 hour is flagged (ftBreakViolations)', async () => {
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      shifts: [
        makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '19:00', hours: 8, employee: makeEmployee('E1', { position_time_type: 'Full time' }), breakStart: '13:00', breakEnd: '15:00' }), // 2h break
      ],
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 9, 500)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.ftBreakViolations).toHaveLength(1);
    expect(result.ftBreakViolations[0].reason).toContain('break_hours = 2');
  });

  test('an hour that falls below required headcount specifically because of a scheduled break is flagged (breakCoverageGapViolations)', async () => {
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      shifts: [
        makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '18:00', hours: 8, employee: makeEmployee('E1', { position_time_type: 'Full time' }), breakStart: '13:00', breakEnd: '14:00' }),
      ],
    });
    // One forecast row is enough to give every operating hour that date a requiredHeadcount floor of 1 (min_staff_per_shift).
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 9, 500)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.breakCoverageGapViolations).toContain('2026-08-24 13:00');
    expect(result.understaffedHours).toContain('2026-08-24 13:00');
  });

  test('a Full-time employee working more than 48 hours within any rolling 7-day window is flagged (ftWeeklyHourViolations)', async () => {
    const emp = makeEmployee('E1', { position_time_type: 'Full time', default_weekly_hours: 48 });
    const dates = Array.from({ length: 7 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      shifts: dates.map((d, i) =>
        makeShift({ id: `s${i}`, employeeId: 'E1', date: d, start: '09:00', end: '18:00', hours: 8, employee: emp, breakStart: '13:00', breakEnd: '14:00' })
      ),
    });
    forecastRepo.findForecastRows.mockResolvedValue(dates.map((d) => forecastRow(d, 9, 500)));

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-01', endDate: '2026-08-07' });

    expect(result.ftWeeklyHourViolations).toHaveLength(1);
    expect(result.ftWeeklyHourViolations[0]).toMatchObject({ employeeId: 'E1', maxRolling7DayHours: 56 });
    expect(result.status).toBe('FAILED');
  });

  test('a Full-time employee worked more than 6 consecutive calendar days is flagged (consecutiveDayViolations)', async () => {
    const emp = makeEmployee('E1', { position_time_type: 'Full time', default_weekly_hours: 48 });
    const dates = Array.from({ length: 7 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      shifts: dates.map((d, i) =>
        makeShift({ id: `s${i}`, employeeId: 'E1', date: d, start: '09:00', end: '18:00', hours: 8, employee: emp, breakStart: '13:00', breakEnd: '14:00' })
      ),
    });
    forecastRepo.findForecastRows.mockResolvedValue(dates.map((d) => forecastRow(d, 9, 500)));

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-01', endDate: '2026-08-07' });

    expect(result.consecutiveDayViolations).toHaveLength(1);
    expect(result.consecutiveDayViolations[0]).toMatchObject({ employeeId: 'E1', consecutiveWorkingDays: 7 });
    expect(result.status).toBe('FAILED');
  });

  test('a Part-time shift outside the 4-8 hour range is flagged (ptHoursViolations)', async () => {
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      shifts: [makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '18:00', hours: 9, employee: makeEmployee('E1', { position_time_type: 'Part time' }) })],
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 9, 500)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.ptHoursViolations).toHaveLength(1);
    expect(result.ptHoursViolations[0]).toMatchObject({ employeeId: 'E1', plannedHours: 9 });
    expect(result.status).toBe('FAILED');
  });

  test('a shift starting before 09:00 or ending after 22:00 is flagged (shiftWindowViolations)', async () => {
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      shifts: [
        makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '07:00', end: '15:00', hours: 8, employee: makeEmployee('E1', { position_time_type: 'Full time' }), breakStart: '11:00', breakEnd: '12:00' }),
      ],
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 9, 500)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.shiftWindowViolations).toHaveLength(1);
    expect(result.shiftWindowViolations[0]).toMatchObject({ employeeId: 'E1', startTime: '07:00' });
    expect(result.status).toBe('FAILED');
  });

  test('an employee with more than one shift on the same date is flagged (doubleBookingViolations)', async () => {
    const emp = makeEmployee('E1', { position_time_type: 'Part time' });
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      shifts: [
        makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '13:00', hours: 4, employee: emp }),
        makeShift({ id: 's2', employeeId: 'E1', date: '2026-08-24', start: '14:00', end: '18:00', hours: 4, employee: emp }),
      ],
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 9, 500)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.doubleBookingViolations).toHaveLength(1);
    expect(result.doubleBookingViolations[0]).toMatchObject({ employeeId: 'E1', date: '2026-08-24' });
    expect(result.status).toBe('FAILED');
  });

  test('a fully compliant Full-time shift produces none of the new violation types', async () => {
    mockData({
      guideline: { target_productivity: 500, min_staff_per_shift: 1 },
      shifts: [
        makeShift({ id: 's1', employeeId: 'E1', date: '2026-08-24', start: '09:00', end: '18:00', hours: 8, employee: makeEmployee('E1', { position_time_type: 'Full time' }), breakStart: '13:00', breakEnd: '14:00' }),
      ],
    });
    forecastRepo.findForecastRows.mockResolvedValue([forecastRow('2026-08-24', 9, 500)]);

    const result = await validateRoster({ storeId: '1005', startDate: '2026-08-24', endDate: '2026-08-24' });

    expect(result.ftWorkingHoursViolations).toHaveLength(0);
    expect(result.ftBreakViolations).toHaveLength(0);
    expect(result.ptHoursViolations).toHaveLength(0);
    expect(result.shiftWindowViolations).toHaveLength(0);
    expect(result.doubleBookingViolations).toHaveLength(0);
    expect(result.consecutiveDayViolations).toHaveLength(0);
    expect(result.ftWeeklyHourViolations).toHaveLength(0);
  });
});
