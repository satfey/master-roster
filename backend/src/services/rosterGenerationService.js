const rosterRepo = require('../repositories/rosterRepository');
const { generateHourlyForecast, computeMonthlyForecastedSales } = require('./forecastService');
const { computeLaborDemand } = require('./laborDemandService');
const { monthlyCapFor, validateRoster } = require('./rosterValidationService');
const { computeDailyLaborHoursBudget, resolveTargetProductivity } = require('./laborBudgetService');
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
  PART_TIME_BREAK_THRESHOLD_HOURS,
  PART_TIME_BREAK_HOURS,
  weeklyCapFor,
  partTimeClockSpanHours,
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
  // PART_TIME: no break unless working continuously for more than
  // PART_TIME_BREAK_THRESHOLD_HOURS (5) — the Labour Protection Act trigger is
  // consecutive working time, not a shift-length bracket, so an exactly-5h
  // shift stays break-free while anything longer gets 1h placed after the
  // first 5 worked hours (mirrors Full-time's break placement, one level up).
  if (lengthHours > PART_TIME_BREAK_THRESHOLD_HOURS) {
    const breakStartHour = startHour + PART_TIME_BREAK_THRESHOLD_HOURS;
    const breakEndHour = breakStartHour + PART_TIME_BREAK_HOURS;
    const endHour = breakEndHour + (lengthHours - PART_TIME_BREAK_THRESHOLD_HOURS);
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

  // target_productivity drives laborDemandService's maxJustifiedHeadcount — the ceiling that
  // lets a genuinely busy hour pull in extra staff. A manually-entered labor_guideline value
  // always wins; otherwise fall back to this store's own most recent REAL reported
  // productivity from WHR Target Import — its actual historical performance is a far better
  // basis for "how many people does an hour of this store's sales justify" than the
  // alternative (no guideline row at all, which every real store has today). Only overrides
  // target_productivity specifically — every other guideline field (target_col_percent,
  // min_staff_per_shift, monthly_labor_hours) is passed through untouched.
  const manualTargetProductivity = guideline?.target_productivity != null ? Number(guideline.target_productivity) : null;
  const productivityResult = await resolveTargetProductivity({ storeId, manualTargetProductivity });
  const effectiveGuideline = productivityResult.value != null ? { ...(guideline || {}), target_productivity: productivityResult.value } : guideline;

  const laborDemand = computeLaborDemand({ days: hourlyForecast.days, guideline: effectiveGuideline });
  const warnings = [...laborDemand.warnings];
  if (productivityResult.source === 'WHR_TARGET_HISTORY') {
    warnings.push(`No labor_guideline.target_productivity configured — using this store's most recent real WHR Target productivity (${productivityResult.value}, from ${productivityResult.reportMonth}) instead.`);
  }
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
  // monthly_labor_hours configured, and no sales-derived guideline either)
  // means no store-level cap is enforced.
  const storeMonthlyRemaining = {};
  const remainingHoursBeforeGeneration = {};
  // Per-month guideline hours + forecasted sales total, used below whenever a
  // given DAY has no matching daily tier (see dailyBudgetHours) — split
  // proportionally to that day's share of the month's forecasted sales, so a
  // day's budget still reflects real relative demand instead of the old
  // flat "1 person x every operating hour" floor, which mandatory opening/
  // closing coverage alone already exceeds (silently killing the hourly-
  // demand-driven extra-staffing phase further down for any store without
  // daily tier data configured — which is the common case).
  const monthlyGuidelineHoursByMonth = {};
  const monthlyForecastedSalesByMonth = {};
  for (const mk of monthsTouched) {
    const capacity = await computeMonthlyCapacity({ storeId, monthKey: mk, guideline, excludeDateRange: { start: startDate, end: endDate } });
    storeMonthlyRemaining[mk] = capacity.remainingHours;
    remainingHoursBeforeGeneration[mk] = capacity.remainingHours;
    monthlyGuidelineHoursByMonth[mk] = capacity.monthlyGuideline;
    monthlyForecastedSalesByMonth[mk] = await computeMonthlyForecastedSales({ storeId, monthKey: mk });
  }

  // --- Full-time day-off staggering ---------------------------------------
  // Every Full-time employee at a store that's structurally active every day
  // (e.g. one opens, another closes) accumulates their 48h/week cap in
  // lockstep — both reach it on the exact same date — so without an explicit
  // assignment they'd all land their one weekly rest day on that same date
  // (whichever falls 7th in the ISO week), leaving the store's busiest day
  // (often a weekend) staffed by Part-time alone. Each Full-time employee
  // instead gets a PREFERRED rest day per ISO week, staggered across the
  // group and biased toward that week's lowest-demand day first (so the
  // group's rest days land on quiet days before ever touching a busy one).
  // This is a SOFT preference only — see pickEmployee below: if genuinely no
  // one else is eligible that day, the preferred-off employee is still used
  // rather than ever leaving coverage unfilled.
  const ftEmployees = employees.filter((e) => employeeShiftType(e) === 'FULL_TIME');
  const preferredDayOffByEmployee = new Map(); // employeeId -> Set of 'YYYY-MM-DD'
  if (ftEmployees.length > 1) {
    // Only meaningful with 2+ Full-time employees — with exactly one, there's no "everyone
    // gets the same day off" collision to stagger away from, and biasing their sole rest day
    // toward a specific low-demand weekday would just be an unrequested behavior change.
    const demandByDate = new Map(laborDemand.days.map((d) => [d.date, d.hours.reduce((sum, h) => sum + h.forecastedSales, 0)]));
    const datesByWeek = new Map();
    for (const d of laborDemand.days) {
      const wk = isoWeekStart(d.date);
      if (!datesByWeek.has(wk)) datesByWeek.set(wk, []);
      datesByWeek.get(wk).push(d.date);
    }
    for (const weekDates of datesByWeek.values()) {
      // Only stagger when this ISO week is FULLY covered by the requested range (all 7 days
      // present). 6 working days already exactly equals the 48h cap with zero days off needed —
      // forcing a preferred rest day into a 6-day-or-shorter window would take away a real
      // working day nobody was ever going to be forced to give up, for a collision that can't
      // happen there in the first place (there's no visible 7th day to land everyone's day off
      // on simultaneously).
      if (weekDates.length < 7) continue;
      const sortedByDemandAsc = [...weekDates].sort((a, b) => (demandByDate.get(a) || 0) - (demandByDate.get(b) || 0));
      ftEmployees.forEach((emp, i) => {
        const preferredDate = sortedByDemandAsc[i % sortedByDemandAsc.length];
        if (!preferredDayOffByEmployee.has(emp.id)) preferredDayOffByEmployee.set(emp.id, new Set());
        preferredDayOffByEmployee.get(emp.id).add(preferredDate);
      });
    }
  }

  const assignedDay = {}; // `${employeeId}-${date}` -> true (one shift per employee per day)
  const shiftRows = []; // { employee_id, shift_date, start_time, end_time, planned_hours }
  const dailyLaborHoursBudget = [];

  for (const dayDemand of laborDemand.days) {
    const { date } = dayDemand;
    const weekStart = isoWeekStart(date);
    const mk = monthKey(date);
    // requiredHeadcount = operational minimum (sales-independent, never a target to chase upward).
    const minRequiredByHour = new Map(dayDemand.hours.map((h) => [h.hour, h.requiredHeadcount]));

    const dailyForecastValue = dayDemand.hours.reduce((sum, h) => sum + h.forecastedSales, 0);
    // The daily labor_hour_guideline_tier bracket table is no longer used to SIZE
    // scheduling — most real stores have no tier configured at all, and even a matched one is
    // a coarse, store-agnostic bracket compared to deriving today's share directly from this
    // store's own real (forecasted) monthly sales. Still looked up and reported (below) purely
    // for visibility when a store happens to have one configured — informational only now.
    const budget = await computeDailyLaborHoursBudget({ storeId, date, forecastValue: dailyForecastValue });
    if (budget.allowedLaborHours != null) dailyLaborHoursBudget.push({ date, ...budget });

    // This day's budget = this month's guideline hours x this day's share of the month's
    // forecasted sales, so it reflects real relative demand rather than a flat floor. Only
    // when there's truly nothing to go on (no monthly guideline, or zero forecasted sales for
    // the whole month) does this fall back to the bare operational-minimum curve total (never
    // the productivity-scaled one — that would reintroduce "size to the target" behavior).
    const monthlyHours = monthlyGuidelineHoursByMonth[mk];
    const monthlySales = monthlyForecastedSalesByMonth[mk];
    const dailyBudgetHours =
      monthlyHours != null && monthlySales > 0
        ? round2(monthlyHours * (dailyForecastValue / monthlySales))
        : dayDemand.hours.reduce((sum, h) => sum + h.requiredHeadcount, 0);

    // maxJustifiedHeadcount = the ceiling the generator may staff UP TO when justified,
    // never a target to reach. laborDemandService already derives this from
    // target_productivity when a store has one configured. Most stores currently don't
    // (see the "No labor guideline configured" warning) — target_productivity collapsing
    // requiredLaborHours to null means laborDemandService's own ceiling silently equals
    // the operational floor at every hour, so nothing above the bare minimum ever gets
    // added regardless of how peaky real sales are. In that case, fall back to
    // redistributing THIS DAY'S already sales-derived dailyBudgetHours across hours by
    // each hour's own share of the day's forecasted sales — the same "spread a fixed
    // pool proportional to real sales" idea already used one level up (monthly hours ->
    // this day's budget), carried one level deeper (this day's budget -> this hour's
    // ceiling), so a peak hour can still pull in extra staff purely from real hourly
    // sales shape even with no target_productivity ever entered.
    const hasProductivityGuideline = effectiveGuideline?.target_productivity != null;
    const maxJustifiedByHour = new Map(
      dayDemand.hours.map((h) => {
        if (hasProductivityGuideline || dailyForecastValue <= 0) return [h.hour, h.maxJustifiedHeadcount];
        const hourShare = h.forecastedSales / dailyForecastValue;
        const salesShapedHeadcount = Math.floor(dailyBudgetHours * hourShare);
        return [h.hour, Math.max(h.requiredHeadcount, salesShapedHeadcount)];
      })
    );

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

    /**
     * Finds the best-fit eligible employee of `type` for a `lengthHours` shift; null if none.
     * Never bypasses per-employee weekly/monthly caps (Priority 2) — only `respectStoreCap:
     * false` skips the store-level monthly check (used by coverage/minimum-staffing phases,
     * which outrank the monthly cap per Priority 3 vs. 4).
     *
     * `respectPreferredDayOff: true` (Full-time only) excludes anyone whose staggered
     * preferred rest day (see preferredDayOffByEmployee above) is today, returning null if
     * that leaves nobody — this is what actually gives a designated Full-time employee a
     * real day off: their caller (guaranteeCoverage) falls through to Part-time instead of
     * silently reassigning them to a different role the same day, which is all a same-day
     * reshuffle would achieve. Every other caller passes false (the default) — by the time
     * minimum-staffing/productivity-fill reach for Full-time at all, Part-time has already
     * been tried and failed, so that's already the genuine last resort and the day-off
     * preference no longer applies.
     */
    function pickEmployee(type, lengthHours, { respectStoreCap = true, respectPreferredDayOff = false } = {}) {
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
        .sort((a, b) => {
          if (type === 'FULL_TIME') {
            // Full-time is paid a fixed salary regardless of hours worked (within the weekly/
            // monthly caps already enforced above) — spreading hours "fairly" across multiple
            // Full-time employees costs the same but leaves each one under-utilized relative to
            // what they're already being paid for, and can force the schedule to reach for
            // (hourly-paid) Part-time hours it didn't actually need to. Concentrate hours on
            // whichever Full-time employee is already furthest into their week first, so one
            // reaches their full weekly cap before a second Full-time employee's week even starts.
            return (weeklyUsed[`${b.id}-${weekStart}`] || 0) - (weeklyUsed[`${a.id}-${weekStart}`] || 0);
          }
          // Part-time is paid hourly — fair distribution (least-used first) is the right default.
          return (monthlyUsed[`${a.id}-${mk}`] || 0) - (monthlyUsed[`${b.id}-${mk}`] || 0);
        });

      if (type === 'FULL_TIME' && respectPreferredDayOff) {
        return candidates.find((emp) => !preferredDayOffByEmployee.get(emp.id)?.has(date)) || null;
      }
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
     * Full-time is salaried and must be filled toward its 48h/week cap
     * (6 days) BEFORE Part-time is used at all — an eligible Full-time
     * employee (not yet at their weekly/daily/consecutive-day limit) wins
     * this slot, regardless of whether an 8h shift fits the day's
     * labor-hour guideline. The guideline stays a REPORTED target (see
     * budgetShortfalls below) — coverage and Full-time utilization both
     * outrank it, the same "guideline is a ceiling, never a fill target"
     * rule already applied elsewhere, now also applied to the FT/PT choice
     * itself so a tight daily budget can never silently starve a second
     * Full-time employee down to Part-time hours.
     *
     * The one exception: a Full-time employee on their staggered preferred
     * rest day today (see preferredDayOffByEmployee) is skipped in favor of
     * Part-time here — without this, when a store needs 2+ concurrent
     * Full-time-eligible roles a day (e.g. opener + closer) and has exactly
     * that many Full-time employees, "skip me today" for one role just
     * reassigns them to the OTHER role instead of actually giving them the
     * day off, since they're still the only remaining candidate for it —
     * every Full-time employee ends up working every single day regardless,
     * hitting their 48h cap in lockstep and landing everyone's one real day
     * off on the same date. Only once BOTH a non-preferred-off Full-time
     * employee AND Part-time are unavailable does this fall back to using
     * the preferred-off Full-time employee anyway — coverage is still never
     * silently dropped just to honor the stagger.
     */
    function guaranteeCoverage({ isOpening, dailyBudgetRemaining }) {
      const ftStart = isOpening ? OPERATING_HOURS.start : OPERATING_HOURS.end - FULL_TIME_CLOCK_SPAN_HOURS;
      const ptLength = clampPartTimeHours(Math.max(dailyBudgetRemaining, PART_TIME_MIN_HOURS));
      // Closing must position the shift so it ENDS exactly at closing time — when ptLength
      // exceeds the 5-hour break threshold, buildShiftRow adds a 1h break that extends the
      // clock span beyond ptLength, so the start has to move back an extra hour to compensate.
      const ptStart = isOpening ? OPERATING_HOURS.start : OPERATING_HOURS.end - partTimeClockSpanHours(ptLength);

      const ftRow = place('FULL_TIME', ftStart, FULL_TIME_SHIFT_HOURS, { respectStoreCap: false, respectPreferredDayOff: true });
      if (ftRow) return ftRow;

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
      // Same clock-span correction as guaranteeCoverage above — a >5h Part-time shift's break
      // pushes its end 1h later than ptLength alone would suggest, so keep it inside operating hours.
      const ptStart = Math.min(Math.max(targetHour, OPERATING_HOURS.start), OPERATING_HOURS.end - partTimeClockSpanHours(ptLength));
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
