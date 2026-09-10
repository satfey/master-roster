const supabase = require('../config/supabase');
const { success, failure } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');
const { normalizeStoreId } = require('../services/salesImport/transform');

async function list(req, res) {
  const { storeId } = req.query;
  const { data: employees, error } = await supabase
    .from('employee')
    .select('*')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .order('last_name', { ascending: true });
  if (error) throw error;
  return success(res, employees);
}

async function create(req, res) {
  const { employeeId, storeId, firstName, lastName, position, isActive } = req.body;

  // employee.id has no auto-generated default — it IS the business
  // Employee ID from Excel, so it must be supplied explicitly, never
  // invented. Same string-preserving parsing used for every other
  // source-file ID (leading zeros survive exactly).
  const normalizedEmployeeId = normalizeStoreId(employeeId);
  if (normalizedEmployeeId === null) return failure(res, 'employeeId is required', 400);
  if (!storeId) return failure(res, 'storeId is required', 400);

  const { data: employee, error } = await supabase
    .from('employee')
    .insert({
      id: normalizedEmployeeId,
      store_id: storeId,
      first_name: firstName || null,
      last_name: lastName || null,
      position: position || null,
      is_active: isActive ?? true,
    })
    .select()
    .single();
  if (error) throw error;
  await logActivity({ userId: req.user.id, action: 'CREATE_EMPLOYEE', storeId: employee.store_id, details: employee });
  return success(res, employee, 'Employee created', 201);
}

async function update(req, res) {
  const { id } = req.params;
  const { storeId, firstName, lastName, position, isActive } = req.body;
  const { data: employee, error } = await supabase
    .from('employee')
    .update({
      store_id: storeId,
      first_name: firstName,
      last_name: lastName,
      position,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  await logActivity({ userId: req.user.id, action: 'UPDATE_EMPLOYEE', storeId: employee.store_id, details: req.body });
  return success(res, employee, 'Employee updated');
}

async function remove(req, res) {
  const { id } = req.params;
  const { data: employee, error } = await supabase
    .from('employee')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  await logActivity({ userId: req.user.id, action: 'DEACTIVATE_EMPLOYEE', storeId: employee.store_id });
  return success(res, null, 'Employee deactivated');
}

module.exports = { list, create, update, remove };
