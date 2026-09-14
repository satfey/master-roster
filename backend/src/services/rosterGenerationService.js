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

/**
 * Sizes a Part-time shift anchored at one edge of the operating day (opening or closing).
 *
 * This is a COVERAGE shift: its job is to make sure the store is open and closed legally, not to
 * staff up for sales. So it grows only while the next hour is still below its OPERATIONAL MINIMUM
 * (`minRequiredByHour`), and stops as soon as the legal PART_TIME_MIN_HOURS floor is met and no
 * further hour is actually short-handed.
 *
 * It deliberately does NOT grow against the productivity ceiling (`maxJustifiedByHour`). It used
 * to, and that is what made every Part-timer a full 8-hour shift: this phase runs first, when
 * coverage is still 0 everywhere, so "is this hour below the sales-justified ceiling?" is true for
 * almost the whole day and the shift swallowed all of it. A store whose sales justify 2-3 people
 * ended up with 4-5 on the floor from mid-afternoon on. Staffing ABOVE the minimum is the
 * productivity-fill phase's job (Priority 6/7 below), which runs later, sees real coverage, and
 * stops exactly at maxJustifiedHeadcount — so Part-timers are now brought in to top up the hours
 * that genuinely need more people, instead of being padded out to a full quota every day.
 *
 * `maxHours` (derived by the caller from the remaining daily labor-hour budget, clamped to
 * PART_TIME_MAX_HOURS) stays an upper CAP only, never the target.
 */
function growPartTimeFromEdge({ direction, minRequiredByHour, coverageByHour, maxHours = PART_TIME_MAX_HOURS }) {
  const step = direction === 'forward' ? 1 : -1;
  let h = direction === 'forward' ? OPERATING_HOURS.start : OPERATING_HOURS.end - 1;
  let length = 0;
  while (length < maxHours && h >= OPERATING_HOURS.start && h < OPERATING_HOURS.end) {
    const stillShortHanded = (coverageByHour[h] || 0) < (minRequiredByHour.get(h) ?? 1);
    if (length >= PART_TIME_MIN_HOURS && !stillShortHanded) break;
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
  const hasRoom = (h) =>
    h >= OPERATING_HOURS.start && h < OPERATING_HOURS.end && (coverageByHour[h] || 0) < ceilingFn(h);

  /**
   * The clock hour a shift of `len` working hours starting at `s` runs up to (exclusive).
   *
   * A block longer than PART_TIME_BREAK_THRESHOLD_HOURS gains an unpaid break hour, so it ends
   * LATER than its working length — and the employee is on the floor either side of that break.
   * Growing by working hours alone therefore silently claimed clock hours this function had never
   * checked for room: a 6-hour fill block starting at 15:00 ran to 22:00, not 21:00, landing on
   * the closing hour that already had its two mandatory closers and justified only one person.
   * Crossing the threshold (5 -> 6 working hours) widens the span by TWO clock hours at once, so
   * the check has to be on the resulting span, never on a single next-door hour.
   */
  const spanEnd = (s, len) => s + partTimeClockSpanHours(len);

  /** Every clock hour a candidate block would newly occupy, versus the block as it stands. */
  const newlyOccupied = (nextStart, nextLen, start, length) => {
    const hours = [];
    for (let h = nextStart; h < spanEnd(nextStart, nextLen); h++) {
      if (h < start || h >= spanEnd(start, length)) hours.push(h);
    }
    return hours;
  };

  const fits = (nextStart, nextLen, start, length) =>
    nextStart >= OPERATING_HOURS.start &&
    spanEnd(nextStart, nextLen) <= OPERATING_HOURS.end &&
    newlyOccupied(nextStart, nextLen, start, length).every(hasRoom);

  let start = targetHour;
  let length = 1;
  while (length < maxHours) {
    const nextLen = length + 1;
    const canRight = fits(start, nextLen, start, length);
    const canLeft = fits(start - 1, nextLen, start, length);

    if (length >= PART_TIME_MIN_HOURS && !canRight && !canLeft) break;

    if (!canRight && !canLeft) {
      // Legal minimum not yet reached and neither direction has genuine room — the shift must
      // still reach PART_TIME_MIN_HOURS, so extend anyway, preferring whichever direction stays
      // inside operating hours. This is the one case where a block may cover an hour that is
      // already at its ceiling: a 4-hour legal floor cannot be avoided.
      if (spanEnd(start, nextLen) <= OPERATING_HOURS.end) length = nextLen;
      else if (start - 1 >= OPERATING_HOURS.start) {
        start -= 1;
        length = nextLen;
      } else break; // nowhere left to grow inside the operating day
      continue;
    }

    const rightGap = canRight ? ceilingFn(spanEnd(start, nextLen) - 1) - (coverageByHour[spanEnd(start, nextLen) - 1] || 0) : -1;
    const leftGap = canLeft ? ceilingFn(start - 1) - (coverageByHour[start - 1] || 0) : -1;
    if (canRight && rightGap >= leftGap) {
      length = nextLen;
    } else {
      start -= 1;
      length = nextLen;
    }
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
 * Where to start a discretionary Full-time shift so its 8 working hours land on the hours that
 * most need people.
 *
 * The fill phases used to compute `clamp(targetHour - 4)` — a fixed offset that ignores the rest
 * of the curve, so an 8h shift pulled in for a 19:00 peak started at 15:00 and spent its first
 * hours on already-covered afternoon hours while the evening stayed short. Here every legal start
 * (one that keeps the whole 9-hour clock span inside operating hours) is scored by the unmet
 * demand its WORKING hours would actually absorb, capped per hour at the real remaining gap so
 * over-covering one hour can never look better than covering two.
 *
 * The break hour is excluded from the score: the employee is not on the floor then, which is
 * precisely the assumption the coverage tally makes when the shift is placed.
 */
function chooseFullTimeStartHour({ targetHour, ceilingByHour, coverageByHour }) {
  const latestStart = OPERATING_HOURS.end - FULL_TIME_CLOCK_SPAN_HOURS;
  let best = null;

  for (let start = OPERATING_HOURS.start; start <= latestStart; start++) {
    const breakHour = start + Math.round((validBreakOffsets(FULL_TIME_SHIFT_HOURS)[0] + validBreakOffsets(FULL_TIME_SHIFT_HOURS).slice(-1)[0]) / 2);
    let score = 0;
    let coversTarget = false;
    for (let h = start; h < start + FULL_TIME_CLOCK_SPAN_HOURS; h++) {
      if (h === breakHour) continue;
      if (h === targetHour) coversTarget = true;
      score += Math.max(0, (ceilingByHour.get(h) ?? 1) - (coverageByHour[h] || 0));
    }
    const candidate = { start, score, coversTarget };
    if (
      best == null ||
      candidate.score > best.score ||
      // An equal-scoring placement that actually spans the hour this fill was triggered for is
      // the better one — it is the hour the caller already proved needs somebody.
      (candidate.score === best.score && candidate.coversTarget && !best.coversTarget)
    ) {
      best = candidate;
    }
  }

  return { start: best.start, score: best.score };
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
 * Two forecasts are "similar enough" that sales should stop deciding between them, and the
 * existing balancing rule takes over. 2% is deliberately tight: a genuinely quieter day must win
 * on sales alone, and only near-identical days fall through to balancing.
 */
const SIMILAR_DEMAND_TOLERANCE = 0.02;

/**
 * How much busier than the quietest AVAILABLE weekday a Saturday or Sunday has to be before it is
 * pushed into the protected tier and effectively taken off the table. 5% rather than 0, so a
 * weekend day that is genuinely as quiet as the weekdays stays an ordinary candidate — the rule is
 * "protect a BUSY weekend", never "a weekend can never be a rest day".
 */
const WEEKEND_PROTECTION_MARGIN = 0.05;

const WEEKEND_DAYS = new Set([0, 6]); // Sunday, Saturday

function isWeekendDate(date) {
  return WEEKEND_DAYS.has(new Date(`${date}T00:00:00Z`).getUTCDay());
}

/**
 * Whether this employee is a Store Manager / Team Lead, read from the existing employee.position
 * metadata — never a name, never a hardcoded id. The real values in this data set are exactly
 * 'Store Manager' (292 employees), 'Service Staff' (184) and 'Team Lead' (11); 'supervisor' is
 * matched too so a future title does not silently fall through to the non-manager path.
 */
function isManagerRole(employee) {
  return /manager|team\s*lead|supervisor/i.test(employee.position || '');
}

/**
 * Chooses each employee's preferred weekly rest date from the real forecast.
 *
 * WHAT WAS WRONG ORIGINALLY. Rest days were handed out by round-robin: the week's dates were
 * sorted by forecast ascending and employee `i` took index `i % 7`. That walks UP the sales
 * ranking, so a six-Full-timer store deliberately rested people on its 5th- and 6th-quietest days.
 * Measured against the real forecast for the week of 2026-09-21 across ten stores, it put a
 * Full-timer's rest day on a Sunday whose demand ranked 3rd of 7 — with four lower-demand weekdays
 * sitting available.
 *
 * THE SELECTION IS NOW LEXICOGRAPHIC, in the business's own priority order:
 *
 *   1. HARD CONSTRAINTS — not decided here. Weekly/monthly hour caps and the 6-consecutive-day
 *      rule live in pickEmployee's eligibility filter, which this can never override: what this
 *      function produces is a PREFERENCE, and coverage always wins over it.
 *   2. AVOID A HIGH-DEMAND WEEKEND — a Saturday or Sunday more than WEEKEND_PROTECTION_MARGIN
 *      busier than the quietest available weekday is pushed into a protected tier, and no
 *      protected day is chosen while an unprotected one still has room. This is a TIER rather than
 *      a weight precisely so no sales difference, however small, can buy its way past it.
 *   3/4. AVOID A HIGH-DEMAND DAY IN GENERAL / PREFER LOWER SALES — within a tier, quieter first.
 *   5. PRESERVE COVERAGE — capacity(date) = groupSize - workersNeeded(date), taken from the
 *      production manpower rule already computed for this run (the peak sales-independent
 *      requiredHeadcount across that day's hours, or CLOSING_COVERAGE_STAFF_COUNT, whichever is
 *      larger). Rest fills the quietest day up to that, and only then moves on.
 *   6. FAIRNESS LAST — only days within SIMILAR_DEMAND_TOLERANCE of each other count as tied, and
 *      only then does balancing (fewest rests so far, then earliest date) decide. Fairness can
 *      never overrule sales protection.
 *
 * Managers and Team Leads are served FIRST, so they claim the quietest rest days and are
 * consequently on the floor for the busy ones. Their role comes from employee.position.
 *
 * Chunked by the REQUESTED RANGE's own 7-day cycles, not by ISO week: what forces everyone's hand
 * onto the same date is FULL_TIME_MAX_CONSECUTIVE_DAYS, a calendar streak independent of any week
 * boundary. A trailing chunk shorter than 7 days cannot force a 7th consecutive working day within
 * the range on its own, so it is left unassigned.
 *
 * `warnings` collects the one case the business asked to be told about explicitly: a weekend rest
 * day taken anyway because every weekday alternative was already at capacity.
 *
 * Returns Map<employeeId, Set<'YYYY-MM-DD'>>. Pure apart from appending to `warnings`.
 */
function chooseDayOffDates({ group, laborDemandDays, warnings = [] }) {
  const preferred = new Map();
  if (group.length === 0 || laborDemandDays.length < 7) return preferred;

  const demandByDate = new Map(laborDemandDays.map((d) => [d.date, d.hours.reduce((sum, h) => sum + h.forecastedSales, 0)]));
  const workersNeededByDate = new Map(
    laborDemandDays.map((d) => [d.date, Math.max(CLOSING_COVERAGE_STAFF_COUNT, ...d.hours.map((h) => h.requiredHeadcount))])
  );
  const allDates = laborDemandDays.map((d) => d.date);

  // Managers and Team Leads choose first; relative order is otherwise preserved.
  const ordered = [...group].sort((a, b) => (isManagerRole(b) ? 1 : 0) - (isManagerRole(a) ? 1 : 0));

  for (let chunkStart = 0; chunkStart + 7 <= allDates.length; chunkStart += 7) {
    const chunkDates = allDates.slice(chunkStart, chunkStart + 7);
    const capacity = new Map(
      chunkDates.map((d) => [d, Math.max(1, group.length - (workersNeededByDate.get(d) ?? CLOSING_COVERAGE_STAFF_COUNT))])
    );
    const restsAssigned = new Map(chunkDates.map((d) => [d, 0]));

    // The bar a weekend day must beat: the quietest weekday in this chunk. If the chunk contains
    // no weekday at all, nothing is protected — there would be no alternative to protect it for.
    const weekdayDemands = chunkDates.filter((d) => !isWeekendDate(d)).map((d) => demandByDate.get(d) || 0);
    const quietestWeekday = weekdayDemands.length ? Math.min(...weekdayDemands) : null;
    const isProtectedWeekend = (date) =>
      isWeekendDate(date) &&
      quietestWeekday !== null &&
      (demandByDate.get(date) || 0) > quietestWeekday * (1 + WEEKEND_PROTECTION_MARGIN);

    const rank = (date) => ({ tier: isProtectedWeekend(date) ? 1 : 0, demand: demandByDate.get(date) || 0 });

    for (const emp of ordered) {
      const hasRoom = (d) => restsAssigned.get(d) < capacity.get(d);
      const unprotected = chunkDates.filter((d) => !isProtectedWeekend(d));

      // Priority 2 (avoid a high-demand weekend) outranks Priority 5 (preserve coverage), so the
      // candidate pool is built in that order:
      //   a. an unprotected day that still has rest capacity — the normal case;
      //   b. failing that, an unprotected day OVER its capacity. Capacity is a soft coverage
      //      heuristic, not a hard constraint: exceeding it only risks the rest day not actually
      //      materialising, because pickEmployee pulls a resting employee back in whenever
      //      coverage needs them. Resting someone on the busiest day of the week instead would be
      //      a real business loss. Without this step, once all five weekdays hit capacity the
      //      pool fell through to Saturday and Sunday — measured: FT=8 with requiredHeadcount=10
      //      put one rest day on a 32,000 Saturday and another on a 35,000 Sunday while Thursday
      //      (14,000) could have absorbed both;
      //   c. only if the cycle contains no unprotected day at all does a protected weekend day
      //      become a candidate, and that is reported below.
      let pool;
      if (unprotected.some(hasRoom)) pool = unprotected.filter(hasRoom);
      else if (unprotected.length) pool = unprotected;
      else pool = chunkDates.filter(hasRoom).length ? chunkDates.filter(hasRoom) : chunkDates;

      const sorted = [...pool].sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        return ra.tier - rb.tier || ra.demand - rb.demand;
      });

      const best = rank(sorted[0]);
      const tied = sorted.filter((d) => {
        const r = rank(d);
        if (r.tier !== best.tier) return false;
        if (best.demand === 0) return r.demand === 0;
        return (r.demand - best.demand) / best.demand <= SIMILAR_DEMAND_TOLERANCE;
      });
      tied.sort((a, b) => restsAssigned.get(a) - restsAssigned.get(b) || (a < b ? -1 : 1));
      const chosen = tied[0];

      if (isProtectedWeekend(chosen)) {
        warnings.push(
          `${chosen}: rest day assigned to employee ${emp.id} on a high-demand weekend day (forecast ${Math.round(demandByDate.get(chosen)).toLocaleString()}) because every weekday alternative in this 7-day cycle was already at rest capacity.`
        );
      }

      restsAssigned.set(chosen, restsAssigned.get(chosen) + 1);
      if (!preferred.has(emp.id)) preferred.set(emp.id, new Set());
      preferred.get(emp.id).add(chosen);
    }
  }

  return preferred;
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

  // --- Sales-driven rest-day selection ------------------------------------
  // Every employee at a store that's structurally active every day accumulates their weekly hour
  // cap in lockstep, so without an explicit assignment they'd all land their one weekly rest day
  // on the same date — leaving the store's busiest day short-staffed. Each employee instead gets a
  // PREFERRED rest date per 7-day cycle, chosen from the REAL forecast (chooseDayOffDates below).
  //
  // This is a SOFT preference — see pickEmployee: if genuinely nobody else is eligible, the
  // resting employee is still used rather than ever leaving coverage unfilled.
  //
  // Applied to Part-time as well as Full-time. It used to run for Full-time only, which meant a
  // store staffed mostly by Part-timers got no demand-aware rest days at all: everyone worked
  // every quiet weekday, and the week's BUSIEST day was the one nobody had capacity left for.
  const preferredDayOffByEmployee = new Map(); // employeeId -> Set of 'YYYY-MM-DD'
  for (const group of [
    employees.filter((e) => employeeShiftType(e) === 'FULL_TIME'),
    employees.filter((e) => employeeShiftType(e) === 'PART_TIME'),
  ]) {
    for (const [employeeId, dates] of chooseDayOffDates({ group, laborDemandDays: laborDemand.days, warnings })) {
      preferredDayOffByEmployee.set(employeeId, dates);
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
    // The hour-by-hour forecast itself, used to break ties toward the busier hour when two hours
    // are equally short-handed. Straight from the production forecast — nothing recomputed here.
    const salesByHour = new Map(dayDemand.hours.map((h) => [h.hour, h.forecastedSales]));

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

    // maxJustifiedHeadcount = the ceiling the generator may staff UP TO when justified, never a
    // target to reach. Two real-sales-derived signals exist:
    //   1. the PRODUCTIVITY ceiling for the hour — floor(that hour's forecast sales /
    //      target_productivity), floored at the operational minimum.
    //   2. this day's share of the monthly guideline, redistributed across hours by each hour's
    //      own share of the day's sales ("salesShapedHeadcount").
    //
    // The productivity ceiling wins whenever it actually says something — i.e. somewhere in the
    // day it rises above the bare operational minimum. That is what makes the schedule track
    // sales: quiet days stop earlier and leave staff for busy ones. Taking the more permissive of
    // the two (the previous behaviour) meant the far more generous guideline share bound on nearly
    // every day, so quiet and busy days could spend the same amount — real data, store 1001:
    // productivity justified 28 person-hours on a Tuesday and 36 on a Saturday, yet Monday through
    // Saturday each took an identical 33h while sales ranged 32,768 -> 43,656, and Sunday, the
    // second-busiest day, was left with 20h because the quiet days had already used the staff.
    //
    // The guideline share is still the fallback when productivity is degenerate for the whole day
    // — a low-volume store whose every hour floors at the minimum would otherwise have no signal
    // to vary by at all, and every day of its week would come out identical, which is the same
    // flatness seen from the other direction.
    //
    // Trade-off, chosen deliberately: a month whose guideline is more generous than productivity
    // justifies now finishes under that guideline rather than padding days out to reach it.
    const productivityIsInformative = dayDemand.hours.some((h) => h.maxJustifiedHeadcount > h.requiredHeadcount);
    const maxJustifiedByHour = new Map(
      dayDemand.hours.map((h) => {
        if (productivityIsInformative || dailyForecastValue <= 0) return [h.hour, h.maxJustifiedHeadcount];
        const hourShare = h.forecastedSales / dailyForecastValue;
        return [h.hour, Math.max(h.requiredHeadcount, Math.floor(dailyBudgetHours * hourShare))];
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
            // Managers and Team Leads are staffed before other Full-time employees.
            //
            // This used to sort on accumulated weekly hours ALONE. At the start of a week every
            // Full-time employee sits at 0, so that comparator was a no-op and the winner was
            // decided by whatever order the rows happened to come back from the database — and
            // "concentrate hours" then loaded that arbitrary first employee to their full 48h
            // before the next one was considered at all. Whoever lost the coin toss worked one or
            // two days a week, weekend included.
            //
            // Measured across ten real stores: store 1453 returns its Full-timers as
            // [Service Staff, Service Staff, Store Manager, Store Manager] and both its Store
            // Managers came out on 8h and 16h for the week, off on a 20,615 Saturday and a 25,635
            // Sunday. Store 1215 returns [Store Manager, Store Manager, Service Staff, ...] and
            // had no such problem. Same code, opposite outcome, decided by row order.
            //
            // Management presence on high-demand days is a business requirement, so role is the
            // primary key and the concentrate-hours rule applies WITHIN each role group — its
            // intent (don't spread Full-time thinly and then buy Part-time hours) is unchanged.
            const managerRank = (isManagerRole(b) ? 1 : 0) - (isManagerRole(a) ? 1 : 0);
            if (managerRank !== 0) return managerRank;
            return (weeklyUsed[`${b.id}-${weekStart}`] || 0) - (weeklyUsed[`${a.id}-${weekStart}`] || 0);
          }
          // Part-time is paid hourly — fair distribution (least-used first) is the right default.
          return (monthlyUsed[`${a.id}-${mk}`] || 0) - (monthlyUsed[`${b.id}-${mk}`] || 0);
        });

      if (type === 'FULL_TIME' && respectPreferredDayOff) {
        return candidates.find((emp) => !preferredDayOffByEmployee.get(emp.id)?.has(date)) || null;
      }
      // Everywhere else the rest day is a SOFT preference: someone whose staggered rest day is
      // today goes to the back of the queue rather than being excluded, so coverage is never left
      // unfilled just to protect a day off — but on a quiet day, where there are spare candidates,
      // they genuinely get the day off and stay available for the week's busier days.
      const restingToday = (emp) => (preferredDayOffByEmployee.get(emp.id)?.has(date) ? 1 : 0);
      const preferred = [...candidates].sort((a, b) => restingToday(a) - restingToday(b));
      return preferred[0] || null;
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
          const { start: ftStart } = chooseFullTimeStartHour({ targetHour: hour, ceilingByHour: minRequiredByHour, coverageByHour });
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
      // Largest staffing gap first; on an EQUAL gap the busier hour wins. Without the sales
      // tiebreak this loop kept the first hour it saw, so a 10:00 and an 19:00 hour with the same
      // gap always resolved to 10:00 — discretionary manpower drifted to the start of the day
      // regardless of where the sales actually were.
      let targetHour = null;
      let bestGap = 0;
      let bestSales = -1;
      for (const hour of operatingHourList()) {
        const gap = (maxJustifiedByHour.get(hour) ?? 1) - (coverageByHour[hour] || 0);
        if (gap <= 0) continue;
        const sales = salesByHour.get(hour) ?? 0;
        if (gap > bestGap || (gap === bestGap && sales > bestSales)) {
          bestGap = gap;
          bestSales = sales;
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

      // A day never takes more labour hours than its own sales justify.
      //
      // PART_TIME_MIN_HOURS is a legal floor, so filling one short-handed hour still costs a
      // 4-hour shift and the surplus hours land on hours already covered. Per-hour checks alone
      // can't see that, so every day crept past its own ceiling — and because the day loop is
      // greedy and runs Mon-first, those surplus hours were spent out of employees' WEEKLY
      // capacity, leaving genuinely busier days later in the week unable to staff up at all.
      // (Real data, store 1001: Mon-Sat each took 33h against a 28h demand ceiling, while Sunday
      // — the second-busiest day of that week — got 20h because nobody had hours left.)
      //
      // Capping the day's total at the sum of its own hourly ceilings keeps peak-hour fill intact
      // (a busy day simply has a bigger ceiling to spend) while stopping quiet days from eating
      // capacity that belongs to the week's busy ones.
      // Full-time FIRST, Part-time as the fill-in — not the other way round.
      //
      // This used to try Part-time first and only reach for Full-time once NO Part-time employee
      // was eligible. At a store with a deep Part-time bench that condition never arrives, so a
      // Full-time employee who still had hours left simply never got them. Real data, store 1508
      // (6 Full-timers, 18 Part-timers): three Full-timers were left on 0h, 8h and 8h for the
      // week, and the two with 8h worked THURSDAY — the quietest day — while sitting out a 41,213
      // Saturday and a 35,335 Sunday. They only appeared on Thursday at all because the other
      // three were on their rest day, leaving a coverage hole for them to plug. Exactly backwards,
      // and precisely the "do not use Part-time to replace a Full-time employee who can still be
      // scheduled" rule being inverted.
      //
      // The gate is the reason it was written that way in the first place: Full-time is an
      // indivisible 8-hour block, so handing it a 4-hour gap would overstaff the surrounding
      // hours. So Full-time is used only when its best available placement genuinely absorbs a
      // full shift's worth of unmet demand; anything smaller is still Part-time's job, which is
      // what keeps a quiet day from being padded out.
      let placed = null;
      if (remainingDailyBudget >= FULL_TIME_SHIFT_HOURS) {
        const ft = chooseFullTimeStartHour({ targetHour, ceilingByHour: maxJustifiedByHour, coverageByHour });
        if (ft.score >= FULL_TIME_SHIFT_HOURS) {
          // respectPreferredDayOff: this phase is DISCRETIONARY. Opening/closing coverage and
          // minimum staffing may override a rest day because the store cannot legally trade
          // without them; topping a busy hour up cannot. Without this, the extra Full-time hours
          // came partly out of employees who were meant to be resting, which spent their weekly
          // cap early and pushed their real rest day onto the weekend — measured: weekend rest
          // days went from 0 to 2 the moment Full-time-first fill was switched on.
          placed = place('FULL_TIME', ft.start, FULL_TIME_SHIFT_HOURS, { respectStoreCap: true, respectPreferredDayOff: true });
        }
      }

      if (!placed) {
        placed = place('PART_TIME', window.start, window.length, { respectStoreCap: true });
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
  chooseDayOffDates,
  isManagerRole,
  SIMILAR_DEMAND_TOLERANCE,
  WEEKEND_PROTECTION_MARGIN,
  employeeShiftType,
  weeklyCapFor,
  FULL_TIME_SHIFT_HOURS,
  FULL_TIME_BREAK_HOURS,
  FULL_TIME_CLOCK_SPAN_HOURS,
  FULL_TIME_MAX_CONSECUTIVE_DAYS,
  PART_TIME_MIN_HOURS,
  PART_TIME_MAX_HOURS,
};
