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
  validBreakOffsets,
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

function ceilingAt(hour, maxJustifiedByHour, minRequiredByHour) {
  return Math.max(maxJustifiedByHour.get(hour) ?? 0, minRequiredByHour.get(hour) ?? 1);
}

/**
 * Sizes a Part-time shift anchored at one edge of the operating day (opening or closing) to
 * exactly the hours real demand still justifies, instead of always maxing out to whatever the
 * daily budget affords (the previous `clampPartTimeHours(max(dailyBudgetRemaining, MIN))` always
 * evaluated to 8h for any real store, forcing every PT closer to the identical 13:00 start).
 * Grows hour-by-hour away from the edge (forward from opening, backward from closing) only while
 * the next hour still has unmet room under its own ceiling (the higher of the operational minimum
 * and the productivity-justified maximum) — stops the moment it would only pad an
 * already-adequately-covered hour, never below the legal PART_TIME_MIN_HOURS floor. `maxHours`
 * (derived by the caller from the remaining daily labor-hour budget, clamped to
 * PART_TIME_MAX_HOURS) is an upper CAP only, never the target — real stores' daily budgets are
 * almost always >= 8h so this cap rarely binds and demand governs the result; a test or a
 * genuinely tight-budget day can still legitimately shrink it below what demand alone would ask
 * for. This is what lets closing shifts genuinely vary in length (13-22, 16-22, 18-22, ...) based
 * on the real hourly curve instead of every closer defaulting to 13:00-22:00.
 */
function growPartTimeFromEdge({ direction, maxJustifiedByHour, minRequiredByHour, coverageByHour, maxHours = PART_TIME_MAX_HOURS }) {
  const step = direction === 'forward' ? 1 : -1;
  let h = direction === 'forward' ? OPERATING_HOURS.start : OPERATING_HOURS.end - 1;
  let length = 0;
  while (length < maxHours && h >= OPERATING_HOURS.start && h < OPERATING_HOURS.end) {
    const stillNeeded = (coverageByHour[h] || 0) < ceilingAt(h, maxJustifiedByHour, minRequiredByHour);
    if (length >= PART_TIME_MIN_HOURS && !stillNeeded) break;
    length++;
    h += step;
  }
  return clampPartTimeHours(length);
}

/**
 * Sizes and positions a Part-time fill shift around a single `targetHour` known to need more
 * coverage under `ceilingFn`, extending in whichever direction still has genuine unmet room
 * rather than always maxing out to `maxHours` — the minimum-staffing and productivity-fill phases
 * both use this (with different `ceilingFn`s) so a single-hour shortfall no longer drags in a
 * full 4-8h block that pads hours already at, or above, their own ceiling.
 */
function growPartTimeWindow({ targetHour, ceilingFn, coverageByHour, maxHours }) {
  let start = targetHour;
  let end = targetHour + 1;
  let length = 1;
  while (length < maxHours) {
    const canRight = end < OPERATING_HOURS.end && (coverageByHour[end] || 0) < ceilingFn(end);
    const canLeft = start - 1 >= OPERATING_HOURS.start && (coverageByHour[start - 1] || 0) < ceilingFn(start - 1);
    if (length >= PART_TIME_MIN_HOURS && !canRight && !canLeft) break;
    if (!canRight && !canLeft) {
      // Legal minimum not yet reached and neither neighbor has genuine room under ceilingFn —
      // still must extend somewhere to meet PART_TIME_MIN_HOURS; forward (toward closing) is the
      // safer default since it never risks pushing the window's start before OPERATING_HOURS.start.
      if (end < OPERATING_HOURS.end) end++;
      else start--;
    } else {
      const rightGap = canRight ? ceilingFn(end) - (coverageByHour[end] || 0) : -1;
      const leftGap = canLeft ? ceilingFn(start - 1) - (coverageByHour[start - 1] || 0) : -1;
      if (rightGap >= leftGap) end++;
      else start--;
    }
    length++;
  }
  return { start, length: clampPartTimeHours(length) };
}

function pad(hour) {
  return String(hour).padStart(2, '0');
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * `lengthHours` is always WORKING hours (matches planned_hours). `breakStartHour` is decided by
 * the CALLER (see chooseBreakStartHour below) — this function only lays out the resulting shift
 * row, never picks the break's position itself. Pass `breakStartHour: null` for a shift with no
 * break at all (a Part-time shift of PART_TIME_BREAK_THRESHOLD_HOURS or fewer continuous hours).
 * Clock span is always `lengthHours + (1 if a break) : 0` — moving the break WITHIN the shift
 * never changes total working hours or the shift's overall start/end time, only which hour in
 * the middle is unpaid.
 */
function buildShiftRow({ employeeId, date, startHour, lengthHours, type, breakStartHour }) {
  if (breakStartHour == null) {
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
  const breakHours = type === 'FULL_TIME' ? FULL_TIME_BREAK_HOURS : PART_TIME_BREAK_HOURS; // both 1h — kept type-specific for clarity, not because the values differ
  const breakEndHour = breakStartHour + breakHours;
  const endHour = startHour + lengthHours + breakHours;
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

/**
 * Decides WHERE (not whether) a shift's break falls, among every legally valid offset
 * (validBreakOffsets — every split keeping both segments <= 5 consecutive hours). Returns null
 * when no break applies at all (a short Part-time shift). Priority order, matching the business
 * objective hierarchy (never "different times" for its own sake):
 *   1. legal window only (validBreakOffsets — hard filter, nothing outside it is ever returned)
 *   2. minimum required coverage — prefer a candidate hour where coverage-so-far already meets
 *      minRequiredByHour, i.e. this break doesn't (worsen) a shortfall
 *   3. real hourly sales — among coverage-safe candidates, prefer the LOWER-demand hour, so a
 *      break never lands on a busier hour than another legal option would have avoided
 *   4. staggering — only as a final tiebreak among sales-tied candidates (e.g. flat demand),
 *      prefer the hour fewest OTHER employees already have a break at today
 * `coverageByHour`/`breaksTakenTodayByHour` reflect only shifts already placed earlier this same
 * day — this employee's own presence never counts at their own candidate break hour (they're not
 * working it, whichever offset is chosen), so no extra bookkeeping is needed for "this shift".
 */
function chooseBreakStartHour({ startHour, lengthHours, dayDemand, minRequiredByHour, coverageByHour, breaksTakenTodayByHour }) {
  const salesByHour = new Map(dayDemand.hours.map((h) => [h.hour, h.forecastedSales]));
  const offsets = validBreakOffsets(lengthHours);
  const centerOffset = (offsets[0] + offsets[offsets.length - 1]) / 2;
  let best = null;
  for (const k of offsets) {
    const hour = startHour + k;
    const coverage = coverageByHour[hour] || 0;
    const gap = Math.max(0, (minRequiredByHour.get(hour) ?? 1) - coverage);
    const sales = salesByHour.get(hour) ?? 0;
    const simultaneousBreaks = breaksTakenTodayByHour[hour] || 0;
    const distanceFromCenter = Math.abs(k - centerOffset);
    const candidate = { hour, gap, sales, simultaneousBreaks, distanceFromCenter };
    if (
      best == null ||
      candidate.gap < best.gap ||
      (candidate.gap === best.gap && candidate.sales < best.sales) ||
      (candidate.gap === best.gap && candidate.sales === best.sales && candidate.simultaneousBreaks < best.simultaneousBreaks) ||
      // Final tiebreak when nothing above distinguishes the candidates at all (e.g. flat demand,
      // first shift placed that day): prefer the most balanced/central split — the same "no more
      // than 5 consecutive hours on either side, as evenly as reasonable" instinct the old fixed
      // start+4 offset already reflected, so a shift with no reason to prefer any particular hour
      // still lands on a sensible default rather than an arbitrary edge of the legal window.
      (candidate.gap === best.gap &&
        candidate.sales === best.sales &&
        candidate.simultaneousBreaks === best.simultaneousBreaks &&
        candidate.distanceFromCenter < best.distanceFromCenter)
    ) {
      best = candidate;
    }
  }
  return best.hour;
}

/**
 * Generates (or regenerates) a DRAFT roster for a store over a date range
 * from the sales forecast and Sales/Budget -> Labor Hours guideline.
 * Never sets status beyond DRAFT; approval/publish is a separate,
 * human-triggered step.
 *
 * Objective hierarchy (each level below overrides everything after it):
 *   1. Legal / hard operational constraints — Full-time's mandatory break and
 *      6-consecutive-day rest rule, Part-time's break-after-5-hours rule, and
 *      every employee's weekly/monthly hour cap (all enforced inside
 *      pickEmployee's eligibility filter below — never bypassed by anything).
 *   2. Minimum required coverage — opening (09:00), closing (2 employees
 *      ending exactly at close), and the sales-independent per-hour
 *      operational floor (guaranteeCoverage / "mandatory minimum staffing").
 *   3. Daily-sales-based Full-time day-off optimization — see "Full-time
 *      day-off staggering" below: WHICH day each Full-time employee's
 *      preferred rest day falls on is chosen from real forecasted daily
 *      sales (lowest-demand days first), never an arbitrary/even rotation.
 *      Staggering is the MECHANISM this uses, not the goal in itself.
 *   4. Hourly-sales-based shift placement — the "productivity-justified
 *      extra staffing" fill phase targets whichever operating HOUR real
 *      forecasted sales most justify extra coverage for first (maxJustifiedByHour),
 *      concentrating discretionary manpower on genuinely busy hours.
 *   5. Productivity / labor-hour efficiency — target_productivity caps how
 *      far level 4 may go (never a target staffing must reach), and every
 *      phase minimizes hours actually used rather than padding toward any
 *      guideline.
 *   6. Part-time is only ever reached as supplemental coverage once
 *      Full-time + the levels above genuinely aren't enough (see
 *      guaranteeCoverage's Full-time-first order, and PART_TIME_MIN_HOURS
 *      blocks used only to backfill an actual remaining gap).
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
    //
    // Chunked by the REQUESTED RANGE's own 7-day cycles (day 1-7, 8-14, ...), not by ISO
    // week (Monday-Sunday) — the thing that actually forces everyone's hand on the same date
    // is FULL_TIME_MAX_CONSECUTIVE_DAYS (a calendar-day streak, tracked independently of any
    // week boundary): a group of Full-time employees who all start working on the same date
    // all hit their 6th consecutive day, and get blocked from a 7th, on the exact same date —
    // regardless of whether that date happens to be a Sunday. Tying this to ISO weeks instead
    // meant staggering only ever engaged for a range that happened to start on a Monday and
    // run exactly 7/14/21... days; any other range (e.g. "the next 7 days" starting today)
    // silently skipped every partial week and every employee converged on the same day off.
    const demandByDate = new Map(laborDemand.days.map((d) => [d.date, d.hours.reduce((sum, h) => sum + h.forecastedSales, 0)]));
    const allDates = laborDemand.days.map((d) => d.date);
    for (let chunkStart = 0; chunkStart + 7 <= allDates.length; chunkStart += 7) {
      const chunkDates = allDates.slice(chunkStart, chunkStart + 7);
      const sortedByDemandAsc = [...chunkDates].sort((a, b) => (demandByDate.get(a) || 0) - (demandByDate.get(b) || 0));
      ftEmployees.forEach((emp, i) => {
        const preferredDate = sortedByDemandAsc[i % sortedByDemandAsc.length];
        if (!preferredDayOffByEmployee.has(emp.id)) preferredDayOffByEmployee.set(emp.id, new Set());
        preferredDayOffByEmployee.get(emp.id).add(preferredDate);
      });
    }
    // A trailing chunk shorter than 7 days (e.g. 3 leftover days) can never force a 7th
    // consecutive day within the requested range by itself, so it's left unstaggered — same
    // reasoning as before, just applied to the range's own remainder instead of an ISO week's.
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
    // never a target to reach. Two INDEPENDENT real-sales-derived ceilings exist and can
    // disagree sharply:
    //   1. laborDemandService's own per-hour ceiling, derived from target_productivity (a
    //      manual override, or — for virtually every real store now — this store's own
    //      historical productivity from WHR Target Import).
    //   2. THIS DAY'S already sales-derived dailyBudgetHours (itself the monthly guideline's
    //      share of this day's forecast), redistributed across hours by each hour's own share
    //      of the day's forecasted sales — the same "spread a fixed pool proportional to real
    //      sales" idea already used one level up (monthly hours -> this day's budget), carried
    //      one level deeper (this day's budget -> this hour's ceiling).
    // Letting whichever happens to be stricter silently win means a store with a naturally
    // high historical productivity figure can end up far below its own monthly guideline even
    // on a genuinely busy day, despite BOTH ceilings being legitimate, real-sales-based signals
    // — confirmed against real data for store 1001 (target_productivity capped every day's peak
    // hour at 2-3 heads regardless of demand, leaving ~400h/month of guideline unused that the
    // sales-bracket table itself would have allowed). Taking the MORE PERMISSIVE of the two
    // never invents a number and never pads beyond what either real-sales signal already
    // justifies — it just stops one from overriding the other.
    const maxJustifiedByHour = new Map(
      dayDemand.hours.map((h) => {
        if (dailyForecastValue <= 0) return [h.hour, h.maxJustifiedHeadcount];
        const hourShare = h.forecastedSales / dailyForecastValue;
        const salesShapedHeadcount = Math.floor(dailyBudgetHours * hourShare);
        return [h.hour, Math.max(h.requiredHeadcount, h.maxJustifiedHeadcount, salesShapedHeadcount)];
      })
    );

    const coverageByHour = {};
    const breaksTakenTodayByHour = {}; // hour -> count of shifts already placed today whose break lands there — staggering tiebreak for chooseBreakStartHour
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
      // A break applies to every Full-time shift (always exactly 8h) and to a Part-time shift
      // only when it exceeds PART_TIME_BREAK_THRESHOLD_HOURS — chooseBreakStartHour picks WHERE
      // among the legally valid offsets, never whether one applies at all.
      const needsBreak = type === 'FULL_TIME' || lengthHours > PART_TIME_BREAK_THRESHOLD_HOURS;
      const breakStartHour = needsBreak
        ? chooseBreakStartHour({ startHour, lengthHours, dayDemand, minRequiredByHour, coverageByHour, breaksTakenTodayByHour })
        : null;
      const row = buildShiftRow({ employeeId: emp.id, date, startHour, lengthHours, type, breakStartHour });
      shiftRows.push(row);
      assignedDay[`${emp.id}-${date}`] = true;
      weeklyUsed[`${emp.id}-${weekStart}`] = (weeklyUsed[`${emp.id}-${weekStart}`] || 0) + lengthHours;
      monthlyUsed[`${emp.id}-${mk}`] = (monthlyUsed[`${emp.id}-${mk}`] || 0) + lengthHours;
      if (storeMonthlyRemaining[mk] != null) storeMonthlyRemaining[mk] -= lengthHours;
      if (!workedDatesByEmployee.has(emp.id)) workedDatesByEmployee.set(emp.id, new Set());
      workedDatesByEmployee.get(emp.id).add(date);

      // Coverage excludes the break hour — the employee isn't floor coverage while on break (any gap this creates is backfilled by the minimum-staffing phase below, same as any other coverage gap).
      const endHour = Number(row.end_time.slice(0, 2));
      for (let h = startHour; h < endHour; h++) {
        if (h === breakStartHour) continue;
        coverageByHour[h] = (coverageByHour[h] || 0) + 1;
      }
      if (breakStartHour != null) breaksTakenTodayByHour[breakStartHour] = (breaksTakenTodayByHour[breakStartHour] || 0) + 1;
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
     *
     * PT's length here is demand-fitted (growPartTimeFromEdge), never SIZED FROM the daily
     * labor-hour budget the way it used to be — the previous `clampPartTimeHours(max(
     * dailyBudgetRemaining, MIN))` always evaluated to 8h for any real store (whose daily budget
     * almost always exceeds 8h), forcing every PT closer to max out and start at the identical
     * 13:00, which is the root cause of "everyone stays until closing" (real Store 1001 data: 3
     * separate PT employees all landed on 13:00-22:00). `dailyBudgetRemaining` is still passed
     * through as an upper CAP only (never a target) — it only actually binds on a day whose
     * budget is tighter than 8h; growing from the edge by real hourly demand is what lets
     * shorter, later-starting closers (16-22, 18-22, ...) emerge whenever the earlier afternoon
     * hours are already adequately covered by other shifts.
     */
    function guaranteeCoverage({ isOpening, dailyBudgetRemaining }) {
      const ftStart = isOpening ? OPERATING_HOURS.start : OPERATING_HOURS.end - FULL_TIME_CLOCK_SPAN_HOURS;
      const ptLength = growPartTimeFromEdge({
        direction: isOpening ? 'forward' : 'backward',
        maxJustifiedByHour,
        minRequiredByHour,
        coverageByHour,
        maxHours: clampPartTimeHours(dailyBudgetRemaining),
      });
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
    // bypassed. The legal PART_TIME_MIN_HOURS floor still applies (a 1-hour
    // shortfall can never be filled by less than a 4h Part-time shift), but
    // growPartTimeWindow positions and, if the ceiling genuinely extends
    // further, sizes that block against minRequiredByHour ONLY (never the
    // productivity ceiling — this phase's job is just reaching the
    // operational minimum) so the mandatory extra 3-4h a legal minimum shift
    // requires lands on genuinely still-understaffed neighboring hours
    // rather than being padded arbitrarily forward past closing. Only falls
    // back to Full-time if no Part-time employee is eligible.
    for (const hour of operatingHourList()) {
      while ((coverageByHour[hour] || 0) < (minRequiredByHour.get(hour) ?? 1)) {
        const window = growPartTimeWindow({
          targetHour: hour,
          ceilingFn: (h) => minRequiredByHour.get(h) ?? 1,
          coverageByHour,
          maxHours: PART_TIME_MAX_HOURS,
        });
        let placed = place('PART_TIME', window.start, window.length, { respectStoreCap: false });
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

      // Grows from targetHour only into neighboring hours that ALSO still have room under
      // maxJustifiedByHour, instead of always maxing out to remainingDailyBudget/8h — this is
      // what stops a single busy hour's gap from mechanically dragging in a full 8h shift that
      // spans several already-adequately-covered hours (the "flat 4-5 people through closing"
      // pattern seen in real data).
      const window = growPartTimeWindow({
        targetHour,
        ceilingFn: (h) => maxJustifiedByHour.get(h) ?? 1,
        coverageByHour,
        maxHours: Math.min(PART_TIME_MAX_HOURS, Math.floor(remainingDailyBudget)),
      });
      let placed = place('PART_TIME', window.start, window.length, { respectStoreCap: true });

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
