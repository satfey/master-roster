// User lookups, from the real backend.
//
// GET /me is the signed-in identity (any authenticated user). GET /user is the
// full list and requires the user:manage permission, so it is only used where an
// Admin screen genuinely needs it — a profile lookup must never depend on it.

import { apiGet } from '../lib/api.js';

/**
 * The signed-in user's own profile. Always read from GET /me rather than
 * searching a list, so it works for every role and always reflects the current
 * role/store the backend holds.
 */
export const getProfile = async () => {
  try {
    return await apiGet('/me');
  } catch {
    return null;
  }
};

/** Every user, for Admin screens. Requires user:manage; returns [] otherwise. */
export const listUsers = async () => {
  try {
    return await apiGet('/user');
  } catch {
    return [];
  }
};
