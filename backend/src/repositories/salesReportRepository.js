const supabase = require('../config/supabase');

function recordKey(storeId, date) {
  const iso = date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
  return `${storeId}|${iso}`;
}

/** Looks up stores by the report's "Store Id" column (integer in Excel), matched against store.storeCode (VARCHAR(4)). */
async function findStoresByCodes(codes) {
  if (!codes.length) return new Map();
  const { data: stores, error } = await supabase.from('store').select('*').in('storeCode', codes);
  if (error) throw error;
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

async function getSalesReportSourceType() {
  const { data: sourceType, error } = await supabase
    .from('sales_source_type')
    .upsert({ name: 'SALES_REPORT_IMPORT' }, { onConflict: 'name' })
    .select()
    .single();
  if (error) throw error;
  return sourceType;
}

/** Returns a Set of "storeId|YYYY-MM-DD" keys already present in sales_report, for duplicate detection. */
async function findExistingReportKeys(storeIds, dates) {
  if (!storeIds.length || !dates.length) return new Set();

  const timestamps = dates.map((d) => d.getTime());
  const fromDate = new Date(Math.min(...timestamps)).toISOString().slice(0, 10);
  const toDate = new Date(Math.max(...timestamps)).toISOString().slice(0, 10);

  const { data: existing, error } = await supabase
    .from('sales_report')
    .select('store_id, report_date')
    .in('store_id', storeIds)
    .gte('report_date', fromDate)
    .lte('report_date', toDate);
  if (error) throw error;

  return new Set(existing.map((r) => recordKey(r.store_id, r.report_date)));
}

async function insertRecords(records) {
  if (!records.length) return 0;
  const { data, error } = await supabase.from('sales_report').insert(records).select();
  if (error) throw error;
  return data.length;
}

module.exports = { findStoresByCodes, createStores, getSalesReportSourceType, findExistingReportKeys, insertRecords, recordKey };
