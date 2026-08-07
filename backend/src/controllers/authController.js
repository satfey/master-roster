const { success, failure } = require('../utils/apiResponse');

/**
 * TEMPORARY stub — the login system is deferred (see README / project notes).
 * The `authenticate` middleware currently attaches a fixed system identity to
 * every request regardless of this endpoint, so this route is not wired into
 * the app yet. It's kept here as the intended shape for when real auth is
 * built: look up the user by email, verify a password, issue a JWT.
 */
async function login(req, res) {
  return failure(res, 'Login is not implemented yet — the app currently runs without authentication. See README.', 501);
}

async function me(req, res) {
  return success(res, req.user);
}

module.exports = { login, me };
