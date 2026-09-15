/**
 * Employee ID identity, shared by every path that creates or matches an employee.
 *
 * The same person has arrived under two IDs: "00106922" from a text cell and "106922" from a
 * NUMBER cell, because Excel stores the column as a number and the zeros never exist in the file.
 * Exact-string matching never recognised the second as the first, so stores ended up with every
 * Full-timer twice — store 1508's "6 Full-timers" were 3 people — and the roster generator
 * scheduled six people's worth of shifts for three humans.
 *
 * Only COMPARISON ignores the zeros. An ID written to the database is still exactly as received
 * for a genuinely new employee, and for a match it is the ID already stored, so existing shifts
 * keep pointing at the same row.
 */

/** Identity key for an Employee ID that ignores leading zeros. */
function employeeIdKey(id) {
  return String(id).trim().replace(/^0+(?=.)/, '');
}

/**
 * Every spelling of an ID that could already be stored: as received, without its leading zeros,
 * and zero-padded back out to 8 characters (the longest ID format in the data) or its own length.
 * Bounded, so it can be passed straight to an `.in('id', ...)` lookup.
 */
function employeeIdCandidates(id) {
  const key = employeeIdKey(id);
  const candidates = new Set([String(id).trim(), key]);
  for (let len = key.length + 1; len <= Math.max(8, String(id).trim().length); len++) candidates.add(key.padStart(len, '0'));
  return [...candidates];
}

module.exports = { employeeIdKey, employeeIdCandidates };
