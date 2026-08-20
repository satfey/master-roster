/**
 * Adds an explicit `storeId` alias (store.id, e.g. "1001") to a store record
 * for API responses. store.id is the canonical Store ID — the source Excel
 * ID is the primary key directly, not a UUID — so this is just a clearly
 * labeled alias for consumers that look for `storeId` specifically;
 * `id`/`storeCode` and every other column are left untouched.
 */
function withDisplayStoreId(store) {
  if (!store) return store;
  return { ...store, storeId: store.id ?? null };
}

module.exports = { withDisplayStoreId };
