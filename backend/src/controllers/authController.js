const supabase = require('../config/supabase');
const { success, failure } = require('../utils/apiResponse');
const { comparePassword } = require('../utils/password');
const { signToken } = require('../utils/jwt');
const { buildUserIdentity, findActiveUserById } = require('../middleware/authenticate');

/**
 * Looks up the user by email (not id, since a login request only has the
 * email) — a separate lookup from authenticate.js's findActiveUserById, but
 * both apply the same `is_active` filter so a deactivated account is
 * rejected identically whether it's logging in fresh or presenting an
 * already-issued token.
 */
async function findActiveUserByEmail(email) {
  const { data, error } = await supabase.from('users').select('*, role(*)').eq('email', email).eq('is_active', true).maybeSingle();
  if (error) throw error;
  return data;
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return failure(res, 'email and password are required', 400);

  const userRow = await findActiveUserByEmail(email);

  // Same message whether the email doesn't exist, the account has no
  // password set, or the password is wrong — never tell a caller which
  // part failed. bcrypt.compare is never called with a null hash.
  const passwordOk = userRow?.password_hash ? await comparePassword(password, userRow.password_hash) : false;
  if (!userRow || !passwordOk) {
    return failure(res, 'Invalid email or password', 401);
  }

  const identity = await buildUserIdentity(userRow);
  const token = signToken({ userId: userRow.id });

  return success(res, { token, user: identity }, 'Login successful');
}

async function me(req, res) {
  return success(res, req.user);
}

module.exports = { login, me };
