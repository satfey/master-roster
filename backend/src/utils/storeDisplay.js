/**
 * Adds a business-facing `storeId` (store.storeCode, e.g. "1001") to a store
 * record for API responses. `id` (the UUID primary key) and every other
 * column are left untouched, so anything that still needs the internal UUID
 * — other backend queries, a frontend that already stores it for a PUT/DELETE
 * — keeps working exactly as before. Only the outward-facing label changes.
 */
function withDisplayStoreId(store) {
  if (!store) return store;
  return { ...store, storeId: store.storeCode ?? null };
}

module.exports = { withDisplayStoreId };
