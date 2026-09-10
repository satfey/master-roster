import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { PERMISSIONS } from '../config/permissions';
import { canAccessStore, getStoresForUser } from '../services/storeService';

/** Sentinel for "no single store selected" — the all-store overview. */
export const ALL_STORES = 'ALL';

export const StoreScopeContext = createContext(null);

/**
 * Which store the app is currently looking at.
 *
 * The list of stores comes from the session (storeService), never from the
 * URL or a free-text field, and every change goes through canAccessStore — so
 * an Area Coach can only ever land on a store inside their own area and a
 * Store Manager is pinned to their own store.
 */
export function StoreScopeProvider({ children }) {
  const { user, permissions } = useAuth();
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState(null);
  const [loading, setLoading] = useState(true);

  const canViewManyStores =
    permissions.includes(PERMISSIONS.VIEW_ALL_STORES) ||
    permissions.includes(PERMISSIONS.VIEW_AREA_STORES);

  useEffect(() => {
    let active = true;
    if (!user) {
      setStores([]);
      setStoreId(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    getStoresForUser(user)
      .then((list) => {
        if (!active) return;
        setStores(list);
        // Every role opens on a real store, so every account sees the same real
        // roster grid. Admin and Area Coach can still switch to the all-store view
        // from the context bar, but they no longer LAND on it — that view is still
        // mock data, and defaulting to it meant those accounts never saw the real
        // schedule at all.
        setStoreId(list[0]?.id ?? user.storeId ?? null);
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [user, canViewManyStores]);

  /** Returns false when the store is outside the session's scope. */
  const selectStore = useCallback(
    (nextStoreId) => {
      if (nextStoreId === ALL_STORES) {
        if (!canViewManyStores) return false;
        setStoreId(ALL_STORES);
        return true;
      }
      if (!canAccessStore(user, nextStoreId)) return false;
      setStoreId(nextStoreId);
      return true;
    },
    [user, canViewManyStores]
  );

  const value = useMemo(() => {
    const isAllStores = storeId === ALL_STORES;
    return {
      stores,
      storeId,
      /** null while the all-store view is active — safe to pass to services. */
      selectedStoreId: isAllStores ? null : storeId,
      selectedStore: isAllStores ? null : stores.find((s) => s.id === storeId) ?? null,
      isAllStores,
      canViewManyStores,
      loading,
      selectStore
    };
  }, [stores, storeId, canViewManyStores, loading, selectStore]);

  return <StoreScopeContext.Provider value={value}>{children}</StoreScopeContext.Provider>;
}
