const supabase = require('../config/supabase');
const { runInBatches } = require('../utils/batchQuery');

function recordKey(storeId, month) {
  const iso = month instanceof Date ? month.toISOString().slice(0, 10) : String(month).slice(0, 10);
  return `${storeId}|${iso}`;
}

/**
 * Looks up stores by CODE — the Excel Store ID is store.id itself (see
 * storeMasterImport's identical convention). Batched: a full WHR Target file
 * can reference hundreds of distinct stores, and a single `.in('id', codes)`
 * request would otherwise build a request URL long enough to exceed
 * PostgREST's ~16KB header limit (UND_ERR_HEADERS_OVERFLOW).
 */
async function findStoresByCodes(codes) {
  if (!codes.length) return new Map();
  const stores = await runInBatches(codes, (batch, { from, to }) => supabase.from('store').select('*').in('id', batch).range(from, to));
  return new Map(stores.map((s) => [s.id, s]));
}

async function getWhrTargetSourceType() {
  const { data: sourceType, error } = await supabase
    .from('sales_source_type')
    .upsert({ name: 'WHR_TARGET_IMPORT' }, { onConflict: 'name' })
    .select()
    .single();
  if (error) throw error;
  return sourceType;
}

/**
 * Returns a Set of "storeId|YYYY-MM-DD" keys already present in
 * whr_target_monthly, for duplicate detection. Batched — see
 * findStoresByCodes above.
 */
async function findExistingRecordKeys(storeIds, reportMonth) {
  if (!storeIds.length) return new Set();

  const existing = await runInBatches(storeIds, (batch, { from, to }) =>
    supabase.from('whr_target_monthly').select('store_id, report_month').in('store_id', batch).eq('report_month', reportMonth).range(from, to),
  );

  return new Set(existing.map((r) => recordKey(r.store_id, r.report_month)));
}

/**
 * Writes whr_target_monthly rows as an atomic upsert on the (store_id,
 * report_month) unique constraint: a key not yet in the table is inserted, a
 * key that already exists is overwritten in place — the newly uploaded file
 * is the source of truth, so re-importing the same store+month replaces the
 * old numbers rather than being rejected as a duplicate or raising a 23505
 * unique-violation (matches Sales Report / Sales-by-Hour Import's
 * convention). `id` and `created_at` are deliberately absent from every
 * record so the DB default applies on insert and the existing row's
 * original values are left untouched on update. A WHR Target file is one
 * row per store (not one row per store per day/hour like Sales Report/
 * Sales-by-Hour), so realistic file sizes are small — a single un-chunked
 * upsert is appropriate here, unlike Sales Report's chunked write.
 */
async function upsertRecords(records) {
  if (!records.length) return 0;
  const { data, error } = await supabase
    .from('whr_target_monthly')
    .upsert(records, { onConflict: 'store_id,report_month' })
    .select();
  if (error) throw error;
  return data.length;
}

module.exports = { findStoresByCodes, getWhrTargetSourceType, findExistingRecordKeys, upsertRecords, recordKey };
