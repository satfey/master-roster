// Real authentication against the Master Roster backend — POST /login (bcrypt +
// JWT) and GET /me. This replaces the mock sign-in this UI shell shipped with:
// that version compared plaintext passwords against MOCK_USERS in the browser,
// which can never be a real login (the password list would ship in the bundle).
//
// The identity the backend returns is the source of truth for role and store
// scope. It is re-read from GET /me on every page load rather than trusted from
// localStorage, so a role change, store reassignment, or deactivation takes
// effect on the user's next visit — see lib/auth.js.

import { login as apiLogin, fetchCurrentUser, logout as clearToken, isAuthenticated } from '../lib/auth.js';

/**
 * Signs in against the real backend. Returns the backend's identity
 * ({ id, name, email, role, permissions, storeId, areaStoreIds }) — `role` is
 * already one of ADMIN / AREA_COACH / STORE_MANAGER, matching config/roles.js.
 */
export const signIn = async ({ email, password }) => {
  return apiLogin(email, password);
};

/**
 * Restores a session on refresh. The JWT lives in tokenStore (see lib/auth.js);
 * if one is present the identity behind it is re-fetched from the backend, and
 * a rejected/expired token simply resolves to null so the app falls back to the
 * login screen.
 */
export const restoreSession = async () => {
  if (!isAuthenticated()) return null;
  try {
    return await fetchCurrentUser();
  } catch {
    return null;
  }
};

/**
 * No-op: the token was already persisted by lib/auth.js's login(). Kept so
 * AuthContext's existing call site keeps working.
 *
 * `remember` is not honoured — the backend issues a JWT with a fixed lifetime
 * (JWT_EXPIRES_IN) and the token store decides where it lives. Wiring a real
 * "remember me" means a longer-lived or refresh token on the backend, which
 * does not exist yet, so quietly persisting forever here would be a lie.
 */
export const persistSession = () => {};

export const clearSession = () => {
  clearToken();
};
