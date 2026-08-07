const supabase = require('../config/supabase');
const { success, failure } = require('../utils/apiResponse');
const { getAllowedStoreIds } = require('../middleware/storeScope');

async function list(req, res) {
  const allowedStoreIds = getAllowedStoreIds(req.user);
  let query = supabase.from('store').select('*').order('name', { ascending: true });
  if (allowedStoreIds) query = query.in('id', allowedStoreIds);
  const { data: stores, error } = await query;
  if (error) throw error;
  return success(res, stores);
}

async function getOne(req, res) {
  const { id } = req.params;
  const { data: store, error } = await supabase
    .from('store')
    .select('*, employee(*), labor_guideline(*), area_coach:users!fk_store_area_coach(*)')
    .eq('employee.is_active', true)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!store) return failure(res, 'Store not found', 404);
  return success(res, store);
}

async function create(req, res) {
  const { name, region, areaCoachId } = req.body;
  const { data: store, error } = await supabase
    .from('store')
    .insert({ name, region, area_coach_id: areaCoachId || null })
    .select()
    .single();
  if (error) throw error;
  return success(res, store, 'Store created', 201);
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
  return success(res, store, 'Store updated');
}

async function upsertGuideline(req, res) {
  const { id } = req.params; // storeId
  const { targetProductivity, targetColPercent, minStaffPerShift } = req.body;

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
  };

  const { data: guideline, error } = existing
    ? await supabase.from('labor_guideline').update(payload).eq('id', existing.id).select().single()
    : await supabase.from('labor_guideline').insert({ store_id: id, ...payload }).select().single();
  if (error) throw error;

  return success(res, guideline, 'Labor guideline updated');
}

module.exports = { list, getOne, create, update, upsertGuideline };
