const supabase = require('../config/supabase');

function recordKey(storeId, date) {
  const iso = date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
  return `${storeId}|${iso}`;
}

/** Looks up stores by their Excel "CODE" column value — store.id IS the canonical Store ID (store.code does not exist as a column). Returns a Map keyed by store id. */
async function findStoresByCodes(codes) {
  if (!codes.length) return new Map();
  const { data: stores, error } = await supabase.from('store').select('*').in('id', codes);
  if (error) throw error;
  return new Map(stores.map((s) => [s.id, s]));
}

async function getExcelSourceType() {
  const { data: sourceType, error } = await supabase
    .from('sales_source_type')
    .upsert({ name: 'EXCEL_IMPORT' }, { onConflict: 'name' })
    .select()
    .single();
  if (error) throw error;
  return sourceType;
}

/** Returns a Set of "storeId|YYYY-MM-DD" keys already present in sales_record, for duplicate detection. */
async function findExistingRecordKeys(storeIds, dates) {
  if (!storeIds.length || !dates.length) return new Set();

  const timestamps = dates.map((d) => d.getTime());
  const fromDate = new Date(Math.min(...timestamps)).toISOString().slice(0, 10);
  const toDate = new Date(Math.max(...timestamps)).toISOString().slice(0, 10);

  const { data: existing, error } = await supabase
    .from('sales_record')
    .select('store_id, sales_date')
    .in('store_id', storeIds)
    .gte('sales_date', fromDate)
    .lte('sales_date', toDate);
  if (error) throw error;

  return new Set(existing.map((r) => recordKey(r.store_id, r.sales_date)));
}

async function insertRecords(records) {
  if (!records.length) return 0;
  const { data, error } = await supabase.from('sales_record').insert(records).select();
  if (error) throw error;
  return data.length;
}

module.exports = { findStoresByCodes, getExcelSourceType, findExistingRecordKeys, insertRecords, recordKey };
