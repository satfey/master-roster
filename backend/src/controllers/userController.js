const supabase = require('../config/supabase');
const { success } = require('../utils/apiResponse');

/**
 * NOTE: no password field exists yet on User (login deferred), so this is
 * plain CRUD without credential handling. Add password hashing back here
 * once the credentials table / login flow is implemented.
 */
async function list(req, res) {
  const { data: users, error } = await supabase
    .from('users')
    .select('*, role(*), store:store_id(*)')
    .order('full_name', { ascending: true });
  if (error) throw error;
  return success(res, users);
}

async function create(req, res) {
  const { fullName, email, roleId, storeId } = req.body;
  const { data: user, error } = await supabase
    .from('users')
    .insert({ full_name: fullName, email, role_id: roleId, store_id: storeId || null })
    .select()
    .single();
  if (error) throw error;
  return success(res, user, 'User created', 201);
}

async function update(req, res) {
  const { id } = req.params;
  const { fullName, roleId, storeId, isActive } = req.body;
  const { data: user, error } = await supabase
    .from('users')
    .update({ full_name: fullName, role_id: roleId, store_id: storeId, is_active: isActive })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return success(res, user, 'User updated');
}

module.exports = { list, create, update };
