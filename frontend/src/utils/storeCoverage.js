import { STORE_COVERAGE } from '../config/storeRules';
import { resolveShift, toMinutes } from './rosterUtils';

const shiftsOn = (staff, day) =>
  staff
    .map((member) => resolveShift(member.shifts[day]?.shiftId, member.employmentType))
    .filter(Boolean);

/**
 * How many people are on the floor that day, and how many of them cover open
 * and close — a plain count of what the grid currently shows, used for display.
 *
 * Whether that count is ACCEPTABLE is not decided here: opening/closing cover
 * and hour-by-hour staffing are graded by the backend
 * (POST /roster/validate -> openingCoverageOk / closingCoverageOk /
 * understaffedHours / overstaffedHours) and surfaced through
 * lib/rosterValidationAdapter.js.
 */
export const coverageForDay = (staff, day, rules = STORE_COVERAGE) => {
  const openMin = toMinutes(rules.openingTime);
  const closeMin = toMinutes(rules.closingTime);
  const shifts = shiftsOn(staff, day);

  return {
    day,
    onDuty: shifts.length,
    openers: shifts.filter((s) => s.startMin <= openMin).length,
    closers: shifts.filter((s) => s.endMin >= closeMin).length
  };
};

/**
 * Removed: validateStoreCoverage().
 *
 * It judged rosters against rules invented in the browser — a 10:00-19:00
 * trading day, one closer, a five-person ceiling per store, and a sales-band
 * headcount target. The backend's real rules are a 09:00-22:00 day, two
 * closers, no store headcount ceiling, and per-hour demand from each store's
 * target productivity, so every verdict it produced could contradict the
 * generator that built the roster.
 *
 * Use the backend's validation instead:
 *   rosterService.getRoster() -> roster.validation.storeIssues
 */
