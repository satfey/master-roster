// Raw localStorage-backed session storage + a tiny pub/sub for "session just
// became invalid" — kept separate from api.js and auth.js so neither has to
// import the other (api.js needs to read the token and report 401s; auth.js
// needs to write the token and expose the same read/clear helpers to the UI).
//
// Plain function pub/sub instead of window.dispatchEvent/CustomEvent: this
// app has no router or store, so a listener list is the smallest thing that
// works, and it needs no browser DOM APIs to unit test.

const PREFIX = "master-roster:";
const TOKEN_KEY = PREFIX + "token";
const USER_KEY = PREFIX + "user";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // storage unavailable (e.g. private mode) — session just won't survive a refresh
  }
}

export function getCachedUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCachedUser(user) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // ignore
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}

export function isAuthenticated() {
  return !!getToken();
}

const unauthorizedListeners = new Set();

/** Called by api.js when an authenticated request comes back 401 (token rejected/expired). */
export function notifyUnauthorized() {
  clearToken();
  unauthorizedListeners.forEach((fn) => fn());
}

/** Subscribe to "the session just became invalid" (e.g. to drop back to the login screen). Returns an unsubscribe function. */
export function onUnauthorized(fn) {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}
