const supabase = require('../config/supabase');
const { success } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

async function list(req, res) {
  const { storeId } = req.query;
  const { data: employees, error } = await supabase
    .from('employee')
    .select('*')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .order('full_name', { ascending: true });
  if (error) throw error;
  return success(res, employees);
}

async function create(req, res) {
  const { storeId, fullName, position, hourlyRate, isActive } = req.body;
  const { data: employee, error } = await supabase
    .from('employee')
    .insert({ store_id: storeId, full_name: fullName, position, hourly_rate: hourlyRate, is_active: isActive })
    .select()
    .single();
  if (error) throw error;
  await logActivity({ userId: req.user.id, action: 'CREATE_EMPLOYEE', storeId: employee.store_id, details: employee });
  return success(res, employee, 'Employee created', 201);
}

async function update(req, res) {
  const { id } = req.params;
  const { storeId, fullName, position, hourlyRate, isActive } = req.body;
  const { data: employee, error } = await supabase
    .from('employee')
    .update({ store_id: storeId, full_name: fullName, position, hourly_rate: hourlyRate, is_active: isActive })
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
    .update({ is_active: false })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  await logActivity({ userId: req.user.id, action: 'DEACTIVATE_EMPLOYEE', storeId: employee.store_id });
  return success(res, null, 'Employee deactivated');
}

module.exports = { list, create, update, remove };
