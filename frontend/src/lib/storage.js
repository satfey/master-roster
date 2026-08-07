// Simple localStorage-backed key/value store.
// (This project runs as a normal standalone web app, so plain
// localStorage is fine here — unlike inside a Claude.ai artifact.)

const PREFIX = "master-roster:";

export async function loadKey(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

export async function saveKey(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.error("storage save failed", key, e);
  }
}
