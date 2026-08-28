const rosterRepo = require('../repositories/rosterRepository');
const forecastRepo = require('../repositories/forecastRepository');
const laborBudgetRepo = require('../repositories/laborBudgetRepository');
const { computeHourlyLaborDemand } = require('./laborDemandService');
const { resolveSalesLevel, computeLaborCostBudget } = require('./laborBudgetService');
const { computeMonthlyCapacity } = require('./monthlyCapacityService');
const { OPERATING_HOURS, operatingHourList, daypartToHour } = require('./storeOperatingHours');
const { eachDateInRange, monthKey, monthRange } = require('../utils/dateRange');
const {
  employeeShiftType,
  FULL_TIME_SHIFT_HOURS,
  FULL_TIME_BREAK_HOURS,
  FULL_TIME_MAX_CONSECUTIVE_DAYS,
  PART_TIME_MIN_HOURS,
  PART_TIME_MAX_HOURS,
} = require('./employeeShiftRules');

const OVERSTAFF_TOLERANCE = 1; // scheduled may exceed required by this many heads before it's flagged — required is already a rounded-up estimate, so a 1-person buffer avoids flagging every shift boundary as "overstaffed"

function pad(hour) {
  return String(hour).padStart(2, '0');
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** end_time as an hour-of-day integer, handling the '24:00' edge case the same way the rest of this file already does. */
function endHourOf(shift) {
  return shift.end_time === '24:00' ? 24 : Number(shift.end_time.slice(0, 2));
}

function startHourOf(shift) {
  return Number(shift.start_time.slice(0, 2));
}

/** Every distinct 'YYYY-MM-DD' date one or more shifts fall on, per employee, sorted ascending. */
function workedDatesByEmployee(shiftList) {
  const byEmployee = new Map();
  for (const s of shiftList) {
    if (!byEmployee.has(s.employee_id)) byEmployee.set(s.employee_id, new Set());
    byEmployee.get(s.employee_id).add(s.shift_date);
  }
  for (const [empId, dates] of byEmployee) byEmployee.set(empId, [...dates].sort());
  return byEmployee;
}

/** Longest run of consecutive calendar dates in a sorted, deduplicated 'YYYY-MM-DD' array. */
function longestConsecutiveRun(sortedDates) {
  let longest = sortedDates.length ? 1 : 0;
  let current = longest;
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(`${sortedDates[i - 1]}T00:00:00Z`);
    const next = new Date(`${sortedDates[i]}T00:00:00Z`);
    if (next.getTime() - prev.getTime() === 24 * 60 * 60 * 1000) {
      current++;
    } else {
      current = 1;
    }
    if (current > longest) longest = current;
  }
  return longest;
}

/** The most working hours summed across any 7-consecutive-calendar-day window covered by `dates`. */
function maxRolling7DayHours(sortedDates, hoursByDate) {
  let max = 0;
  for (const windowStart of sortedDates) {
    const start = new Date(`${windowStart}T00:00:00Z`);
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      sum += hoursByDate.get(d) || 0;
    }
    if (sum > max) max = sum;
  }
  return max;
}

/** Effective monthly hour cap for an employee — see rosterGenerationService.js for why this is derived from default_weekly_hours rather than a dedicated monthly field (none exists in the schema). */
function monthlyCapFor(employee, days) {
  const weekly = employee.default_weekly_hours != null ? Number(employee.default_weekly_hours) : 48; // documented fallback, matches the pre-existing MAX_WEEKLY_HOURS default
  return (weekly / 7) * days;
}

/** hours x hr_comp_amount for HOURLY employees; sl_comp_amount (flat, un-prorated) for MONTHLY employees — see PHASE 2 Section 9/10. Returns { hourlyCost, monthlyCost, employeesMissingWage }. */
function computeShiftCost(shifts) {
  let hourlyCost = 0;
  let employeesMissingWage = 0;
  const monthlyEmployeesSeen = new Map(); // employeeId -> employee, deduped — a monthly salary is charged once, not per shift

  for (const s of shifts) {
    const emp = s.employee;
    if (!emp) {
      employeesMissingWage++;
      continue;
    }
    if (emp.pay_rate_type === 'Hourly') {
      if (emp.hr_comp_amount != null) hourlyCost += Number(s.planned_hours) * Number(emp.hr_comp_amount);
      else employeesMissingWage++;
    } else if (emp.pay_rate_type === 'Monthly') {
      if (emp.sl_comp_amount != null) monthlyEmployeesSeen.set(emp.id, emp);
      else employeesMissingWage++;
    } else {
      employeesMissingWage++;
    }
  }

  const monthlyCost = [...monthlyEmployeesSeen.values()].reduce((sum, emp) => sum + Number(emp.sl_comp_amount), 0);
  return { hourlyCost, monthlyCost, monthlyEmployeeCount: monthlyEmployeesSeen.size, employeesMissingWage };
}

/**
 * Validates an already-generated (or manually edited) roster for a store
 * over a date range against PHASE 1F + PHASE 2's checklist: opening/closing
 * coverage, per-hour under/overstaffing, employee AND store-level monthly
 * hour limits, planned vs. actual hours/cost, sales/labor budget, labor
 * cost %, and productivity. Read-only — never writes roster/shift data.
 */
async function validateRoster({ storeId, startDate, endDate }) {
  const [guideline, shifts, forecastRows, salesBudgetRows, actualHoursRows] = await Promise.all([
    rosterRepo.findGuideline(storeId),
    rosterRepo.findShiftsForStoreInRange(storeId, startDate, endDate),
    forecastRepo.findForecastRows({ storeId, startDate, endDate, hourly: true }),
    laborBudgetRepo.findGrossBudgetRange(storeId, startDate, endDate),
    laborBudgetRepo.findStoreActualHours(storeId, { from: startDate, to: endDate }),
  ]);

  const warnings = [];
  if (!guideline) warnings.push('No labor guideline configured for this store — coverage is still checked, but labor cost %, productivity, and labor budget cannot be compared against a target.');

  // --- Required headcount per (date, hour), from the hourly forecast -----
  const forecastByDate = new Map();
  for (const row of forecastRows) {
    if (!forecastByDate.has(row.forecast_date)) forecastByDate.set(row.forecast_date, []);
    forecastByDate.get(row.forecast_date).push({ hour: daypartToHour(row.daypart), forecastedSales: Number(row.forecasted_sales) });
  }
  const salesBudgetByDate = new Map(salesBudgetRows.filter((r) => r.gross_budget != null).map((r) => [r.report_date, Number(r.gross_budget)]));
  const actualHoursByDate = new Map(actualHoursRows.map((r) => [r.actual_date, Number(r.actual_hours)]));

  const requiredByDateHour = new Map(); // operational minimum — understaffed = below this
  const maxJustifiedByDateHour = new Map(); // productivity-floor ceiling — overstaffed = above this (+ tolerance); NEVER a target to reach
  const datesWithoutForecast = [];
  for (const date of eachDateInRange(startDate, endDate)) {
    const hourlyForecast = forecastByDate.get(date);
    if (!hourlyForecast) {
      datesWithoutForecast.push(date);
      for (const hour of operatingHourList()) {
        requiredByDateHour.set(`${date}|${hour}`, 1); // no forecast yet — the "never zero staff while open" floor still applies
        maxJustifiedByDateHour.set(`${date}|${hour}`, 1);
      }
      continue;
    }
    for (const d of computeHourlyLaborDemand({ hourlyForecast, guideline })) {
      requiredByDateHour.set(`${date}|${d.hour}`, d.requiredHeadcount);
      maxJustifiedByDateHour.set(`${date}|${d.hour}`, d.maxJustifiedHeadcount);
    }
  }
  if (datesWithoutForecast.length) {
    warnings.push(`No hourly forecast found for ${datesWithoutForecast.length} date(s) in range — only the minimum coverage floor was checked for them, not demand-based staffing.`);
  }

  // --- Scheduled headcount per (date, hour), from actual shifts ----------
  // A shift's break hour is excluded — that employee isn't floor coverage
  // while on break, so a break must not silently count as staffed.
  const scheduledByDateHour = new Map();
  const breakHoursByDateHour = new Set(); // `${date}|${hour}` — every FULL_TIME shift's break hour, used to tell a break-caused gap apart from ordinary understaffing
  for (const s of shifts) {
    const startHour = startHourOf(s);
    const endHour = endHourOf(s);
    const breakHour = s.break_start_time ? Number(s.break_start_time.slice(0, 2)) : null;
    if (breakHour != null) breakHoursByDateHour.add(`${s.shift_date}|${breakHour}`);
    for (let h = startHour; h < endHour; h++) {
      if (h < OPERATING_HOURS.start || h >= OPERATING_HOURS.end) continue; // outside the store's operating window isn't a coverage concern
      if (h === breakHour) continue;
      const key = `${s.shift_date}|${h}`;
      scheduledByDateHour.set(key, (scheduledByDateHour.get(key) || 0) + 1);
    }
  }

  const understaffedHours = [];
  const overstaffedHours = [];
  const breakCoverageGapViolations = []; // the subset of understaffed hours directly caused by a break — see spec section 12 "break creates coverage gap"
  let openingCoverageOk = true;
  let closingCoverageOk = true;
  const lastOperatingHour = OPERATING_HOURS.end - 1;

  for (const date of eachDateInRange(startDate, endDate)) {
    for (const hour of operatingHourList()) {
      const key = `${date}|${hour}`;
      const scheduled = scheduledByDateHour.get(key) || 0;
      const required = requiredByDateHour.get(key) ?? 1;
      const maxJustified = maxJustifiedByDateHour.get(key) ?? required;
      if (scheduled < required) {
        understaffedHours.push(`${date} ${pad(hour)}:00`);
        if (breakHoursByDateHour.has(key)) breakCoverageGapViolations.push(`${date} ${pad(hour)}:00`);
      }
      if (scheduled > maxJustified + OVERSTAFF_TOLERANCE) overstaffedHours.push(`${date} ${pad(hour)}:00`);
      if (scheduled === 0 && hour === OPERATING_HOURS.start) openingCoverageOk = false;
      if (scheduled === 0 && hour === lastOperatingHour) closingCoverageOk = false;
    }
  }

  // --- Employee monthly-hour limits ---------------------------------------
  const employeeIds = [...new Set(shifts.map((s) => s.employee_id))];
  const employeesById = new Map(shifts.filter((s) => s.employee).map((s) => [s.employee_id, s.employee]));
  const monthsTouched = [...new Set(eachDateInRange(startDate, endDate).map(monthKey))];

  const employeesOverLimit = [];
  let monthShifts = [];
  let overallRange = null;
  if (employeeIds.length && monthsTouched.length) {
    overallRange = { start: monthRange(monthsTouched[0]).start, end: monthRange(monthsTouched[monthsTouched.length - 1]).end };
    monthShifts = await rosterRepo.findShiftsForEmployeesInRange(employeeIds, overallRange.start, overallRange.end);

    for (const monthK of monthsTouched) {
      const { days } = monthRange(monthK);
      for (const empId of employeeIds) {
        const employee = employeesById.get(empId);
        if (!employee) continue;
        const usedHours = monthShifts
          .filter((s) => s.employee_id === empId && monthKey(s.shift_date) === monthK)
          .reduce((sum, s) => sum + Number(s.planned_hours), 0);
        const cap = monthlyCapFor(employee, days);
        if (usedHours > cap) {
          employeesOverLimit.push({
            employeeId: empId,
            name: [employee.first_name, employee.last_name].filter(Boolean).join(' ') || null,
            month: monthK,
            scheduledHours: round2(usedHours),
            monthlyCapHours: round2(cap),
          });
        }
      }
    }
  }

  // --- Section 12 checklist: per-shift constraint checks ------------------
  // Runs over every scheduled shift (not just generator output), so a
  // manually edited roster is caught too, per this function's own contract.
  const ftWorkingHoursViolations = [];
  const ftBreakViolations = [];
  const ptHoursViolations = [];
  const shiftWindowViolations = [];
  const doubleBookingViolations = [];
  const shiftsByEmployeeDate = new Map(); // `${employeeId}|${date}` -> shift[]

  for (const s of shifts) {
    const employee = s.employee;
    const plannedHours = Number(s.planned_hours);
    const type = employee ? employeeShiftType(employee) : null;

    if (type === 'FULL_TIME') {
      if (plannedHours !== FULL_TIME_SHIFT_HOURS) {
        ftWorkingHoursViolations.push({ shiftId: s.id, employeeId: s.employee_id, date: s.shift_date, plannedHours });
      }
      const breakHours = s.break_start_time && s.break_end_time ? Number(s.break_end_time.slice(0, 2)) - Number(s.break_start_time.slice(0, 2)) : null;
      if (breakHours == null) {
        ftBreakViolations.push({ shiftId: s.id, employeeId: s.employee_id, date: s.shift_date, reason: 'missing meal break' });
      } else if (breakHours !== FULL_TIME_BREAK_HOURS) {
        ftBreakViolations.push({ shiftId: s.id, employeeId: s.employee_id, date: s.shift_date, reason: `break_hours = ${breakHours}, expected ${FULL_TIME_BREAK_HOURS}` });
      }
    } else if (type === 'PART_TIME' && (plannedHours < PART_TIME_MIN_HOURS || plannedHours > PART_TIME_MAX_HOURS)) {
      ptHoursViolations.push({ shiftId: s.id, employeeId: s.employee_id, date: s.shift_date, plannedHours });
    }

    if (startHourOf(s) < OPERATING_HOURS.start || endHourOf(s) > OPERATING_HOURS.end) {
      shiftWindowViolations.push({ shiftId: s.id, employeeId: s.employee_id, date: s.shift_date, startTime: s.start_time, endTime: s.end_time });
    }

    const edKey = `${s.employee_id}|${s.shift_date}`;
    if (!shiftsByEmployeeDate.has(edKey)) shiftsByEmployeeDate.set(edKey, []);
    shiftsByEmployeeDate.get(edKey).push(s);
  }
  for (const [edKey, group] of shiftsByEmployeeDate) {
    if (group.length > 1) {
      const [employeeId, date] = edKey.split('|');
      doubleBookingViolations.push({ employeeId, date, shiftIds: group.map((s) => s.id) });
    }
  }

  // --- Full-time rolling 7-day hour cap (48h) and consecutive-working-day rest rule ---
  // Reuses monthShifts (the full-month lookback already fetched above) so a
  // window near the range boundary still sees the days just outside it.
  const ftWeeklyHourViolations = [];
  const consecutiveDayViolations = [];
  if (monthShifts.length && overallRange) {
    const ftEmployeeIds = employeeIds.filter((empId) => employeesById.get(empId) && employeeShiftType(employeesById.get(empId)) === 'FULL_TIME');
    const datesByEmployee = workedDatesByEmployee(monthShifts);
    const candidateWindowStarts = eachDateInRange(overallRange.start, overallRange.end); // every calendar day, not just worked ones — a window can start on a rest day and still capture the worst 7-day stretch

    for (const empId of ftEmployeeIds) {
      const employee = employeesById.get(empId);
      const name = [employee.first_name, employee.last_name].filter(Boolean).join(' ') || null;
      const empShifts = monthShifts.filter((s) => s.employee_id === empId);
      const hoursByDate = new Map();
      for (const s of empShifts) hoursByDate.set(s.shift_date, (hoursByDate.get(s.shift_date) || 0) + Number(s.planned_hours));

      const worstWeeklyHours = maxRolling7DayHours(candidateWindowStarts, hoursByDate);
      if (worstWeeklyHours > 48) ftWeeklyHourViolations.push({ employeeId: empId, name, maxRolling7DayHours: round2(worstWeeklyHours) });

      const longestRun = longestConsecutiveRun(datesByEmployee.get(empId) || []);
      if (longestRun > FULL_TIME_MAX_CONSECUTIVE_DAYS) consecutiveDayViolations.push({ employeeId: empId, name, consecutiveWorkingDays: longestRun });
    }
  }

  if (ftWorkingHoursViolations.length) warnings.push(`${ftWorkingHoursViolations.length} Full-time shift(s) do not have exactly ${FULL_TIME_SHIFT_HOURS} working hours.`);
  if (ftBreakViolations.length) warnings.push(`${ftBreakViolations.length} Full-time shift(s) are missing their mandatory 1-hour break, or have the wrong break duration.`);
  if (breakCoverageGapViolations.length) warnings.push(`${breakCoverageGapViolations.length} hour(s) fell below the required headcount specifically because of a scheduled break.`);
  if (ftWeeklyHourViolations.length) warnings.push(`${ftWeeklyHourViolations.length} Full-time employee(s) exceeded 48 working hours in a rolling 7-day window.`);
  if (consecutiveDayViolations.length) warnings.push(`${consecutiveDayViolations.length} Full-time employee(s) worked more than ${FULL_TIME_MAX_CONSECUTIVE_DAYS} consecutive days without a rest day.`);
  if (ptHoursViolations.length) warnings.push(`${ptHoursViolations.length} Part-time shift(s) fall outside the ${PART_TIME_MIN_HOURS}-${PART_TIME_MAX_HOURS} hour range.`);
  if (shiftWindowViolations.length) warnings.push(`${shiftWindowViolations.length} shift(s) fall outside the store's ${pad(OPERATING_HOURS.start)}:00-${pad(OPERATING_HOURS.end)}:00 operating window.`);
  if (doubleBookingViolations.length) warnings.push(`${doubleBookingViolations.length} employee-date pair(s) have more than one shift scheduled (double booking).`);

  // --- Store-level monthly labor-hour guideline (PHASE 2 Section 3) ------
  const monthlyCapacity = await Promise.all(monthsTouched.map((mk) => computeMonthlyCapacity({ storeId, monthKey: mk, guideline })));
  const monthlyGuidelineViolations = monthlyCapacity.filter((m) => m.monthlyGuideline != null && m.hoursUsedOrCommitted > m.monthlyGuideline);
  if (monthlyGuidelineViolations.length) {
    for (const m of monthlyGuidelineViolations) warnings.push(`Store-level monthly labor-hour guideline exceeded for ${m.monthKey}: ${m.hoursUsedOrCommitted}h used/committed vs. a ${m.monthlyGuideline}h guideline.`);
  }

  // --- Planned vs. actual hours (PHASE 2 Section 4) -----------------------
  const plannedHoursByDate = new Map();
  for (const s of shifts) plannedHoursByDate.set(s.shift_date, (plannedHoursByDate.get(s.shift_date) || 0) + Number(s.planned_hours));

  const totalPlannedHours = [...plannedHoursByDate.values()].reduce((s, h) => s + h, 0);
  const totalActualHours = actualHoursByDate.size ? [...actualHoursByDate.values()].reduce((s, h) => s + h, 0) : null;
  const actualHoursVariance = totalActualHours != null ? round2(totalActualHours - totalPlannedHours) : null;
  if (actualHoursVariance != null && actualHoursVariance !== 0) {
    warnings.push(`Actual hours vary from planned by ${actualHoursVariance > 0 ? '+' : ''}${actualHoursVariance}h in this range — this reduces remaining monthly capacity but does not invalidate the roster.`);
  }

  // --- Labor cost (planned) and estimated actual cost (PHASE 2 Section 9/10) ---
  const { hourlyCost, monthlyCost, monthlyEmployeeCount, employeesMissingWage } = computeShiftCost(shifts);
  const plannedLaborCost = hourlyCost + monthlyCost;
  if (employeesMissingWage > 0) {
    warnings.push(`${employeesMissingWage} scheduled shift(s) belong to an employee without wage data on file for their pay_rate_type — labor cost is understated for them.`);
  }
  if (monthlyEmployeeCount > 0) {
    warnings.push(`${monthlyEmployeeCount} MONTHLY-rate employee(s) included at their full sl_comp_amount (not prorated to this date range) — see plannedLaborCost breakdown.`);
  }
  // Actual cost isn't precisely computable without employee-level actual hours; scale the hourly portion by the store-level actual/planned ratio as a clearly-flagged estimate (monthly salaries don't scale with hours worked, so they're carried through unchanged).
  const actualLaborCost = totalActualHours != null && totalPlannedHours > 0 ? round2(hourlyCost * (totalActualHours / totalPlannedHours) + monthlyCost) : null;

  // --- Sales/labor budget (PHASE 2 Section 1) + forecast total -----------
  const salesForecastTotal = [...forecastByDate.values()].reduce((sum, rows) => sum + rows.reduce((s, r) => s + r.forecastedSales, 0), 0);
  let salesBudgetTotal = 0;
  let laborBudgetTotal = 0;
  let hasSalesBudget = false;
  for (const date of eachDateInRange(startDate, endDate)) {
    const forecastForDate = forecastByDate.get(date);
    const dailyForecastValue = forecastForDate ? forecastForDate.reduce((s, r) => s + r.forecastedSales, 0) : null;
    const salesLevel = salesBudgetByDate.has(date)
      ? { value: salesBudgetByDate.get(date), source: 'GROSS_BUDGET' }
      : await resolveSalesLevel({ storeId, date, forecastValue: dailyForecastValue });
    if (salesLevel.value != null) {
      hasSalesBudget = true;
      salesBudgetTotal += salesLevel.value;
      const dailyBudget = computeLaborCostBudget({ salesLevel: salesLevel.value, guideline });
      if (dailyBudget != null) laborBudgetTotal += dailyBudget;
    }
  }

  const targetProductivity = guideline?.target_productivity != null ? Number(guideline.target_productivity) : null;
  const targetLaborCostPercent = guideline?.target_col_percent != null ? Number(guideline.target_col_percent) : null;

  const laborCostPercent = salesForecastTotal > 0 ? round2((plannedLaborCost / salesForecastTotal) * 100) : null; // unchanged from Phase 1 (forecast-relative) — salesBudgetTotal/laborBudgetTotal below are the new, separate budget-vs-cost check
  const productivity = totalPlannedHours > 0 ? round2(salesForecastTotal / totalPlannedHours) : null;
  const overLaborBudget = hasSalesBudget && laborBudgetTotal > 0 && plannedLaborCost > laborBudgetTotal;
  if (overLaborBudget) warnings.push(`Planned labor cost (${round2(plannedLaborCost)}) exceeds the labor budget (${round2(laborBudgetTotal)}) derived from sales budget x target_col_percent.`);

  // --- Per-date breakdown (PHASE 2 Section 13's frontend table) ----------
  const dailyBreakdown = eachDateInRange(startDate, endDate).map((date) => {
    const forecastForDate = forecastByDate.get(date);
    const forecastSales = forecastForDate ? Math.round(forecastForDate.reduce((s, r) => s + r.forecastedSales, 0)) : null;
    const plannedHours = round2(plannedHoursByDate.get(date) || 0);
    const actualHours = actualHoursByDate.has(date) ? round2(actualHoursByDate.get(date)) : null;
    const dayShifts = shifts.filter((s) => s.shift_date === date);
    const { hourlyCost: dayHourlyCost } = computeShiftCost(dayShifts);
    return {
      date,
      salesBudget: salesBudgetByDate.has(date) ? Number(salesBudgetByDate.get(date)) : null,
      forecastSales,
      plannedHours,
      actualHours,
      variance: actualHours != null ? round2(actualHours - plannedHours) : null,
      laborCost: round2(dayHourlyCost), // monthly salaries aren't attributable to a single day, so daily rows show hourly cost only — see plannedLaborCost for the full total
      productivity: plannedHours > 0 && forecastSales != null ? round2(forecastSales / plannedHours) : null,
    };
  });

  const hasHardViolation =
    !openingCoverageOk ||
    !closingCoverageOk ||
    employeesOverLimit.length > 0 ||
    monthlyGuidelineViolations.length > 0 ||
    ftWorkingHoursViolations.length > 0 ||
    ftBreakViolations.length > 0 ||
    ftWeeklyHourViolations.length > 0 ||
    consecutiveDayViolations.length > 0 ||
    ptHoursViolations.length > 0 ||
    shiftWindowViolations.length > 0 ||
    doubleBookingViolations.length > 0;

  let status = 'OK';
  if (hasHardViolation) {
    status = 'FAILED';
  } else if (understaffedHours.length > 0 || overstaffedHours.length > 0 || overLaborBudget) {
    status = 'WARNING'; // includes breakCoverageGapViolations — it's always a subset of understaffedHours, not a separate FAILED condition
  }

  return {
    storeId,
    startDate,
    endDate,
    status,
    openingCoverageOk,
    closingCoverageOk,
    understaffedHours,
    overstaffedHours,
    breakCoverageGapViolations, // subset of understaffedHours directly caused by a scheduled break
    ftWorkingHoursViolations, // a Full-time shift where planned_hours != 8
    ftBreakViolations, // a Full-time shift missing its break, or with the wrong break duration
    ftWeeklyHourViolations, // a Full-time employee over 48 working hours in some rolling 7-day window
    consecutiveDayViolations, // a Full-time employee worked more than 6 consecutive calendar days
    ptHoursViolations, // a Part-time shift outside the 4-6 hour range
    shiftWindowViolations, // a shift starting before 09:00 or ending after 22:00
    doubleBookingViolations, // an employee with more than one shift on the same date
    employeesOverLimit,
    monthlyCapacity, // [{ monthKey, monthlyGuideline, hoursUsedOrCommitted, remainingHours, byDate }] for every month touched by the range
    plannedLaborHours: round2(totalPlannedHours),
    actualLaborHours: totalActualHours != null ? round2(totalActualHours) : null,
    actualHoursVariance,
    plannedLaborCost: round2(plannedLaborCost),
    plannedLaborCostBreakdown: { hourly: round2(hourlyCost), monthlySalaried: round2(monthlyCost) },
    actualLaborCost,
    salesBudgetTotal: hasSalesBudget ? round2(salesBudgetTotal) : null,
    salesForecastTotal: Math.round(salesForecastTotal),
    laborBudgetTotal: hasSalesBudget ? round2(laborBudgetTotal) : null,
    laborCostPercent,
    targetLaborCostPercent,
    productivity,
    targetProductivity,
    dailyBreakdown,
    warnings,
  };
}

module.exports = { validateRoster, monthlyCapFor, computeShiftCost };
