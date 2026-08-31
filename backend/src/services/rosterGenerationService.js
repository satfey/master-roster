const rosterRepo = require('../repositories/rosterRepository');
const { generateHourlyForecast } = require('./forecastService');
const { computeLaborDemand } = require('./laborDemandService');
const { monthlyCapFor, validateRoster } = require('./rosterValidationService');
const { computeDailyLaborHoursBudget } = require('./laborBudgetService');
const { computeMonthlyCapacity } = require('./monthlyCapacityService');
const { OPERATING_HOURS, CLOSING_COVERAGE_STAFF_COUNT, operatingHourList } = require('./storeOperatingHours');
const { eachDateInRange, isoWeekStart, monthKey, monthRange, toUTCDate } = require('../utils/dateRange');
const {
  FULL_TIME_SHIFT_HOURS,
  FULL_TIME_BREAK_HOURS,
  FULL_TIME_CLOCK_SPAN_HOURS,
  FULL_TIME_MAX_CONSECUTIVE_DAYS,
  PART_TIME_MIN_HOURS,
  PART_TIME_MAX_HOURS,
  weeklyCapFor,
  employeeShiftType,
} = require('./employeeShiftRules');

// PHASE 3 shift rules (replaces the earlier fixed Opening/Mid/Closing
// templates): shift length is determined by the employee's
// employee.position_time_type ('Full time' / 'Part time', the existing
// Employee Master field). See employeeShiftRules.js for the exact
// working-hours/break/clock-span/consecutive-day constants — shared with
// rosterValidationService so both check the same rules. Shifts are always
// whole-hour, always within 09:00-22:00.

function clampPartTimeHours(hours) {
  return Math.max(PART_TIME_MIN_HOURS, Math.min(PART_TIME_MAX_HOURS, Math.round(hours)));
}

function pad(hour) {
  return String(hour).padStart(2, '0');
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** `lengthHours` is always WORKING hours (matches planned_hours). For FULL_TIME, the clock span is 1h longer than lengthHours to fit the mandatory break, and the break window (always exactly 1h, starting 4 working hours after shift start) is recorded so coverage accounting and validation can both see it. */
function buildShiftRow({ employeeId, date, startHour, lengthHours, type }) {
  if (type === 'FULL_TIME') {
    const breakStartHour = startHour + 4; // no more than 5 consecutive working hours before the break
    const breakEndHour = breakStartHour + FULL_TIME_BREAK_HOURS;
    const endHour = startHour + FULL_TIME_CLOCK_SPAN_HOURS;
    return {
      employee_id: employeeId,
      shift_date: date,
      start_time: `${pad(startHour)}:00`,
      end_time: `${pad(endHour)}:00`,
      break_start_time: `${pad(breakStartHour)}:00`,
      break_end_time: `${pad(breakEndHour)}:00`,
      planned_hours: lengthHours, // WORKING hours only — the break is unpaid, never counted as labor
    };
  }
  const endHour = startHour + lengthHours;
  return {
    employee_id: employeeId,
    shift_date: date,
    start_time: `${pad(startHour)}:00`,
    end_time: `${pad(endHour)}:00`,
    break_start_time: null,
    break_end_time: null,
    planned_hours: lengthHours,
  };
}

/**
 * Generates (or regenerates) a DRAFT roster for a store over a date range
 * from the sales forecast and Sales/Budget -> Labor Hours guideline.
 * Never sets status beyond DRAFT; approval/publish is a separate,
 * human-triggered step.
 */
async function generateDraftRoster({ storeId, startDate, endDate, regenerate = false }) {
  if (startDate > endDate) throw Object.assign(new Error('startDate must not be after endDate'), { status: 400 });

  const [guideline, employees, existingShiftsInRange] = await Promise.all([
    rosterRepo.findGuideline(storeId),
    rosterRepo.findActiveEmployees(storeId),
    rosterRepo.findShiftsForStoreInRange(storeId, startDate, endDate),
  ]);

  if (employees.length === 0) {
    throw Object.assign(new Error('No active employees found for this store'), { status: 400 });
  }
  if (existingShiftsInRange.length > 0 && !regenerate) {
    throw Object.assign(
      new Error(`Shifts already exist for store ${storeId} between ${startDate} and ${endDate}. Pass regenerate: true to replace them.`),
      { status: 409 }
    );
  }

  const hourlyForecast = await generateHourlyForecast({ storeId, startDate, endDate });
  const laborDemand = computeLaborDemand({ days: hourlyForecast.days, guideline });
  const warnings = [...laborDemand.warnings];
  const budgetShortfalls = []; // [{ date, requiredHours, allowedHours, shortageHours, reason }]

  const unknownTypeEmployees = employees.filter((e) => employeeShiftType(e) === null);
  if (unknownTypeEmployees.length > 0) {
    warnings.push(`${unknownTypeEmployees.length} active employee(s) have no recognized position_time_type ('Full time'/'Part time') and were excluded from shift assignment.`);
  }

  // Seed each employee's weekly/monthly hour usage, and their worked-date
  // history (for the consecutive-day rest check below), from shifts OUTSIDE
  // this range (shifts inside it belong to the regeneration and are
  // excluded so they aren't double-counted against themselves). The lookback
  // start is the earlier of the touched months' start and 6 days before
  // startDate — a month boundary alone isn't enough to seed a 6-day
  // consecutive-day streak that crosses it (e.g. startDate on the 1st/2nd).
  const employeeIds = employees.map((e) => e.id);
  const monthsTouched = [...new Set(eachDateInRange(startDate, endDate).map(monthKey))];
  const sixDaysBeforeStart = new Date(toUTCDate(startDate).getTime() - FULL_TIME_MAX_CONSECUTIVE_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const seedRange = {
    start: [monthRange(monthsTouched[0]).start, sixDaysBeforeStart].sort()[0],
    end: monthRange(monthsTouched[monthsTouched.length - 1]).end,
  };
  const priorShifts = (await rosterRepo.findShiftsForEmployeesInRange(employeeIds, seedRange.start, seedRange.end)).filter(
    (s) => s.shift_date < startDate || s.shift_date > endDate
  );

  const weeklyUsed = {}; // `${employeeId}-${weekStart}` -> hours
  const monthlyUsed = {}; // `${employeeId}-${monthKey}` -> hours
  const workedDatesByEmployee = new Map(); // employeeId -> Set of 'YYYY-MM-DD' worked, prior + this run — used only to enforce Full-time's max-6-consecutive-working-days rest rule
  for (const s of priorShifts) {
    const wk = `${s.employee_id}-${isoWeekStart(s.shift_date)}`;
    const mk = `${s.employee_id}-${monthKey(s.shift_date)}`;
    weeklyUsed[wk] = (weeklyUsed[wk] || 0) + Number(s.planned_hours);
    monthlyUsed[mk] = (monthlyUsed[mk] || 0) + Number(s.planned_hours);
    if (!workedDatesByEmployee.has(s.employee_id)) workedDatesByEmployee.set(s.employee_id, new Set());
    workedDatesByEmployee.get(s.employee_id).add(s.shift_date);
  }

  const monthlyCap = {};
  for (const mk of monthsTouched) monthlyCap[mk] = Object.fromEntries(employees.map((e) => [e.id, monthlyCapFor(e, monthRange(mk).days)]));

  // Store-level rolling monthly capacity: actual hours already consumed
  // (source of truth once recorded) plus planned hours already committed
  // OUTSIDE this range, subtracted from the guideline. null (no
  // monthly_labor_hours configured) means no store-level cap is enforced.
  const storeMonthlyRemaining = {};
  const remainingHoursBeforeGeneration = {};
  for (const mk of monthsTouched) {
    const capacity = await computeMonthlyCapacity({ storeId, monthKey: mk, guideline, excludeDateRange: { start: startDate, end: endDate } });
    storeMonthlyRemaining[mk] = capacity.remainingHours;
    remainingHoursBeforeGeneration[mk] = capacity.remainingHours;
  }

  const assignedDay = {}; // `${employeeId}-${date}` -> true (one shift per employee per day)
  const shiftRows = []; // { employee_id, shift_date, start_time, end_time, planned_hours }
  const dailyLaborHoursBudget = [];

  for (const dayDemand of laborDemand.days) {
    const { date } = dayDemand;
    const weekStart = isoWeekStart(date);
    const mk = monthKey(date);
    // requiredHeadcount = operational minimum (sales-independent, never a target to chase upward).
    // maxJustifiedHeadcount = the productivity-floor ceiling for that hour — the most staff its sales can justify, never a target to reach either.
    const minRequiredByHour = new Map(dayDemand.hours.map((h) => [h.hour, h.requiredHeadcount]));
    const maxJustifiedByHour = new Map(dayDemand.hours.map((h) => [h.hour, h.maxJustifiedHeadcount]));

    const dailyForecastValue = dayDemand.hours.reduce((sum, h) => sum + h.forecastedSales, 0);
    const budget = await computeDailyLaborHoursBudget({ storeId, date, forecastValue: dailyForecastValue });
    if (budget.allowedLaborHours != null) dailyLaborHoursBudget.push({ date, ...budget });
    // No tier matched -> fall back to the natural total of the operational-minimum curve (never the productivity-scaled one — that would reintroduce "size to the target" behavior).
    const dailyBudgetHours = budget.allowedLaborHours ?? dayDemand.hours.reduce((sum, h) => sum + h.requiredHeadcount, 0);

    const coverageByHour = {};
    let hoursUsedToday = 0;

    /** How many consecutive calendar days up to (and including) the day before `date` this employee has already worked — used only to enforce Full-time's max-6-consecutive-days rest rule. Stops counting at the cap; the exact streak length beyond that never matters. */
    function consecutiveDayStreakBefore(employeeId) {
      const worked = workedDatesByEmployee.get(employeeId);
      if (!worked) return 0;
      let streak = 0;
      let cursor = toUTCDate(date);
      while (streak < FULL_TIME_MAX_CONSECUTIVE_DAYS) {
        cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
        if (!worked.has(cursor.toISOString().slice(0, 10))) break;
        streak++;
      }
      return streak;
    }

    /** Finds the best-fit eligible employee of `type` for a `lengthHours` shift; null if none. Never bypasses per-employee weekly/monthly caps (Priority 2) — only `respectStoreCap: false` skips the store-level monthly check (used by coverage/minimum-staffing phases, which outrank the monthly cap per Priority 3 vs. 4). */
    function pickEmployee(type, lengthHours, { respectStoreCap = true } = {}) {
      const candidates = employees
        .filter((emp) => {
          if (employeeShiftType(emp) !== type) return false;
          if (assignedDay[`${emp.id}-${date}`]) return false;
          const wouldExceedWeek = (weeklyUsed[`${emp.id}-${weekStart}`] || 0) + lengthHours > weeklyCapFor(emp);
          const wouldExceedMonth = (monthlyUsed[`${emp.id}-${mk}`] || 0) + lengthHours > monthlyCap[mk][emp.id];
          if (wouldExceedWeek || wouldExceedMonth) return false;
          // Thailand labor-law baseline: a Full-time employee must get a rest day at least every 6 consecutive working days — this is a hard cap independent of the weekly-hour cap above, which resets at the ISO-week boundary and would otherwise allow e.g. Wed-Sun + Mon-Sat (11 straight days) across two weeks.
          if (type === 'FULL_TIME' && consecutiveDayStreakBefore(emp.id) >= FULL_TIME_MAX_CONSECUTIVE_DAYS) return false;
          if (respectStoreCap && storeMonthlyRemaining[mk] != null && lengthHours > storeMonthlyRemaining[mk]) return false;
          return true;
        })
        .sort((a, b) => (monthlyUsed[`${a.id}-${mk}`] || 0) - (monthlyUsed[`${b.id}-${mk}`] || 0)); // fair distribution within the month
      return candidates[0] || null;
    }

    function place(type, startHour, lengthHours, options) {
      const emp = pickEmployee(type, lengthHours, options);
      if (!emp) return null;
      const row = buildShiftRow({ employeeId: emp.id, date, startHour, lengthHours, type });
      shiftRows.push(row);
      assignedDay[`${emp.id}-${date}`] = true;
      weeklyUsed[`${emp.id}-${weekStart}`] = (weeklyUsed[`${emp.id}-${weekStart}`] || 0) + lengthHours;
      monthlyUsed[`${emp.id}-${mk}`] = (monthlyUsed[`${emp.id}-${mk}`] || 0) + lengthHours;
      if (storeMonthlyRemaining[mk] != null) storeMonthlyRemaining[mk] -= lengthHours;
      if (!workedDatesByEmployee.has(emp.id)) workedDatesByEmployee.set(emp.id, new Set());
      workedDatesByEmployee.get(emp.id).add(date);

      // Coverage excludes the break hour — the employee isn't floor coverage while on break (any gap this creates is backfilled by the minimum-staffing phase below, same as any other coverage gap).
      const breakStartHour = row.break_start_time ? Number(row.break_start_time.slice(0, 2)) : null;
      const endHour = Number(row.end_time.slice(0, 2));
      for (let h = startHour; h < endHour; h++) {
        if (h === breakStartHour) continue;
        coverageByHour[h] = (coverageByHour[h] || 0) + 1;
      }
      hoursUsedToday += lengthHours;
      return { length: lengthHours };
    }

    /**
     * Guarantees opening (09:00 start) or closing (22:00 end) coverage.
     * Priority, matching the business examples given (FT preferred when it
     * fits the remaining daily budget; PT sized to the remaining budget
     * otherwise; FT as a last resort so coverage is never silently
     * dropped for budget reasons alone — daily budget adherence yields to
     * opening/closing coverage, but per-employee hour caps never do):
     *   1. Full-time (8h) if it fits dailyBudgetRemaining and an FT employee is eligible.
     *   2. Part-time, length clamped to fit dailyBudgetRemaining (4-6h), if a PT employee is eligible.
     *   3. Full-time (8h) regardless of budget fit, if that's the only eligible type left.
     */
    function guaranteeCoverage({ isOpening, dailyBudgetRemaining }) {
      const ftStart = isOpening ? OPERATING_HOURS.start : OPERATING_HOURS.end - FULL_TIME_CLOCK_SPAN_HOURS;
      const ptLength = clampPartTimeHours(Math.max(dailyBudgetRemaining, PART_TIME_MIN_HOURS));
      const ptStart = isOpening ? OPERATING_HOURS.start : OPERATING_HOURS.end - ptLength;

      if (dailyBudgetRemaining >= FULL_TIME_SHIFT_HOURS) {
        const ftRow = place('FULL_TIME', ftStart, FULL_TIME_SHIFT_HOURS, { respectStoreCap: false });
        if (ftRow) return ftRow;
      }
      const ptRow = place('PART_TIME', ptStart, ptLength, { respectStoreCap: false });
      if (ptRow) return ptRow;

      return place('FULL_TIME', ftStart, FULL_TIME_SHIFT_HOURS, { respectStoreCap: false });
    }

    const openingResult = guaranteeCoverage({ isOpening: true, dailyBudgetRemaining: dailyBudgetHours });
    if (!openingResult) {
      warnings.push(`${date}: could not guarantee opening coverage — no eligible employee available (all active employees are either already scheduled that day or at their weekly/monthly hour cap).`);
      budgetShortfalls.push({ date, requiredHours: null, allowedHours: dailyBudgetHours, shortageHours: null, reason: 'No eligible Full-time or Part-time employee available to cover opening (09:00).' });
    }

    // Closing requires CLOSING_COVERAGE_STAFF_COUNT (2) DIFFERENT employees whose shift
    // ends exactly at closing time — not just one person present in the last hour. Each
    // iteration reuses guaranteeCoverage() unchanged (its FT-if-fits-budget -> PT-sized-
    // to-fit -> FT-regardless-of-budget priority already matches the business examples),
    // and automatically lands on a different employee each time since place() already
    // marks assignedDay[empId-date] and pickEmployee() already excludes that.
    let closingHoursUsed = 0;
    let closingStaffFound = 0;
    for (let i = 0; i < CLOSING_COVERAGE_STAFF_COUNT; i++) {
      const closingResult = guaranteeCoverage({
        isOpening: false,
        dailyBudgetRemaining: dailyBudgetHours - (openingResult?.length || 0) - closingHoursUsed,
      });
      if (!closingResult) {
        warnings.push(
          `${date}: could not guarantee closing coverage — needed ${CLOSING_COVERAGE_STAFF_COUNT} employee(s) ending at closing time but only found ${closingStaffFound} (all remaining active employees are either already scheduled that day or at their weekly/monthly hour cap).`
        );
        budgetShortfalls.push({
          date,
          requiredHours: null,
          allowedHours: dailyBudgetHours,
          shortageHours: null,
          reason: `Only ${closingStaffFound} of ${CLOSING_COVERAGE_STAFF_COUNT} required closing (22:00) employees could be scheduled — no further eligible Full-time or Part-time employee available.`,
        });
        break;
      }
      closingHoursUsed += closingResult.length;
      closingStaffFound += 1;
    }

    // --- Priority 3: mandatory minimum staffing ---------------------------
    // Fills any hour still below its operational minimum (e.g. a gap the
    // opening/closing blocks didn't happen to span). This outranks the
    // monthly cap AND the daily labor-hour budget (Priority 3 > 4 > 5), so
    // it bypasses the store cap the same way opening/closing coverage
    // does — per-employee weekly/monthly caps (Priority 2) are still never
    // bypassed. Uses the smallest valid block (a 4h Part-time shift) to
    // minimize spillover into hours that don't need it; only falls back to
    // Full-time if no Part-time employee is eligible.
    for (const hour of operatingHourList()) {
      while ((coverageByHour[hour] || 0) < (minRequiredByHour.get(hour) ?? 1)) {
        const ptStart = Math.min(Math.max(hour, OPERATING_HOURS.start), OPERATING_HOURS.end - PART_TIME_MIN_HOURS);
        let placed = place('PART_TIME', ptStart, PART_TIME_MIN_HOURS, { respectStoreCap: false });
        if (!placed) {
          const ftStart = Math.min(Math.max(hour - 4, OPERATING_HOURS.start), OPERATING_HOURS.end - FULL_TIME_CLOCK_SPAN_HOURS);
          placed = place('FULL_TIME', ftStart, FULL_TIME_SHIFT_HOURS, { respectStoreCap: false });
        }
        if (!placed) {
          warnings.push(`${date} ${pad(hour)}:00: could not reach minimum staffing — no eligible employee available (all active employees are either already scheduled that day or at their weekly/monthly hour cap).`);
          break;
        }
      }
    }

    if (hoursUsedToday > dailyBudgetHours) {
      const shortageHours = round2(hoursUsedToday - dailyBudgetHours);
      budgetShortfalls.push({
        date,
        requiredHours: hoursUsedToday,
        allowedHours: dailyBudgetHours,
        shortageHours,
        reason: 'Mandatory opening/closing coverage and/or minimum staffing required more labor hours than the Sales/Budget -> Labor Hours guideline allows for this day.',
      });
      warnings.push(`${date}: mandatory coverage required ${hoursUsedToday}h but the daily labor-hour guideline only allows ${dailyBudgetHours}h (shortage ${shortageHours}h).`);
    }

    // --- Priority 6/7: productivity-justified extra staffing --------------
    // Adds MORE staff only where an hour's sales genuinely justify it —
    // never past maxJustifiedHeadcount (the productivity floor), and never
    // past the daily labor-hour budget or the store's remaining monthly
    // capacity (Priority 4/5 outrank this). Targets the hour with the
    // largest (maxJustified - scheduled) gap first, so high-sales hours get
    // priority; stops the moment no hour has room, the budget runs out, or
    // no eligible employee remains — this is why total hours are an OUTPUT
    // of the optimization, never padded to hit the daily/monthly guideline.
    let remainingDailyBudget = dailyBudgetHours - hoursUsedToday;
    while (remainingDailyBudget >= PART_TIME_MIN_HOURS) {
      let targetHour = null;
      let bestGap = 0;
      for (const hour of operatingHourList()) {
        const gap = (maxJustifiedByHour.get(hour) ?? 1) - (coverageByHour[hour] || 0);
        if (gap > bestGap) {
          bestGap = gap;
          targetHour = hour;
        }
      }
      if (targetHour == null) break; // no hour has room under its productivity-justified ceiling — nothing more to add

      const ptLength = clampPartTimeHours(Math.min(remainingDailyBudget, PART_TIME_MAX_HOURS));
      const ptStart = Math.min(Math.max(targetHour, OPERATING_HOURS.start), OPERATING_HOURS.end - ptLength);
      let placed = place('PART_TIME', ptStart, ptLength, { respectStoreCap: true });

      if (!placed && remainingDailyBudget >= FULL_TIME_SHIFT_HOURS) {
        const ftStart = Math.min(Math.max(targetHour - 4, OPERATING_HOURS.start), OPERATING_HOURS.end - FULL_TIME_CLOCK_SPAN_HOURS);
        placed = place('FULL_TIME', ftStart, FULL_TIME_SHIFT_HOURS, { respectStoreCap: true });
      }

      if (!placed) break; // no eligible employee of either type left
      remainingDailyBudget -= placed.length;
    }
  }

  // --- Persist: one roster row per ISO week touched, shifts scoped to the
  //     exact requested date range within each week (partial-week requests
  //     never touch days outside the range, even on regenerate).
  const shiftsByWeek = new Map();
  for (const row of shiftRows) {
    const wk = isoWeekStart(row.shift_date);
    if (!shiftsByWeek.has(wk)) shiftsByWeek.set(wk, []);
    shiftsByWeek.get(wk).push(row);
  }
  // Weeks with zero assigned shifts (e.g. every slot went unfilled) still need
  // their existing shifts cleared on a regenerate, so derive the week list
  // from the full date range rather than only weeks that got a shift.
  for (const date of eachDateInRange(startDate, endDate)) {
    const wk = isoWeekStart(date);
    if (!shiftsByWeek.has(wk)) shiftsByWeek.set(wk, []);
  }

  const rosterIds = [];
  for (const [weekStart, rows] of shiftsByWeek) {
    const roster = await rosterRepo.findOrCreateRoster({ storeId, weekStart });
    await rosterRepo.deleteShiftsForRosterInRange(roster.id, startDate, endDate);
    await rosterRepo.insertShifts(rows.map((r) => ({ ...r, roster_id: roster.id })));
    rosterIds.push(roster.id);
  }

  const validation = await validateRoster({ storeId, startDate, endDate });

  return {
    storeId,
    startDate,
    endDate,
    rosterIds,
    forecastSummary: { modelRunId: hourlyForecast.modelRunId, hourShapeSource: hourlyForecast.hourShapeSource, totalForecast: hourlyForecast.totalForecast, days: hourlyForecast.days },
    laborDemand: { days: laborDemand.days },
    dailyLaborHoursBudget, // [{ date, salesLevel, salesLevelSource, allowedLaborHours, tierSource, level, ... }] — only for dates a Sales/Budget tier actually matched
    budgetShortfalls, // [{ date, requiredHours, allowedHours, shortageHours, reason }] — opening/closing coverage that couldn't fit the daily budget, or couldn't be filled at all
    monthlyCapacityBeforeGeneration: monthsTouched.map((mk) => ({ monthKey: mk, remainingHoursBeforeThisRun: remainingHoursBeforeGeneration[mk] })),
    generatedShifts: shiftRows.length,
    totalLaborHours: validation.plannedLaborHours,
    estimatedLaborCost: validation.plannedLaborCost,
    laborCostPercent: validation.laborCostPercent,
    productivity: validation.productivity,
    warnings: [...warnings, ...validation.warnings],
    validation,
  };
}

module.exports = {
  generateDraftRoster,
  employeeShiftType,
  weeklyCapFor,
  FULL_TIME_SHIFT_HOURS,
  FULL_TIME_BREAK_HOURS,
  FULL_TIME_CLOCK_SPAN_HOURS,
  FULL_TIME_MAX_CONSECUTIVE_DAYS,
  PART_TIME_MIN_HOURS,
  PART_TIME_MAX_HOURS,
};
