const supabase = require('../config/supabase');
const { runInBatches } = require('../utils/batchQuery');

function recordKey(storeId, date) {
  const iso = date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
  return `${storeId}|${iso}`;
}

/**
 * Looks up stores by the report's "Store Id" column — the Excel Store ID is
 * store.id itself now (store.storeCode is kept only as a non-canonical
 * compatibility column). Batched — a full report can reference
 * hundreds/thousands of distinct stores, and a single `.in('id', codes)`
 * request would otherwise build a request URL long enough to exceed
 * PostgREST's ~16KB header limit (UND_ERR_HEADERS_OVERFLOW).
 */
async function findStoresByCodes(codes) {
  if (!codes.length) return new Map();
  const stores = await runInBatches(codes, (batch, { from, to }) => supabase.from('store').select('*').in('id', batch).range(from, to));
  return new Map(stores.map((s) => [s.id, s]));
}

/**
 * Auto-creates stores referenced by the report but not yet in `store`. The
 * Excel Store ID becomes store.id directly — never a generated UUID.
 * `newStores` must already be de-duplicated by storeCode by the caller — this
 * does one bulk insert, not one per row, so a Store ID repeated across many
 * rows in the same file only ever creates a single store.
 */
async function createStores(newStores) {
  if (!newStores.length) return [];
  const { data, error } = await supabase
    .from('store')
    .insert(newStores.map((s) => ({ id: s.storeCode, name: s.name, storeCode: s.storeCode, region: null, area_coach_id: null })))
    .select();
  if (error) throw error;
  return data;
}

async function getSalesReportSourceType() {
  const { data: sourceType, error } = await supabase
    .from('sales_source_type')
    .upsert({ name: 'SALES_REPORT_IMPORT' }, { onConflict: 'name' })
    .select()
    .single();
  if (error) throw error;
  return sourceType;
}

/**
 * Returns a Set of "storeId|YYYY-MM-DD" keys already present in
 * sales_report, for duplicate detection. Batched — see findStoresByCodes
 * above; the store_id list here is a list of UUIDs (36 chars each), which
 * hits the same URL-length limit even sooner than storeCode strings do.
 */
async function findExistingReportKeys(storeIds, dates) {
  if (!storeIds.length || !dates.length) return new Set();

  const timestamps = dates.map((d) => d.getTime());
  const fromDate = new Date(Math.min(...timestamps)).toISOString().slice(0, 10);
  const toDate = new Date(Math.max(...timestamps)).toISOString().slice(0, 10);

  const existing = await runInBatches(storeIds, (batch, { from: rangeFrom, to: rangeTo }) =>
    supabase
      .from('sales_report')
      .select('store_id, report_date')
      .in('store_id', batch)
      .gte('report_date', fromDate)
      .lte('report_date', toDate)
      .range(rangeFrom, rangeTo),
  );

  return new Set(existing.map((r) => recordKey(r.store_id, r.report_date)));
}

/**
 * Writes sales_report rows as an atomic upsert on the (store_id, report_date)
 * unique constraint (sales_report_store_id_report_date_key): a key not yet in
 * the table is inserted, a key that already exists is overwritten in place —
 * the newly uploaded file is the source of truth, so a re-imported day
 * replaces the old one rather than being rejected as a duplicate or raising
 * a 23505 unique-violation. `id` and `created_at` are deliberately absent
 * from every record here — PostgREST's DO UPDATE SET clause only touches
 * columns present in the payload, so omitting them means the DB default
 * (gen_random_uuid() / now()) applies on insert, and the existing row's `id`
 * and original `created_at` are left completely untouched on update. A
 * single call for the whole batch, not chunked — one INSERT..ON CONFLICT
 * statement is one atomic unit in Postgres, so either every row in this
 * batch is written or (on error) none are; there is no partial-batch state
 * to roll back.
 */
async function upsertRecords(records) {
  if (!records.length) return 0;
  const { data, error } = await supabase
    .from('sales_report')
    .upsert(records, { onConflict: 'store_id,report_date' })
    .select();
  if (error) throw error;
  return data.length;
}

module.exports = { findStoresByCodes, createStores, getSalesReportSourceType, findExistingReportKeys, upsertRecords, recordKey };
