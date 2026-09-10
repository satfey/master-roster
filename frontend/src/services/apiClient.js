// This shell originally shipped an axios instance here with a placeholder
// baseURL ("swap it for the real API when it exists"). The real API does exist,
// and the app already has a working client for it — lib/api.js — which attaches
// the JWT, unwraps the backend's { success, message, data } envelope, and hands
// 401s to the session layer. Running axios alongside it would mean two HTTP
// stacks with two different auth and error behaviours, so this module now just
// re-exports the real one.

export { apiGet, apiPost } from '../lib/api.js';

/**
 * Simulated latency, kept only for the pages of this shell that still render
 * mock data. Real API calls have real latency and must never use this — when
 * the last mock page is wired up, this export goes away with it.
 */
export const delay = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));
