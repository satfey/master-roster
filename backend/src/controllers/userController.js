const supabase = require('../config/supabase');
const { success, failure } = require('../utils/apiResponse');
const { hashPassword } = require('../utils/password');

/**
 * Columns safe to send to a client. Written out rather than using `*` so `password_hash` is never
 * fetched in the first place — omitPasswordHash below is still the thing that guarantees it never
 * reaches a response, but with an explicit list the hash does not enter this process at all, so it
 * cannot reach a log line, an error payload, or a future handler that forgets to map.
 */
const USER_PUBLIC_COLUMNS = 'id, full_name, email, role_id, store_id, is_active';

/** Never returns password_hash to a client, in list or single-record responses alike. */
function omitPasswordHash(user) {
  if (!user) return user;
  const { password_hash, ...rest } = user;
  return rest;
}

async function list(req, res) {
  const { data: users, error } = await supabase
    .from('user')
    .select(`${USER_PUBLIC_COLUMNS}, role(*), store:store_id(*)`)
    .order('full_name', { ascending: true });
  if (error) throw error;
  return success(res, users.map(omitPasswordHash));
}

async function create(req, res) {
  const { fullName, email, roleId, storeId, areaCoachId, password } = req.body;
  if (!fullName || !email || !roleId) return failure(res, 'fullName, email, and roleId are required', 400);

  const passwordHash = password ? await hashPassword(password) : null;
  const { data: user, error } = await supabase
    .from('user')
    .insert({ full_name: fullName, email, role_id: roleId, store_id: storeId || null, area_coach_id: areaCoachId || null, password_hash: passwordHash })
    .select(USER_PUBLIC_COLUMNS)
    .single();
  if (error) throw error;
  return success(res, omitPasswordHash(user), 'User created', 201);
}

async function update(req, res) {
  const { id } = req.params;
  const { fullName, roleId, storeId, areaCoachId, isActive, password } = req.body;

  const patch = { full_name: fullName, role_id: roleId, store_id: storeId, area_coach_id: areaCoachId, is_active: isActive };
  if (password) patch.password_hash = await hashPassword(password);

  const { data: user, error } = await supabase.from('user').update(patch).eq('id', id).select(USER_PUBLIC_COLUMNS).single();
  if (error) throw error;
  return success(res, omitPasswordHash(user), 'User updated');
}

module.exports = { list, create, update };
