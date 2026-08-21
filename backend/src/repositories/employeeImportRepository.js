const supabase = require('../config/supabase');
const { runInBatches } = require('../utils/batchQuery');

/**
 * Fetches every store for in-memory Location resolution (by store.id or
 * store.name — the Employee Master "Location" column isn't guaranteed to
 * hold one or the other, see employeeImportService). The store table is a
 * few hundred rows, so one full fetch is simpler and safer than guessing
 * which of id/name to filter by and batching accordingly.
 */
async function findAllStores() {
  const { data, error } = await supabase.from('store').select('id, name');
  if (error) throw error;
  return data;
}

/**
 * Looks up existing employees by id — the Excel Employee ID IS employee.id
 * directly (no separate internal UUID), used for upsert/duplicate
 * detection. Batched: a full Employee Master file can reference
 * hundreds/thousands of distinct Employee IDs, and a single
 * `.in('id', ids)` request would otherwise build a request URL long enough
 * to exceed PostgREST's ~16KB header limit (UND_ERR_HEADERS_OVERFLOW).
 */
async function findEmployeesByIds(ids) {
  if (!ids.length) return new Map();
  const employees = await runInBatches(ids, (batch) => supabase.from('employee').select('*').in('id', batch));
  return new Map(employees.map((e) => [e.id, e]));
}

/** Bulk-inserts new employees. The Excel Employee ID becomes employee.id directly — never a generated UUID. */
async function createEmployees(records) {
  if (!records.length) return [];
  const { data, error } = await supabase.from('employee').insert(records).select();
  if (error) throw error;
  return data;
}

/** One explicit UPDATE per employee (matches the pattern used by every other importer this session) — `id` itself is never touched by the update payload, only matched on. */
async function updateEmployees(updates) {
  const results = [];
  for (const u of updates) {
    const { id, ...fields } = u;
    const { data, error } = await supabase.from('employee').update(fields).eq('id', id).select().single();
    if (error) throw error;
    results.push(data);
  }
  return results;
}

module.exports = { findAllStores, findEmployeesByIds, createEmployees, updateEmployees };
