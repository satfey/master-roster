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
function storeScope(req, res, next) {
  const { role, storeId, areaStoreIds } = req.user;
  const targetStoreId = req.params.id || req.params.storeId || req.query.storeId || req.body?.storeId || null;

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

module.exports = { storeScope, getAllowedStoreIds };
