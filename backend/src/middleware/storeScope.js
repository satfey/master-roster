const { failure } = require('../utils/apiResponse');

/**
 * Restricts access to store-scoped resources based on role:
 * - STORE_MANAGER: only their own store
 * - AREA_COACH: only stores assigned to them (store.area_coach_id)
 * - ADMIN: unrestricted (company-wide)
 *
 * ADMIN is the ONLY unrestricted role, and that list is deliberately closed. An earlier version
 * also granted 'EXECUTIVE' company-wide access, but no such role exists in the `role` table — so
 * the moment anyone created one (for, say, a read-only executive dashboard) it would have silently
 * come with unrestricted access to every store's data and writes, without that ever being
 * reviewed. A new role now starts with no store access and has to be added here on purpose.
 */
/**
 * Every place a request can name a store, in one list.
 *
 * This used to be a `a || b || c || d` chain, which took the FIRST value present and ignored the
 * rest. That is a check-here/use-there gap: write controllers read `storeId` from the body, but
 * `req.query.storeId` came first in the chain, so a caller could put a store they legitimately own
 * in the query string and the store they wanted in the body. The middleware validated the former
 * and the controller wrote the latter.
 *
 * Concretely, that made `POST /roster/auto-generate?storeId=<mine>` with `{"storeId":"<theirs>",
 * "regenerate":true}` a cross-store roster wipe for any Store Manager, since `regenerate` is the
 * "delete the existing shifts and rewrite them" path.
 *
 * So: collect every candidate and require them to agree. Disagreement is never a legitimate
 * request — no caller has a reason to name two different stores in one call — so it fails closed
 * with a 400 rather than picking a winner.
 */
function resolveTargetStoreId(req) {
  const candidates = [req.params?.id, req.params?.storeId, req.query?.storeId, req.body?.storeId]
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map(String);

  if (candidates.length === 0) return { storeId: null };
  const unique = [...new Set(candidates)];
  if (unique.length > 1) return { conflict: unique };
  return { storeId: unique[0] };
}

function storeScope(req, res, next) {
  const { role, storeId, areaStoreIds } = req.user;
  const { storeId: targetStoreId = null, conflict } = resolveTargetStoreId(req);

  // Checked before the ADMIN short-circuit on purpose: a request naming two different stores is
  // malformed whoever sends it, and letting it through for ADMIN would leave the ambiguity for the
  // controller to resolve silently.
  if (conflict) {
    return failure(res, `Conflicting storeId values in one request: ${conflict.join(', ')}`, 400);
  }

  if (role === 'ADMIN') return next();

  if (role === 'STORE_MANAGER') {
    if (targetStoreId && targetStoreId !== storeId) {
      return failure(res, 'You can only access your own store', 403);
    }
    return next();
  }

  if (role === 'AREA_COACH') {
    if (targetStoreId && !areaStoreIds.includes(targetStoreId)) {
      return failure(res, 'You can only access stores assigned to you', 403);
    }
    return next();
  }

  return failure(res, 'Unrecognized role', 403);
}

/** Returns allowed store ids for `.in('id', ...)` filtering; null = no restriction. */
function getAllowedStoreIds(user) {
  if (user.role === 'ADMIN') return null;
  if (user.role === 'STORE_MANAGER') return user.storeId ? [user.storeId] : [];
  if (user.role === 'AREA_COACH') return user.areaStoreIds;
  return [];
}

module.exports = { storeScope, getAllowedStoreIds, resolveTargetStoreId };
