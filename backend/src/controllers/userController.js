const supabase = require('../config/supabase');
const { success, failure } = require('../utils/apiResponse');
const { hashPassword } = require('../utils/password');

/** Never returns password_hash to a client, in list or single-record responses alike. */
function omitPasswordHash(user) {
  if (!user) return user;
  const { password_hash, ...rest } = user;
  return rest;
}

async function list(req, res) {
  const { data: users, error } = await supabase
    .from('users')
    .select('*, role(*), store:store_id(*)')
    .order('full_name', { ascending: true });
  if (error) throw error;
  return success(res, users.map(omitPasswordHash));
}

async function create(req, res) {
  const { fullName, email, roleId, storeId, areaCoachId, password } = req.body;
  if (!fullName || !email || !roleId) return failure(res, 'fullName, email, and roleId are required', 400);

  const passwordHash = password ? await hashPassword(password) : null;
  const { data: user, error } = await supabase
    .from('users')
    .insert({ full_name: fullName, email, role_id: roleId, store_id: storeId || null, area_coach_id: areaCoachId || null, password_hash: passwordHash })
    .select()
    .single();
  if (error) throw error;
  return success(res, omitPasswordHash(user), 'User created', 201);
}

async function update(req, res) {
  const { id } = req.params;
  const { fullName, roleId, storeId, areaCoachId, isActive, password } = req.body;

  const patch = { full_name: fullName, role_id: roleId, store_id: storeId, area_coach_id: areaCoachId, is_active: isActive };
  if (password) patch.password_hash = await hashPassword(password);

  const { data: user, error } = await supabase.from('users').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return success(res, omitPasswordHash(user), 'User updated');
}

module.exports = { list, create, update };
