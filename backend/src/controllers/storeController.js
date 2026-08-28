const supabase = require('../config/supabase');
const { success, failure } = require('../utils/apiResponse');
const { getAllowedStoreIds } = require('../middleware/storeScope');
const { withDisplayStoreId } = require('../utils/storeDisplay');
const { normalizeStoreId } = require('../services/salesImport/transform');

async function list(req, res) {
  const allowedStoreIds = getAllowedStoreIds(req.user);
  let query = supabase.from('store').select('*').order('name', { ascending: true });
  if (allowedStoreIds) query = query.in('id', allowedStoreIds);
  const { data: stores, error } = await query;
  if (error) throw error;
  return success(res, stores.map(withDisplayStoreId));
}

async function getOne(req, res) {
  const { id } = req.params;
  const { data: store, error } = await supabase
    .from('store')
    .select('*, employee(*), labor_guideline(*), area_coach:area_coach!fk_store_area_coach(*)')
    .eq('employee.is_active', true)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!store) return failure(res, 'Store not found', 404);
  return success(res, withDisplayStoreId(store));
}

async function create(req, res) {
  const { storeId, name, region, areaCoachId } = req.body;

  // store.id has no auto-generated default — it IS the business Store ID,
  // so it must be supplied explicitly, never invented.
  const id = normalizeStoreId(storeId);
  if (id === null) return failure(res, 'storeId is required', 400);
  if (!name) return failure(res, 'name is required', 400);

  const { data: store, error } = await supabase
    .from('store')
    .insert({ id, name, storeCode: id, region, area_coach_id: areaCoachId || null })
    .select()
    .single();
  if (error) throw error;
  return success(res, withDisplayStoreId(store), 'Store created', 201);
}

async function update(req, res) {
  const { id } = req.params;
  const { name, region, areaCoachId } = req.body;
  const { data: store, error } = await supabase
    .from('store')
    .update({ name, region, area_coach_id: areaCoachId })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return success(res, withDisplayStoreId(store), 'Store updated');
}

async function upsertGuideline(req, res) {
  const { id } = req.params; // storeId
  const { targetProductivity, targetColPercent, minStaffPerShift, monthlyLaborHours } = req.body;

  const { data: existing, error: findError } = await supabase
    .from('labor_guideline')
    .select('id')
    .eq('store_id', id)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;

  const payload = {
    target_productivity: targetProductivity,
    target_col_percent: targetColPercent,
    min_staff_per_shift: minStaffPerShift,
    monthly_labor_hours: monthlyLaborHours, // PHASE 2: the store-level monthly labor-hour guideline (e.g. 1,000 hours/month)
  };

  const { data: guideline, error } = existing
    ? await supabase.from('labor_guideline').update(payload).eq('id', existing.id).select().single()
    : await supabase.from('labor_guideline').insert({ store_id: id, ...payload }).select().single();
  if (error) throw error;

  return success(res, guideline, 'Labor guideline updated');
}

module.exports = { list, getOne, create, update, upsertGuideline };
