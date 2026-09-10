import { describe, test, expect, beforeEach, vi } from "vitest";

/** Minimal in-memory localStorage — see tokenStore.test.js for why this is stubbed manually. */
function fakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

/** Fakes `fetch` for one response, and records the last request made against it. */
function mockFetchOnce({ status, body }) {
  const calls = [];
  globalThis.fetch = vi.fn((url, init) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  });
  return calls;
}

beforeEach(() => {
  globalThis.localStorage = fakeLocalStorage();
});

const { login, fetchCurrentUser, logout } = await import("./auth.js");
const { getToken, isAuthenticated, onUnauthorized } = await import("./tokenStore.js");

describe("auth.login", () => {
  test("a successful login stores the token and returns the user from the response", async () => {
    const calls = mockFetchOnce({
      status: 200,
      body: { success: true, data: { token: "jwt-token-123", user: { id: "u1", name: "Jane", role: "ADMIN" } } },
    });

    const user = await login("jane@example.com", "correct-horse");

    expect(user).toEqual({ id: "u1", name: "Jane", role: "ADMIN" });
    expect(getToken()).toBe("jwt-token-123");
    expect(isAuthenticated()).toBe(true);
    expect(calls[0].url).toMatch(/\/login$/);
    expect(JSON.parse(calls[0].init.body)).toEqual({ email: "jane@example.com", password: "correct-horse" });
    // the login request itself carries no token yet
    expect(calls[0].init.headers.Authorization).toBeUndefined();
  });

  test("a failed login (wrong credentials) throws and never sets a token", async () => {
    mockFetchOnce({ status: 401, body: { success: false, message: "Invalid email or password" } });

    await expect(login("jane@example.com", "wrong")).rejects.toThrow("Invalid email or password");
    expect(getToken()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });
});

describe("authenticated requests", () => {
  test("a stored token is attached as an Authorization header on the next request", async () => {
    globalThis.localStorage.setItem("master-roster:token", "jwt-token-123");
    const calls = mockFetchOnce({ status: 200, body: { success: true, data: { id: "u1", name: "Jane", role: "ADMIN" } } });

    const user = await fetchCurrentUser();

    expect(user).toEqual({ id: "u1", name: "Jane", role: "ADMIN" });
    expect(calls[0].url).toMatch(/\/me$/);
    expect(calls[0].init.headers.Authorization).toBe("Bearer jwt-token-123");
  });

  test("a 401 on an authenticated request clears the token and notifies subscribers exactly once (no loop)", async () => {
    globalThis.localStorage.setItem("master-roster:token", "jwt-token-123");
    mockFetchOnce({ status: 401, body: { success: false, message: "Not authenticated" } });

    let calls = 0;
    const unsubscribe = onUnauthorized(() => {
      calls += 1;
    });

    await expect(fetchCurrentUser()).rejects.toThrow("Not authenticated");

    expect(getToken()).toBeNull();
    expect(calls).toBe(1);
    unsubscribe();
  });
});

describe("auth.logout", () => {
  test("clears the token", () => {
    globalThis.localStorage.setItem("master-roster:token", "jwt-token-123");

    logout();

    expect(getToken()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });
});
