const { failure } = require('../utils/apiResponse');

/**
 * Restricts access to store-scoped resources based on role:
 * - STORE_MANAGER: only their own store
 * - AREA_COACH: only stores assigned to them (area_coach_id on Store)
 * - EXECUTIVE / ADMIN: unrestricted (company-wide)
 *
 * With the temporary system identity (role ADMIN), this is currently a no-op
 * — real restriction takes effect once per-user login is implemented.
 */
function storeScope(req, res, next) {
  const { role, storeId, areaStoreIds } = req.user;
  const targetStoreId = req.params.storeId || req.query.storeId || null;

  if (role === 'ADMIN' || role === 'EXECUTIVE') return next();

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
  if (user.role === 'ADMIN' || user.role === 'EXECUTIVE') return null;
  if (user.role === 'STORE_MANAGER') return user.storeId ? [user.storeId] : [];
  if (user.role === 'AREA_COACH') return user.areaStoreIds;
  return [];
}

module.exports = { storeScope, getAllowedStoreIds };
