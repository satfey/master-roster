const supabase = require('../config/supabase');
const { runInBatches, DEFAULT_BATCH_SIZE } = require('../utils/batchQuery');

function recordKey(storeId, month, hour) {
  const iso = month instanceof Date ? month.toISOString().slice(0, 10) : String(month).slice(0, 10);
  return `${storeId}|${iso}|${hour}`;
}

/**
 * Looks up stores by the report's "Store Id" column (integer in Excel),
 * matched against store.storeCode (VARCHAR). Batched — a full report can
 * reference hundreds/thousands of distinct stores, and a single
 * `.in('storeCode', codes)` request would otherwise build a request URL long
 * enough to exceed PostgREST's ~16KB header limit (UND_ERR_HEADERS_OVERFLOW).
 */
async function findStoresByCodes(codes) {
  if (!codes.length) return new Map();
  console.log('[sales-by-hour] lookup:', { table: 'store', column: 'storeCode', filterCount: codes.length, batchSize: DEFAULT_BATCH_SIZE });
  const stores = await runInBatches(codes, (batch) => supabase.from('store').select('*').in('storeCode', batch));
  return new Map(stores.map((s) => [s.storeCode, s]));
}

/**
 * Auto-creates stores referenced by the report but not yet in `store`.
 * `newStores` must already be de-duplicated by storeCode by the caller — this
 * does one bulk insert, not one per row, so a Store ID repeated across many
 * rows in the same file only ever creates a single store.
 */
async function createStores(newStores) {
  if (!newStores.length) return [];
  const { data, error } = await supabase
    .from('store')
    .insert(newStores.map((s) => ({ name: s.name, storeCode: s.storeCode, region: null, area_coach_id: null })))
    .select();
  if (error) throw error;
  return data;
}

async function getSalesByHourSourceType() {
  const { data: sourceType, error } = await supabase
    .from('sales_source_type')
    .upsert({ name: 'SALES_BY_HOUR_IMPORT' }, { onConflict: 'name' })
    .select()
    .single();
  if (error) throw error;
  return sourceType;
}

/**
 * Returns a Set of "storeId|YYYY-MM-DD|hour" keys already present in
 * sales_by_hour, for duplicate detection. Batched — see findStoresByCodes
 * above; store_id here is a list of UUIDs (36 chars each), which hits the
 * URL-length limit even sooner than storeCode strings do. This is the
 * query that produced the reported ~21,944-character URL: a report
 * referencing hundreds of distinct stores puts all of their UUIDs into one
 * `.in('store_id', [...])` filter.
 */
async function findExistingRecordKeys(storeIds, reportMonth) {
  if (!storeIds.length) return new Set();

  console.log('[sales-by-hour] lookup:', { table: 'sales_by_hour', column: 'store_id', filterCount: storeIds.length, batchSize: DEFAULT_BATCH_SIZE });
  const existing = await runInBatches(storeIds, (batch) =>
    supabase.from('sales_by_hour').select('store_id, report_month, hour').in('store_id', batch).eq('report_month', reportMonth),
  );

  return new Set(existing.map((r) => recordKey(r.store_id, r.report_month, r.hour)));
}

async function insertRecords(records) {
  if (!records.length) return 0;
  const { data, error } = await supabase.from('sales_by_hour').insert(records).select();
  if (error) throw error;
  return data.length;
}

module.exports = { findStoresByCodes, createStores, getSalesByHourSourceType, findExistingRecordKeys, insertRecords, recordKey };
