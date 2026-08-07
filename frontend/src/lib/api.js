// Thin client for the backend REST API (Express + Prisma).
// The rest of this app currently persists to localStorage only (see storage.js);
// this is the first module that actually talks to the backend.

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

async function parseResponse(res) {
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new Error(body?.message || `Request failed (${res.status})`);
  }
  return body.data;
}

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  return parseResponse(res);
}

export async function apiPost(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseResponse(res);
}

/**
 * Uploads a file as multipart/form-data with upload progress, via XHR
 * (fetch has no cross-browser upload progress event).
 */
export function uploadFile(path, file, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}${path}`);

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
      if (xhr.status >= 200 && xhr.status < 300 && body?.success) {
        resolve(body.data);
      } else {
        reject(new Error(body?.message || `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading file"));

    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
