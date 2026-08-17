const supabase = require('../config/supabase');

function normalizeRoleName(name) {
  return String(name || '').trim().toLowerCase().replace(/[_\s]+/g, ' ');
}

/**
 * Determines which `role` rows represent the Area Coach role by inspecting
 * role.name rather than assuming one exact spelling/casing — the live role
 * table has both "AREA_COACH" and "Area Coach" rows, and both must count.
 */
async function findAreaCoachRoleIds() {
  const { data: roles, error } = await supabase.from('role').select('id, name');
  if (error) throw error;
  return roles.filter((r) => normalizeRoleName(r.name) === 'area coach').map((r) => r.id);
}

/**
 * Active users holding an Area Coach role, keyed by normalized full_name for
 * matching against the Excel "Zone Update" column. A name matching more than
 * one user is intentionally left as an array here — the caller decides how
 * to handle ambiguity.
 */
async function findAreaCoachUsersByName() {
  const roleIds = await findAreaCoachRoleIds();
  if (!roleIds.length) return new Map();

  const { data: users, error } = await supabase
    .from('users')
    .select('id, full_name, role_id, is_active')
    .in('role_id', roleIds)
    .eq('is_active', true);
  if (error) throw error;

  const byName = new Map();
  for (const user of users) {
    const key = String(user.full_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(user);
  }
  return byName;
}

/** Looks up stores by the report's "ID" column, matched against store.storeCode (VARCHAR). */
async function findStoresByCodes(codes) {
  if (!codes.length) return new Map();
  const { data: stores, error } = await supabase.from('store').select('*').in('storeCode', codes);
  if (error) throw error;
  return new Map(stores.map((s) => [s.storeCode, s]));
}

/** Bulk-inserts new stores. region has no source column in this report, so it is left NULL; id is DB-generated. */
async function createStores(newStores) {
  if (!newStores.length) return [];
  const { data, error } = await supabase
    .from('store')
    .insert(newStores.map((s) => ({ name: s.name, storeCode: s.storeCode, area_coach_id: s.areaCoachId, region: null })))
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

module.exports = { findAreaCoachUsersByName, findStoresByCodes, createStores, updateStores };
