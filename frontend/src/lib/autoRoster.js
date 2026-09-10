// Pure decision logic for the Auto Generate Roster screen (see
// pages/AutoRosterTab.jsx), separated out so it's testable without
// rendering. Auto Generate must never silently replace an existing
// roster — it only ever generates when nothing exists yet. Only an
// explicit, user-confirmed regenerate call may replace shifts.
//
// apiGet/apiPost are passed in rather than imported, so tests can supply
// fakes instead of hitting the network.

/** Filters the flattened shifts from every roster for a store down to one date range. */
export function filterShiftsInRange(rosters, startDate, endDate) {
  const allShifts = rosters.flatMap((r) => r.shift || []);
  return allShifts.filter((s) => s.shift_date >= startDate && s.shift_date <= endDate);
}

/** GET-only existence check, reusing the existing GET /roster?storeId= (no new endpoint) — never writes. */
export async function fetchExistingShiftsForRange(apiGet, storeId, startDate, endDate) {
  const rosters = await apiGet(`/roster?storeId=${encodeURIComponent(storeId)}`);
  return filterShiftsInRange(rosters, startDate, endDate);
}

async function fetchGeneratedShifts(apiGet, genResult, startDate, endDate) {
  const rosters = await Promise.all(genResult.rosterIds.map((id) => apiGet(`/roster/${id}`)));
  return filterShiftsInRange(rosters, startDate, endDate);
}

/**
 * "Auto Generate" button behavior: check first, generate only if nothing
 * exists for this store + date range yet. Never sends regenerate: true —
 * calling this repeatedly once shifts exist never creates duplicates,
 * since every call re-checks before ever writing.
 */
export async function resolveRoster({ apiGet, apiPost }, { storeId, startDate, endDate }) {
  const existing = await fetchExistingShiftsForRange(apiGet, storeId, startDate, endDate);
  if (existing.length > 0) {
    return { status: "existing", shifts: existing, result: null };
  }
  const genResult = await apiPost("/roster/auto-generate", { storeId, startDate, endDate, regenerate: false });
  const shifts = await fetchGeneratedShifts(apiGet, genResult, startDate, endDate);
  return { status: "generated", shifts, result: genResult };
}

/**
 * "Regenerate" button behavior — only reachable in the UI after an explicit
 * confirmation step. Always sends regenerate: true and replaces whatever
 * was there.
 */
export async function forceRegenerateRoster({ apiGet, apiPost }, { storeId, startDate, endDate }) {
  const genResult = await apiPost("/roster/auto-generate", { storeId, startDate, endDate, regenerate: true });
  const shifts = await fetchGeneratedShifts(apiGet, genResult, startDate, endDate);
  return { status: "generated", shifts, result: genResult };
}
