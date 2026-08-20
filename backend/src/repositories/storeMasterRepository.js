const supabase = require('../config/supabase');

/**
 * All `area_coach` rows, keyed by normalized name for matching against the
 * Excel "Zone Update" column. store.area_coach_id is a foreign key straight
 * to area_coach.id (constraint fk_store_area_coach) — Area Coaches are their
 * own entity here, not a role on `users`. A name matching more than one row
 * is intentionally left as an array — the caller decides how to handle
 * ambiguity.
 */
async function findAreaCoachesByName() {
  const { data: areaCoaches, error } = await supabase.from('area_coach').select('id, name');
  if (error) throw error;

  const byName = new Map();
  for (const coach of areaCoaches) {
    const key = String(coach.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(coach);
  }
  return byName;
}

/**
 * Auto-creates area_coach rows referenced by the Store Master file but not
 * yet in `area_coach`. The Excel file is the only source of truth for Area
 * Coach names — none are ever hard-coded here. `names` must already be
 * de-duplicated by normalized name by the caller — this does one bulk
 * insert, not one per row, so a name repeated across many rows in the same
 * file only ever creates a single area_coach.
 */
async function createAreaCoaches(names) {
  if (!names.length) return [];
  const { data, error } = await supabase.from('area_coach').insert(names.map((name) => ({ name }))).select();
  if (error) throw error;
  return data;
}

/** Looks up stores by the report's "ID" column — the Excel Store ID is store.id itself now (store.storeCode is kept only as a non-canonical compatibility column). */
async function findStoresByCodes(codes) {
  if (!codes.length) return new Map();
  const { data: stores, error } = await supabase.from('store').select('*').in('id', codes);
  if (error) throw error;
  return new Map(stores.map((s) => [s.id, s]));
}

/** Bulk-inserts new stores. The Excel Store ID becomes store.id directly — never a generated UUID. region has no source column in this report, so it is left NULL. */
async function createStores(newStores) {
  if (!newStores.length) return [];
  const { data, error } = await supabase
    .from('store')
    .insert(newStores.map((s) => ({ id: s.storeCode, name: s.name, storeCode: s.storeCode, area_coach_id: s.areaCoachId, region: null })))
    .select();
  if (error) throw error;
  return data;
}

/**
 * Updates name/area_coach_id on existing stores by id. One explicit UPDATE
 * per store (rather than a bulk upsert) so storeCode/region/id are never at
 * risk of being touched by the write.
 */
async function updateStores(updates) {
  const results = [];
  for (const u of updates) {
    const { data, error } = await supabase
      .from('store')
      .update({ name: u.name, area_coach_id: u.areaCoachId })
      .eq('id', u.id)
      .select()
      .single();
    if (error) throw error;
    results.push(data);
  }
  return results;
}

module.exports = { findAreaCoachesByName, createAreaCoaches, findStoresByCodes, createStores, updateStores };
