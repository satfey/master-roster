import { describe, test, expect, beforeEach } from "vitest";

/** Minimal in-memory localStorage — this project's tests run in vitest's default node
 * environment (no jsdom/browser globals), so localStorage doesn't exist unless stubbed. */
function fakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

beforeEach(() => {
  globalThis.localStorage = fakeLocalStorage();
});

const { getToken, setToken, clearToken, isAuthenticated, getCachedUser, setCachedUser, onUnauthorized, notifyUnauthorized } = await import(
  "./tokenStore.js"
);

describe("tokenStore", () => {
  test("getToken returns null when nothing was ever stored", () => {
    expect(getToken()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  test("setToken then getToken round-trips, and isAuthenticated becomes true", () => {
    setToken("abc.def.ghi");
    expect(getToken()).toBe("abc.def.ghi");
    expect(isAuthenticated()).toBe(true);
  });

  test("clearToken removes both the token and the cached user", () => {
    setToken("abc.def.ghi");
    setCachedUser({ id: "u1", name: "Jane" });

    clearToken();

    expect(getToken()).toBeNull();
    expect(getCachedUser()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  test("setCachedUser then getCachedUser round-trips a JSON object", () => {
    setCachedUser({ id: "u1", name: "Jane", role: "ADMIN" });
    expect(getCachedUser()).toEqual({ id: "u1", name: "Jane", role: "ADMIN" });
  });

  test("notifyUnauthorized clears the token and calls every subscriber", () => {
    setToken("abc.def.ghi");
    let calls = 0;
    const unsubscribe = onUnauthorized(() => {
      calls += 1;
    });

    notifyUnauthorized();

    expect(getToken()).toBeNull();
    expect(calls).toBe(1);
    unsubscribe();
  });

  test("an unsubscribed listener is not called on a later notifyUnauthorized", () => {
    let calls = 0;
    const unsubscribe = onUnauthorized(() => {
      calls += 1;
    });
    unsubscribe();

    notifyUnauthorized();

    expect(calls).toBe(0);
  });
});
