// Real store scope, backed by GET /store.
//
// The backend already filters that endpoint to what the caller is allowed to
// see (storeScope.getAllowedStoreIds): every store for ADMIN/EXECUTIVE, the
// assigned ones for an AREA_COACH, exactly one for a STORE_MANAGER. So this is
// not "fetch everything then filter in the browser" — the list that arrives is
// already the permitted one, and the client-side check below is a UX guard on
// top of it, never the thing enforcing access.

import { apiGet } from '../lib/api.js';
import { allowedStoreIds } from '../lib/storeAccess.js';

/**
 * The stores this session may work with. Store scope is derived from the
 * authenticated identity server-side, never from anything the user typed.
 */
export const getStoresForUser = async (user) => {
  if (!user) return [];
  const stores = await apiGet('/store');
  return [...stores].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
};

/**
 * Guard used before a store-scoped request goes out, mirroring the backend's
 * own rule (see lib/storeAccess.js). A `null` allowed-list means unrestricted
 * (ADMIN/EXECUTIVE).
 */
export const canAccessStore = (user, storeId) => {
  if (!user || !storeId) return false;
  const allowed = allowedStoreIds(user);
  if (allowed === null) return true;
  return allowed.includes(String(storeId));
};
