// Roster data for the roster screen, from the real backend.
//
// Nothing here decides staffing. Generation is POST /roster/auto-generate —
// the existing rosterGenerationService, untouched — and this module only
// requests it and reshapes what comes back (see lib/rosterAdapter.js). The
// screen's own headcount suggestions and labour warnings are display-side
// checks layered on top; they never override what the backend produced.

import { apiGet, apiPost, apiPut } from '../lib/api.js';
import { filterShiftsInRange } from '../lib/autoRoster.js';
import { buildRosterView, eachDate, weekRange } from '../lib/rosterAdapter.js';
import { toDisplayValidation } from '../lib/rosterValidationAdapter.js';
import { canAccessStore } from './storeService';

/** The week the roster screen opens on when it isn't told otherwise. */
const defaultRange = () => weekRange(new Date().toISOString().slice(0, 10));

async function fetchShifts(storeId, startDate, endDate) {
  const rosters = await apiGet(`/roster?storeId=${encodeURIComponent(storeId)}`);
  return filterShiftsInRange(rosters, startDate, endDate);
}

/** Forecast sales per day, used by the coverage table's "recommended headcount". */
async function fetchDailySales(storeId, startDate, endDate) {
  try {
    const query = new URLSearchParams({ storeId, startDate, endDate }).toString();
    const preview = await apiGet(`/forecast/preview?${query}`);
    return Object.fromEntries(preview.days.map((d) => [d.date, d.forecastedSales]));
  } catch {
    // The roster itself is still perfectly usable without the sales column.
    return {};
  }
}

/**
 * The real hourly demand curve — GET /labor/demand runs the same
 * laborDemandService the generator and validator use. Returns [] on failure so
 * the roster still renders; the demand grid then simply has nothing to show
 * rather than falling back to invented numbers.
 */
async function fetchDemand(storeId, startDate, endDate) {
  try {
    const result = await apiGet(
      `/labor/demand?storeId=${encodeURIComponent(storeId)}&from=${startDate}&to=${endDate}`
    );
    return result?.days ?? [];
  } catch {
    return [];
  }
}

/** The month's labour-hour ceiling generation was sized against. */
async function fetchQuota(storeId, startDate) {
  try {
    const month = startDate.slice(0, 7);
    const capacity = await apiGet(`/roster/capacity?storeId=${encodeURIComponent(storeId)}&month=${month}`);
    return capacity?.monthlyGuideline ?? 0;
  } catch {
    return 0;
  }
}

/**
 * The real compliance check — rosterValidationService via POST /roster/validate.
 * Every staffing and labour-law rule the screen shows comes from here, never
 * from a rule re-derived in the browser.
 */
async function fetchValidation(storeId, startDate, endDate) {
  try {
    return await apiPost('/roster/validate', { storeId, startDate, endDate });
  } catch {
    return null; // the roster still renders; the compliance panel just has nothing to show
  }
}

async function loadRoster(storeId, startDate, endDate) {
  const [employees, shifts, dailySales, quota, validation, demandDays] = await Promise.all([
    apiGet(`/employee?storeId=${encodeURIComponent(storeId)}`),
    fetchShifts(storeId, startDate, endDate),
    fetchDailySales(storeId, startDate, endDate),
    fetchQuota(storeId, startDate),
    fetchValidation(storeId, startDate, endDate),
    fetchDemand(storeId, startDate, endDate),
  ]);

  const view = buildRosterView({
    storeId,
    employees,
    shifts,
    days: eachDate(startDate, endDate),
    dailySales,
    quota,
    demandDays,
  });

  // shiftId -> rosterId, so a cell edit knows which roster to PUT to.
  const shiftRosterIds = Object.fromEntries(shifts.map((s) => [s.id, s.roster_id]));
  return { ...view, shiftRosterIds, validation: toDisplayValidation(validation, view.staff) };
}

/**
 * The store's current roster. The scope check mirrors the backend's, which
 * re-checks every request regardless (storeScope) — this one only avoids
 * firing a request that is certain to come back 403.
 */
export const getRoster = async (user, storeId, range) => {
  const scopedStoreId = storeId ?? user?.storeId;
  if (!canAccessStore(user, scopedStoreId)) {
    throw new Error('ไม่มีสิทธิ์เข้าถึงข้อมูลสาขานี้');
  }
  const { startDate, endDate } = range ?? defaultRange();
  return loadRoster(scopedStoreId, startDate, endDate);
};

/**
 * Runs the real generator for the visible week, then re-reads what it wrote.
 *
 * `regenerate: true` is deliberate: this button is how the screen re-runs a
 * week that already has shifts, and without it the backend refuses rather than
 * duplicating. It replaces the week's shifts for this store only.
 */
export const generateSchedule = async (user, { storeId, range } = {}) => {
  const scopedStoreId = storeId ?? user?.storeId;
  if (!canAccessStore(user, scopedStoreId)) {
    throw new Error('ไม่มีสิทธิ์จัดตารางของสาขานี้');
  }
  const { startDate, endDate } = range ?? defaultRange();
  await apiPost('/roster/auto-generate', { storeId: scopedStoreId, startDate, endDate, regenerate: true });
  return loadRoster(scopedStoreId, startDate, endDate);
};

/**
 * Saves who covers each shift, via the existing PUT /roster/:id.
 *
 * That endpoint updates a shift's employee_id and nothing else — it cannot move
 * a shift to another time, change planned hours, or create/delete one. That is
 * exactly the boundary this screen needs: a manager may reassign or swap who
 * works a shift, but the hours the generator produced stay untouched.
 *
 * `assignments` is { rosterShiftId: employeeId }. Shifts are grouped by the
 * roster they belong to, since the endpoint is addressed by roster id, and a
 * week can span more than one roster row.
 */
export const saveAssignments = async (user, storeId, assignments = {}, shiftRosterIds = {}) => {
  const scopedStoreId = storeId ?? user?.storeId;
  if (!canAccessStore(user, scopedStoreId)) throw new Error('ไม่มีสิทธิ์บันทึกตารางของสาขานี้');

  const byRoster = new Map();
  for (const [shiftId, employeeId] of Object.entries(assignments)) {
    const rosterId = shiftRosterIds[shiftId];
    if (!rosterId || !employeeId) continue; // an unassigned cell has nothing to persist
    if (!byRoster.has(rosterId)) byRoster.set(rosterId, []);
    byRoster.get(rosterId).push({ id: shiftId, employeeId });
  }

  if (byRoster.size === 0) return { saved: 0 };

  for (const [rosterId, shifts] of byRoster) {
    await apiPut(`/roster/${encodeURIComponent(rosterId)}`, { shifts });
  }
  return { saved: [...byRoster.values()].reduce((n, list) => n + list.length, 0) };
};

/**
 * The all-stores exception view has no data source.
 *
 * Rendering it for real means a roster for every store in scope (574 for an Admin), which needs a
 * purpose-built backend endpoint rather than N round trips from the browser. It previously
 * returned mock rosters, which put invented headcounts in front of the one role most likely to
 * act on them chain-wide. It now returns nothing and the screen says so.
 */
export const getNetworkRoster = async () => ({
  days: [],
  storeRosters: [],
  storeCount: 0,
  quotaPerStore: 0,
  quota: 0,
  unavailable: true,
});
