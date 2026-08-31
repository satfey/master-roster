/**
 * All stores currently operate the same fixed hours (09:00–22:00) — there is
 * no per-store operating-hours field in the schema yet. If that ever becomes
 * store-specific, this is the one place to change.
 *
 * Also defines the encoding used to store an hourly forecast inside
 * sales_forecast.daypart (VARCHAR(30), documented in
 * docs/master_roster_schema.sql as "FULL_DAY | MORNING | AFTERNOON |
 * EVENING") without adding a new column: an hourly row uses daypart =
 * 'HOUR_09'..'HOUR_21' instead of 'FULL_DAY'. This is purely additive — every
 * existing FULL_DAY row and every consumer that filters on
 * `daypart = 'FULL_DAY'` is unaffected.
 */
const OPERATING_HOURS = { start: 9, end: 22 }; // store opens at 09:00, closes at 22:00

// Every operating day must end with at least this many employees whose shift
// end_time equals closing time exactly — not just "someone present in the
// last hour." Shared by rosterGenerationService (assignment) and
// rosterValidationService (checking), so they can't drift apart on this number.
const CLOSING_COVERAGE_STAFF_COUNT = 2;

/** The operating hour-of-day slots, e.g. [9, 10, ..., 21] — the hour a shift covering "21:00-22:00" is keyed by its start hour. */
function operatingHourList() {
  return Array.from({ length: OPERATING_HOURS.end - OPERATING_HOURS.start }, (_, i) => OPERATING_HOURS.start + i);
}

function hourDaypart(hour) {
  return `HOUR_${String(hour).padStart(2, '0')}`;
}

function isHourlyDaypart(daypart) {
  return /^HOUR_\d{2}$/.test(daypart);
}

function daypartToHour(daypart) {
  return Number(daypart.slice(5));
}

module.exports = { OPERATING_HOURS, CLOSING_COVERAGE_STAFF_COUNT, operatingHourList, hourDaypart, isHourlyDaypart, daypartToHour };
