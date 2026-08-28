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
const laborBudgetRepo = require('../../repositories/laborBudgetRepository');
const { computeMonthlyCapacity } = require('../monthlyCapacityService');

function shift({ date, hours }) {
  return { shift_date: date, planned_hours: hours };
}
function actual({ date, hours }) {
  return { actual_date: date, actual_hours: hours };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('monthlyCapacityService.computeMonthlyCapacity', () => {
  test('3. monthly hour limit: remainingHours = monthlyGuideline - hoursUsedOrCommitted', async () => {
    rosterRepo.findShiftsForStoreInRange.mockResolvedValue([shift({ date: '2026-08-03', hours: 40 }), shift({ date: '2026-08-10', hours: 40 })]);
    laborBudgetRepo.findStoreActualHours.mockResolvedValue([]);

    const result = await computeMonthlyCapacity({ storeId: '1005', monthKey: '2026-08', guideline: { monthly_labor_hours: 1000 } });

    expect(result.monthlyGuideline).toBe(1000);
    expect(result.hoursUsedOrCommitted).toBe(80);
    expect(result.remainingHours).toBe(920);
  });

  test('4 & 5. actual hours override planned for a day, and reduce remaining capacity — the worked example from the spec', async () => {
    // Week 1 planned = 230h total, but Friday's actual came in at 68h instead of the 56h planned (an event).
    rosterRepo.findShiftsForStoreInRange.mockResolvedValue([
      shift({ date: '2026-08-03', hours: 174 }), // rest of week 1, unaffected
      shift({ date: '2026-08-07', hours: 56 }), // Friday, planned
    ]);
    laborBudgetRepo.findStoreActualHours.mockResolvedValue([actual({ date: '2026-08-07', hours: 68 })]);

    const result = await computeMonthlyCapacity({ storeId: '1005', monthKey: '2026-08', guideline: { monthly_labor_hours: 1000 } });

    const friday = result.byDate.find((d) => d.date === '2026-08-07');
    expect(friday).toEqual({ date: '2026-08-07', plannedHours: 56, actualHours: 68, variance: 12 });
    expect(result.hoursUsedOrCommitted).toBe(174 + 68); // actual (68), not planned (56), for Friday
    expect(result.remainingHours).toBe(1000 - (174 + 68));
  });

  test('11. event/extra staffing does not invalidate anything — actual > planned is recorded as a positive variance, not an error', async () => {
    rosterRepo.findShiftsForStoreInRange.mockResolvedValue([shift({ date: '2026-08-07', hours: 56 })]);
    laborBudgetRepo.findStoreActualHours.mockResolvedValue([actual({ date: '2026-08-07', hours: 68 })]);

    const result = await computeMonthlyCapacity({ storeId: '1005', monthKey: '2026-08', guideline: { monthly_labor_hours: 1000 } });

    expect(() => result).not.toThrow();
    const friday = result.byDate.find((d) => d.date === '2026-08-07');
    expect(friday.variance).toBe(12);
    expect(friday.plannedHours).toBe(56); // planned is preserved, not overwritten/deleted
    expect(friday.actualHours).toBe(68);
  });

  test('6. the full monthly guideline example: week 1 planned 230 / event actual 242 -> remaining 758, then week 2 planned 250 -> remaining 508', async () => {
    // Week 1: 230 planned total, but one day's actual (12h over) brings the week to 242 actual.
    rosterRepo.findShiftsForStoreInRange.mockResolvedValueOnce([shift({ date: '2026-08-03', hours: 174 }), shift({ date: '2026-08-07', hours: 56 })]);
    laborBudgetRepo.findStoreActualHours.mockResolvedValueOnce([actual({ date: '2026-08-07', hours: 68 })]);

    const afterWeek1 = await computeMonthlyCapacity({ storeId: '1005', monthKey: '2026-08', guideline: { monthly_labor_hours: 1000 } });
    expect(afterWeek1.hoursUsedOrCommitted).toBe(242);
    expect(afterWeek1.remainingHours).toBe(758);

    // Week 2: no actuals recorded yet, so its 250 planned hours count as committed.
    rosterRepo.findShiftsForStoreInRange.mockResolvedValueOnce([
      shift({ date: '2026-08-03', hours: 174 }), shift({ date: '2026-08-07', hours: 56 }), shift({ date: '2026-08-14', hours: 250 }),
    ]);
    laborBudgetRepo.findStoreActualHours.mockResolvedValueOnce([actual({ date: '2026-08-07', hours: 68 })]);

    const afterWeek2 = await computeMonthlyCapacity({ storeId: '1005', monthKey: '2026-08', guideline: { monthly_labor_hours: 1000 } });
    expect(afterWeek2.hoursUsedOrCommitted).toBe(242 + 250);
    expect(afterWeek2.remainingHours).toBe(508);
  });

  test('excludeDateRange drops planned hours inside that range — used so shifts about to be regenerated are not counted against themselves', async () => {
    rosterRepo.findShiftsForStoreInRange.mockResolvedValue([shift({ date: '2026-08-03', hours: 40 }), shift({ date: '2026-08-24', hours: 40 })]);
    laborBudgetRepo.findStoreActualHours.mockResolvedValue([]);

    const result = await computeMonthlyCapacity({
      storeId: '1005', monthKey: '2026-08', guideline: { monthly_labor_hours: 1000 },
      excludeDateRange: { start: '2026-08-24', end: '2026-08-30' },
    });

    expect(result.hoursUsedOrCommitted).toBe(40); // the 08-24 shift (inside the excluded range) is not counted
  });

  test('no monthly guideline configured -> remainingHours is null, not a crash or a false violation', async () => {
    rosterRepo.findShiftsForStoreInRange.mockResolvedValue([shift({ date: '2026-08-03', hours: 40 })]);
    laborBudgetRepo.findStoreActualHours.mockResolvedValue([]);

    const result = await computeMonthlyCapacity({ storeId: '1005', monthKey: '2026-08', guideline: { target_productivity: 500 } });

    expect(result.monthlyGuideline).toBeNull();
    expect(result.remainingHours).toBeNull();
  });
});
