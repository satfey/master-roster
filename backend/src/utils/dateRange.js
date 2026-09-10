// Date-string helpers shared by forecastService / rosterGenerationService /
// rosterValidationService. Dates are always plain 'YYYY-MM-DD' strings,
// parsed as UTC midnight so day-of-week / range math never shifts under a
// server-local timezone.

function toUTCDate(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`);
}

/** 0 = Sunday .. 6 = Saturday. */
function weekdayOf(dateStr) {
  return toUTCDate(dateStr).getUTCDay();
}

function eachDateInRange(startDate, endDate) {
  const dates = [];
  let cur = toUTCDate(startDate);
  const end = toUTCDate(endDate);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

/** The Monday that starts the ISO week containing dateStr. */
function isoWeekStart(dateStr) {
  const d = toUTCDate(dateStr);
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return new Date(d.getTime() + diffToMonday * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function monthKey(dateStr) {
  return dateStr.slice(0, 7); // 'YYYY-MM'
}

/** { start, end, days } for the calendar month a 'YYYY-MM' key refers to. */
function monthRange(key) {
  const [year, month] = key.split('-').map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${key}-01`, end: `${key}-${String(days).padStart(2, '0')}`, days };
}

module.exports = { toUTCDate, weekdayOf, eachDateInRange, isoWeekStart, monthKey, monthRange };
