// Public auth surface for the rest of the app: log in/out, and read the
// current session. Role/permissions are never trusted from the cached copy
// for authorization — the backend enforces access on every request
// regardless of what the client thinks, and fetchCurrentUser() always
// re-reads the identity from the backend rather than the localStorage cache.
import { apiPost, apiGet } from "./api.js";
import { getToken, setToken, clearToken, isAuthenticated, getCachedUser, setCachedUser, onUnauthorized } from "./tokenStore.js";

export { getToken, setToken, clearToken, isAuthenticated, getCachedUser, onUnauthorized };

/** POST /login — on success, stores the token and the identity the backend returned. Never logs the password or the token. */
export async function login(email, password) {
  const { token, user } = await apiPost("/login", { email, password });
  setToken(token);
  setCachedUser(user);
  return user;
}

/** GET /me — the source of truth for the current identity (role/permissions/store), re-read from the backend. */
export async function fetchCurrentUser() {
  const user = await apiGet("/me");
  setCachedUser(user);
  return user;
}

export function logout() {
  clearToken();
}
