// Which stores the signed-in user may work with, mirroring the backend's
// storeScope.getAllowedStoreIds() exactly — ADMIN/EXECUTIVE are unrestricted,
// a STORE_MANAGER is pinned to their own store, an AREA_COACH to the stores
// assigned to them.
//
// This is a UI affordance ONLY: it decides whether to render a store picker at
// all, never whether a request is allowed. The backend re-checks every request
// against the same rule (authorize + storeScope) regardless of what the client
// renders, so a user who edits their cached identity gains nothing — they just
// get a 403 from the API instead of a hidden input.

/** null = no restriction (ADMIN/EXECUTIVE); otherwise the exact list of store ids this user may use. */
export function allowedStoreIds(user) {
  if (!user) return [];
  if (user.role === "ADMIN" || user.role === "EXECUTIVE") return null;
  if (user.role === "STORE_MANAGER") return user.storeId ? [user.storeId] : [];
  if (user.role === "AREA_COACH") return user.areaStoreIds || [];
  return [];
}

/**
 * The single store this user is locked to, or null when they may choose among
 * several (or all). A user with exactly one allowed store gets no picker —
 * there is nothing to choose, and offering a free-text box would only invite
 * typing a store id the backend will reject with a 403.
 */
export function lockedStoreId(user) {
  const ids = allowedStoreIds(user);
  return ids && ids.length === 1 ? ids[0] : null;
}
