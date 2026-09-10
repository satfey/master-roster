// Simple localStorage-backed key/value store.
// (This project runs as a normal standalone web app, so plain
// localStorage is fine here — unlike inside a Claude.ai artifact.)

const PREFIX = "master-roster:";

/**
 * Synchronous read of the same keys `loadKey` reads.
 *
 * localStorage is synchronous already — the async wrapper below only exists because its first
 * callers happened to be async. A React useState initializer cannot await, and reading in an
 * effect instead renders one frame with the wrong value and fires a throwaway request for it,
 * so anything restoring state on mount wants this form.
 */
export function loadKeySync(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

export async function loadKey(key, fallback) {
  return loadKeySync(key, fallback);
}

export async function saveKey(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.error("storage save failed", key, e);
  }
}
