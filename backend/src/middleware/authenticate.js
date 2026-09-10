const supabase = require('../config/supabase');
const { verifyToken } = require('../utils/jwt');
const { failure } = require('../utils/apiResponse');

/**
 * Builds the req.user shape every downstream consumer (authorize.js,
 * storeScope.js) already expects, from a real `user` row (joined with its
 * role). Shared by the login controller (right after verifying a password)
 * and this middleware (on every subsequent authenticated request), so both
 * paths compute identity — including an AREA_COACH's allowed stores —
 * exactly the same way.
 *
 * areaStoreIds is only ever non-empty for AREA_COACH: it's every store
 * whose area_coach_id matches the area_coach record this login resolves to
 * (see resolveAreaCoachId).
 */

/**
 * Which area_coach record this login IS.
 *
 * store.area_coach_id already says which coach owns each store; what's missing is the other half
 * of the link — the account -> coach direction. The intended column for that (user.area_coach_id,
 * from the user-credentials migration) was never actually created in this database, and
 * `area_coach` carries only an id and a name, so there is no email or code to join on.
 *
 * So: use the column when it exists, otherwise fall back to matching the account's own name
 * against the coach's. A name that matches more than one coach resolves to NOTHING rather than
 * picking one — an Area Coach scoped to the wrong area would silently read another region's
 * stores, which is worse than being scoped to none and noticing.
 */
async function resolveAreaCoachId(userRow) {
  if (userRow.area_coach_id) return userRow.area_coach_id;
  if (!userRow.full_name) return null;

  const { data, error } = await supabase.from('area_coach').select('id').ilike('name', userRow.full_name);
  if (error) throw error;
  return data && data.length === 1 ? data[0].id : null;
}

async function buildUserIdentity(userRow) {
  let areaStoreIds = [];
  if (userRow.role?.name === 'AREA_COACH') {
    const areaCoachId = await resolveAreaCoachId(userRow);
    if (areaCoachId) {
      const { data: stores, error } = await supabase.from('store').select('id').eq('area_coach_id', areaCoachId);
      if (error) throw error;
      areaStoreIds = stores.map((s) => s.id);
    }
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
  const { data, error } = await supabase.from('user').select('*, role(*)').eq('id', userId).eq('is_active', true).maybeSingle();
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
