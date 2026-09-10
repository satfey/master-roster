const supabase = require('../config/supabase');
const { runInBatches, chunk } = require('../utils/batchQuery');

// Rows per upsert call for the WRITE path (distinct from batchQuery's DEFAULT_BATCH_SIZE,
// which batches READS by .in() filter-value count for URL-length reasons — this batches a
// WRITE by row count, for request-size and progress-granularity reasons instead). Small
// enough that a client polling progress sees real, frequent movement; large enough that a
// 100,000-row file is ~50 requests, not thousands.
const WRITE_BATCH_SIZE = 2000;
// Concurrent in-flight upsert requests. Bounded (not "fire them all at once" like the
// read-side runInBatches) because unlike reads, writes contend with each other for the
// same rows' locks and the database's connection pool — an unbounded burst of 50 concurrent
// multi-thousand-row upserts is more likely to slow every one of them down than help.
const WRITE_CONCURRENCY = 4;

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
 * Writes sales_report rows via upserts on the (store_id, report_date) unique
 * constraint (sales_report_store_id_report_date_key): a key not yet in the
 * table is inserted, a key that already exists is overwritten in place — the
 * newly uploaded file is the source of truth, so a re-imported day replaces
 * the old one rather than being rejected as a duplicate or raising a 23505
 * unique-violation. `id` and `created_at` are deliberately absent from every
 * record here — PostgREST's DO UPDATE SET clause only touches columns
 * present in the payload, so omitting them means the DB default
 * (gen_random_uuid() / now()) applies on insert, and the existing row's `id`
 * and original `created_at` are left completely untouched on update.
 *
 * Chunked into WRITE_BATCH_SIZE-row upserts, up to WRITE_CONCURRENCY in
 * flight at once — NOT one single call for the whole file. A very large
 * import (tens/hundreds of thousands of rows) needs this two ways: real,
 * row-counted progress as each chunk lands (`onBatchComplete`, consumed by
 * salesReportImportService/importJobStore to drive the UI's progress bar —
 * see stageProgress on GET .../import/:jobId/progress), and not sending the
 * entire file as one giant request body. The previous single-call design's
 * atomicity guarantee (every row in the batch written, or on error none are)
 * is intentionally traded away here: each chunk still commits independently
 * with the usual all-or-nothing guarantee for JUST that chunk, but a failure
 * partway through the file leaves earlier chunks' rows written. This is
 * safe to retry — the upsert is idempotent per (store_id, report_date), so
 * simply re-running the same commit re-applies every row identically rather
 * than duplicating or corrupting anything already written.
 *
 * `onBatchComplete`, when given, is called after each chunk lands with
 * `{ rowsWrittenSoFar, totalRows }` — real numbers taken directly from what
 * has actually been written and awaited, never estimated/interpolated.
 */
async function upsertRecords(records, { onBatchComplete } = {}) {
  if (!records.length) return 0;

  const chunks = chunk(records, WRITE_BATCH_SIZE);
  let rowsWrittenSoFar = 0;
  let nextChunkIndex = 0;

  async function writeNextChunk() {
    while (nextChunkIndex < chunks.length) {
      const batch = chunks[nextChunkIndex++];
      const { data, error } = await supabase.from('sales_report').upsert(batch, { onConflict: 'store_id,report_date' }).select();
      if (error) throw error;
      rowsWrittenSoFar += data.length;
      if (onBatchComplete) onBatchComplete({ rowsWrittenSoFar, totalRows: records.length });
    }
  }

  await Promise.all(Array.from({ length: Math.min(WRITE_CONCURRENCY, chunks.length) }, writeNextChunk));
  return rowsWrittenSoFar;
}

module.exports = { findStoresByCodes, createStores, getSalesReportSourceType, findExistingReportKeys, upsertRecords, recordKey };
