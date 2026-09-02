/**
 * Shift-length/type constants and the employee.position_time_type classifier
 * — shared by rosterGenerationService (which schedules shifts) and
 * rosterValidationService (which checks them, including on a manually
 * edited roster the generator never produced). Kept as one module, not
 * copy-pasted into both, following the same reasoning as
 * laborGuidelineHelpers.js: "so the [two] stay in sync". Also breaks what
 * would otherwise be a circular require (rosterGenerationService already
 * imports validateRoster from rosterValidationService).
 *
 * Full-time: exactly 8 PAID WORKING hours + a mandatory 1-hour unpaid
 * meal/rest break placed after the first 4 working hours (never more than 5
 * consecutive hours before the break) — 9 clock hours total, e.g.
 * 09:00-18:00 with a break 13:00-14:00. FULL_TIME_SHIFT_HOURS is the
 * WORKING-hour figure (matches planned_hours, labor cost, and every
 * weekly/monthly cap, which all already mean "hours worked", not clock
 * span); FULL_TIME_CLOCK_SPAN_HOURS positions a shift within the day
 * (start_time -> end_time) only.
 *
 * Part-time: 4-8 hours, never shorter or longer, no mandatory break modeled.
 * 8h is a hard ceiling — the system never schedules a Part-time shift beyond
 * it, so overtime is avoided by construction rather than tracked separately.
 *
 * FULL_TIME_MAX_CONSECUTIVE_DAYS is the Thailand labor-law baseline: a
 * Full-time employee must get a rest day at least every 6 consecutive
 * working days (48h/week + 8h/shift already implies at most 6 shifts within
 * a single ISO week, but doesn't by itself prevent 7+ consecutive *calendar*
 * days worked across a week boundary — this constant guards that case too).
 */
const FULL_TIME_SHIFT_HOURS = 8; // WORKING hours — excludes the break
const FULL_TIME_BREAK_HOURS = 1;
const FULL_TIME_CLOCK_SPAN_HOURS = FULL_TIME_SHIFT_HOURS + FULL_TIME_BREAK_HOURS; // 9 — start_time to end_time
const FULL_TIME_MAX_CONSECUTIVE_DAYS = 6;
const PART_TIME_MIN_HOURS = 4;
const PART_TIME_MAX_HOURS = 8;
const DEFAULT_WEEKLY_HOURS = 48; // fallback when employee.default_weekly_hours is null, matching the legacy rosterService MAX_WEEKLY_HOURS

function weeklyCapFor(employee) {
  return employee.default_weekly_hours != null ? Number(employee.default_weekly_hours) : DEFAULT_WEEKLY_HOURS;
}

function employeeShiftType(employee) {
  const t = (employee.position_time_type || '').trim().toLowerCase();
  if (t.startsWith('full')) return 'FULL_TIME';
  if (t.startsWith('part')) return 'PART_TIME';
  return null; // no recognized type
}

module.exports = {
  FULL_TIME_SHIFT_HOURS,
  FULL_TIME_BREAK_HOURS,
  FULL_TIME_CLOCK_SPAN_HOURS,
  FULL_TIME_MAX_CONSECUTIVE_DAYS,
  PART_TIME_MIN_HOURS,
  PART_TIME_MAX_HOURS,
  DEFAULT_WEEKLY_HOURS,
  weeklyCapFor,
  employeeShiftType,
};
