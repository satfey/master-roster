/**
 * TEMPORARY: the login system is deferred (see project notes / README).
 * The new ERD's `user` table has no password field yet, so instead of
 * validating a JWT we attach a fixed "system" identity with full access.
 * This keeps every downstream route, controller, and RBAC check working
 * unchanged — swap this back to real JWT verification once auth is built.
 *
 * To re-enable real authentication later:
 *   1. Add a credentials table (e.g. `user_credential` with password_hash).
 *   2. Restore JWT issuance in authController.login.
 *   3. Replace the body of this function with token verification + DB lookup.
 */
const supabase = require('../config/supabase');

let cachedSystemUser = null;

async function authenticate(req, res, next) {
  try {
    if (!cachedSystemUser) {
      const { data: adminRole } = await supabase.from('role').select('id').eq('name', 'ADMIN').maybeSingle();
      const { data: adminUser } = adminRole
        ? await supabase.from('users').select('*').eq('role_id', adminRole.id).limit(1).maybeSingle()
        : { data: null };

      cachedSystemUser = {
        id: adminUser?.id || null,
        name: adminUser?.full_name || 'System (no login required)',
        email: adminUser?.email || 'system@masterroster.local',
        role: 'ADMIN',
        permissions: ['*'],
        storeId: adminUser?.store_id || null,
        areaStoreIds: [],
      };
    }

    req.user = cachedSystemUser;
    next();
  } catch (err) {
    // Even if the DB lookup fails, don't block the request — fall back to a
    // bare system identity so the app remains usable while login is WIP.
    req.user = {
      id: null,
      name: 'System (no login required)',
      email: 'system@masterroster.local',
      role: 'ADMIN',
      permissions: ['*'],
      storeId: null,
      areaStoreIds: [],
    };
    next();
  }
}

module.exports = authenticate;
