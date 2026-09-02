// Thin client for the backend REST API (Express + Supabase).
// The rest of this app currently persists to localStorage only (see storage.js);
// this is the first module that actually talks to the backend.

import { getToken, notifyUnauthorized } from "./tokenStore.js";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

function authHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseResponse(res, hadToken) {
  const body = await res.json().catch(() => null);
  // Only treat a 401 as "the session died" when we actually sent a token —
  // an unauthenticated call (e.g. the login request itself) getting a 401
  // is just a normal "invalid credentials" error for the caller to show,
  // not a reason to clear a token that was never there and bounce to login.
  if (res.status === 401 && hadToken) {
    notifyUnauthorized();
  }
  if (!res.ok || !body?.success) {
    throw new Error(body?.message || `Request failed (${res.status})`);
  }
  return body.data;
}

export async function apiGet(path) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, { headers: { ...authHeader() } });
  return parseResponse(res, !!token);
}

export async function apiPost(path, data) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(data),
  });
  return parseResponse(res, !!token);
}

/**
 * Uploads a file as multipart/form-data with upload progress, via XHR
 * (fetch has no cross-browser upload progress event). `fields` adds extra
 * form fields alongside the file — e.g. Sales-by-Hour's required `month`.
 */
export function uploadFile(path, file, { onProgress, fields = {} } = {}) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}${path}`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch (e) {
        // fall through to the generic error below
      }
      if (xhr.status === 401 && token) notifyUnauthorized();
      if (xhr.status >= 200 && xhr.status < 300 && body?.success) {
        resolve(body.data);
      } else {
        reject(new Error(body?.message || `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading file"));

    const form = new FormData();
    form.append("file", file);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    xhr.send(form);
  });
}
