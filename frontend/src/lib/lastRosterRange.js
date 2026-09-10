// Remembers the date range a roster was last generated for.
//
// Generated shifts live in the database, so they never actually disappear — but the roster
// screen used to open on the current Mon-Sun every single time, so a roster generated for any
// other range looked lost the moment you navigated away and came back. This keeps the screen
// pointed at the range that was generated until a new generate moves it.
//
// Only a successful generate writes here. Browsing other dates with the range picker is a
// read-only look at another week and deliberately does not disturb what is remembered.

import { loadKeySync, saveKey } from './storage.js';
import { weekRange } from './rosterAdapter.js';

const LAST_RANGE_KEY = 'roster:last-generated-range';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a stored value is safe to open the screen on: two real ISO dates, in order.
 * Anything else (a half-written entry, a value from an older shape of this key, hand-edited
 * localStorage) falls back to the current week rather than putting an invalid range into the
 * date inputs and firing a request that cannot succeed.
 */
export function isUsableRange(range) {
  if (!range) return false;
  const { startDate, endDate } = range;
  if (!ISO_DATE.test(startDate ?? '') || !ISO_DATE.test(endDate ?? '')) return false;
  return startDate <= endDate;
}

/** The range the roster screen should open on: the last generated one, else the current week. */
export function readLastGeneratedRange(today = new Date().toISOString().slice(0, 10)) {
  const saved = loadKeySync(LAST_RANGE_KEY, null);
  if (!isUsableRange(saved)) return weekRange(today);
  return { startDate: saved.startDate, endDate: saved.endDate };
}

/** Records the range a generate just produced. Invalid input is ignored, never stored. */
export function rememberGeneratedRange(range) {
  if (!isUsableRange(range)) return;
  saveKey(LAST_RANGE_KEY, { startDate: range.startDate, endDate: range.endDate });
}
