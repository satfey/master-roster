const supabase = require('../config/supabase');
const { verifyToken } = require('../utils/jwt');
const { failure } = require('../utils/apiResponse');

/**
 * Builds the req.user shape every downstream consumer (authorize.js,
 * storeScope.js) already expects, from a real `users` row (joined with its
 * role). Shared by the login controller (right after verifying a password)
 * and this middleware (on every subsequent authenticated request), so both
 * paths compute identity — including an AREA_COACH's allowed stores —
 * exactly the same way.
 *
 * areaStoreIds is only ever non-empty for AREA_COACH: it's every store
 * whose area_coach_id matches this user's own area_coach_id (the FK added
 * specifically to link a login to the pre-existing area_coach lookup table
 * that store.area_coach_id already pointed to).
 */
async function buildUserIdentity(userRow) {
  let areaStoreIds = [];
  if (userRow.role?.name === 'AREA_COACH' && userRow.area_coach_id) {
    const { data: stores, error } = await supabase.from('store').select('id').eq('area_coach_id', userRow.area_coach_id);
    if (error) throw error;
    areaStoreIds = stores.map((s) => s.id);
  }

  return {
    id: userRow.id,
    name: userRow.full_name,
    email: userRow.email,
    role: userRow.role?.name ?? null,
    permissions: userRow.role?.permissions ?? [],
    storeId: userRow.store_id,
    areaStoreIds,
  };
}

/** Fetches the active user + role for a user id — the one place both login and authenticate look a user up, so an inactive/deleted account is treated identically by both. */
async function findActiveUserById(userId) {
  const { data, error } = await supabase.from('users').select('*, role(*)').eq('id', userId).eq('is_active', true).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Verifies the `Authorization: Bearer <token>` header and attaches the real,
 * current identity of that user to req.user — re-read from the database on
 * every request (not trusted from the token's own claims, which only ever
 * carry the user id) so a role change, store reassignment, or deactivation
 * takes effect on the user's very next request rather than waiting for the
 * token to expire.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return failure(res, 'Not authenticated', 401);
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    return failure(res, 'Invalid or expired token', 401);
  }

  const userRow = await findActiveUserById(decoded.userId);
  if (!userRow) {
    return failure(res, 'Not authenticated', 401);
  }

  req.user = await buildUserIdentity(userRow);
  next();
}

module.exports = authenticate;
module.exports.buildUserIdentity = buildUserIdentity;
module.exports.findActiveUserById = findActiveUserById;
