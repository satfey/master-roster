const supabase = require('../config/supabase');
const { success, failure } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');
const { normalizeStoreId } = require('../services/salesImport/transform');
const { EMPLOYEE_PUBLIC_COLUMNS } = require('../utils/employeeFields');
const { employeeIdKey, employeeIdCandidates } = require('../utils/employeeId');

/** Postgres foreign_key_violation — raised when a delete would orphan rows that reference this one. */
const FOREIGN_KEY_VIOLATION = '23503';

const MAX_WEEKLY_HOURS = 48;

/**
 * The generator only schedules an employee whose position_time_type starts with "full" or "part"
 * (employeeShiftRules.employeeShiftType); anything else is silently excluded from every roster.
 * So the type is required and stored in the same spelling the Employee Master import uses.
 */
function canonicalTimeType(value) {
  const t = String(value ?? '').trim().toLowerCase();
  if (t.startsWith('full')) return 'Full time';
  if (t.startsWith('part')) return 'Part time';
  return null;
}

/** undefined = not supplied; null = explicitly cleared; NaN = supplied but invalid. */
function parseWeeklyHours(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= MAX_WEEKLY_HOURS ? n : NaN;
}

/** undefined = not supplied; blank strings become null rather than being stored as "". */
function textOrNull(value) {
  if (value === undefined) return undefined;
  const s = String(value ?? '').trim();
  return s === '' ? null : s;
}

async function list(req, res) {
  const { storeId } = req.query;
  const { data: employees, error } = await supabase
    .from('employee')
    // Never `*`: that includes each person's pay_rate_type and sl_comp_*/hr_comp_* amounts.
    .select(EMPLOYEE_PUBLIC_COLUMNS)
    .eq('store_id', storeId)
    .eq('is_active', true)
    .order('last_name', { ascending: true });
  if (error) throw error;
  return success(res, employees);
}

/**
 * Adds one employee to a store from the Staff Management screen.
 *
 * employee.id has no generated default — it IS the business Employee ID, so it must be supplied.
 *
 * Before inserting, the ID is matched against what is already stored IGNORING leading zeros (see
 * utils/employeeId.js), because the same person arriving as "106922" and "00106922" is exactly how
 * stores ended up with every employee twice:
 *   - a match in the same store that was previously removed (is_active = false) is brought back
 *     and updated, rather than creating a second row beside their roster history;
 *   - any other match is a 409 — never a silent duplicate.
 */
async function create(req, res) {
  const { employeeId, storeId } = req.body;
  const id = normalizeStoreId(employeeId);
  if (id === null) return failure(res, 'employeeId is required', 400);
  if (!storeId) return failure(res, 'storeId is required', 400);

  const positionTimeType = canonicalTimeType(req.body.positionTimeType);
  if (!positionTimeType) return failure(res, "positionTimeType must be 'Full time' or 'Part time'", 400);

  const weeklyHours = parseWeeklyHours(req.body.defaultWeeklyHours);
  if (Number.isNaN(weeklyHours)) return failure(res, `defaultWeeklyHours must be a number between 1 and ${MAX_WEEKLY_HOURS}`, 400);

  const record = {
    first_name: textOrNull(req.body.firstName) ?? null,
    last_name: textOrNull(req.body.lastName) ?? null,
    first_name_local: textOrNull(req.body.firstNameLocal) ?? null,
    last_name_local: textOrNull(req.body.lastNameLocal) ?? null,
    position: textOrNull(req.body.position) ?? null,
    position_time_type: positionTimeType,
    ...(weeklyHours !== undefined ? { default_weekly_hours: weeklyHours } : {}),
  };
  if (!record.first_name && !record.first_name_local) return failure(res, 'firstName (or firstNameLocal) is required', 400);

  const { data: existing, error: lookupError } = await supabase
    .from('employee')
    .select('id, store_id, is_active')
    .in('id', employeeIdCandidates(id));
  if (lookupError) throw lookupError;
  const match = (existing || []).find((e) => employeeIdKey(e.id) === employeeIdKey(id));

  if (match) {
    const sameStore = String(match.store_id) === String(storeId);
    if (sameStore && !match.is_active) {
      const { data: employee, error } = await supabase
        .from('employee')
        .update({ ...record, is_active: true, updated_at: new Date().toISOString() })
        .eq('id', match.id)
        .select(EMPLOYEE_PUBLIC_COLUMNS)
        .single();
      if (error) throw error;
      await logActivity({ userId: req.user.id, action: 'REACTIVATE_EMPLOYEE', storeId: employee.store_id, details: { employeeId: match.id } });
      return success(res, employee, 'Employee re-activated');
    }
    // Deliberately does not name the other store: a Store Manager is not entitled to learn where
    // someone else's employee works.
    return failure(res, sameStore ? `Employee ID ${match.id} already exists in this store` : `Employee ID ${id} already exists in another store`, 409);
  }

  const { data: employee, error } = await supabase
    .from('employee')
    .insert({ id, store_id: storeId, is_active: true, ...record })
    .select(EMPLOYEE_PUBLIC_COLUMNS)
    .single();
  if (error) throw error;
  await logActivity({ userId: req.user.id, action: 'CREATE_EMPLOYEE', storeId: employee.store_id, details: { employeeId: employee.id } });
  return success(res, employee, 'Employee created', 201);
}

/**
 * Partial update: only the fields actually sent are written. Previously every column was written
 * from the body, so a request that sent only one field set the others to undefined.
 */
async function update(req, res) {
  const { id } = req.params;
  const patch = {};

  const textFields = { firstName: 'first_name', lastName: 'last_name', firstNameLocal: 'first_name_local', lastNameLocal: 'last_name_local', position: 'position' };
  for (const [bodyKey, column] of Object.entries(textFields)) {
    if (req.body[bodyKey] !== undefined) patch[column] = textOrNull(req.body[bodyKey]);
  }
  if (req.body.storeId !== undefined) patch.store_id = req.body.storeId;
  if (req.body.isActive !== undefined) patch.is_active = Boolean(req.body.isActive);
  if (req.body.positionTimeType !== undefined) {
    const positionTimeType = canonicalTimeType(req.body.positionTimeType);
    if (!positionTimeType) return failure(res, "positionTimeType must be 'Full time' or 'Part time'", 400);
    patch.position_time_type = positionTimeType;
  }
  if (req.body.defaultWeeklyHours !== undefined) {
    const weeklyHours = parseWeeklyHours(req.body.defaultWeeklyHours);
    if (Number.isNaN(weeklyHours)) return failure(res, `defaultWeeklyHours must be a number between 1 and ${MAX_WEEKLY_HOURS}`, 400);
    patch.default_weekly_hours = weeklyHours;
  }
  if (Object.keys(patch).length === 0) return failure(res, 'Nothing to update', 400);
  patch.updated_at = new Date().toISOString();

  const { data: employee, error } = await supabase
    .from('employee')
    .update(patch)
    .eq('id', id)
    .select(EMPLOYEE_PUBLIC_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!employee) return failure(res, 'Employee not found', 404);
  // Field names only. The body carries a person's name and posting; the log needs to say what
  // was touched, not to keep a second copy of the record.
  await logActivity({ userId: req.user.id, action: 'UPDATE_EMPLOYEE', storeId: employee.store_id, details: { employeeId: id, changedFields: Object.keys(req.body) } });
  return success(res, employee, 'Employee updated');
}

/**
 * Removes an employee from the store.
 *
 * The row is DELETED from the database. The one exception is an employee who already has shifts:
 * shift.employee_id references employee with ON DELETE RESTRICT, so the database refuses, and it
 * should — deleting them would mean deleting past rosters and actual hours. That employee is
 * deactivated instead: they disappear from the staff list and from every future generation, and
 * their history stays intact. The response says which of the two happened, and how many of their
 * shifts are still in the future so the screen can prompt a regenerate.
 */
async function remove(req, res) {
  const { id } = req.params;

  const { data: deleted, error } = await supabase.from('employee').delete().eq('id', id).select('id, store_id');
  if (!error) {
    if (!deleted || deleted.length === 0) return failure(res, 'Employee not found', 404);
    await logActivity({ userId: req.user.id, action: 'DELETE_EMPLOYEE', storeId: deleted[0].store_id, details: { employeeId: id } });
    return success(res, { id, deleted: true, deactivated: false, futureShiftCount: 0 }, 'Employee deleted');
  }
  if (error.code !== FOREIGN_KEY_VIOLATION) throw error;

  const { data: employee, error: deactivateError } = await supabase
    .from('employee')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, store_id')
    .maybeSingle();
  if (deactivateError) throw deactivateError;
  if (!employee) return failure(res, 'Employee not found', 404);

  const today = new Date().toISOString().slice(0, 10);
  const { count, error: countError } = await supabase
    .from('shift')
    .select('id', { count: 'exact', head: true })
    .eq('employee_id', id)
    .gte('shift_date', today);
  if (countError) throw countError;

  await logActivity({ userId: req.user.id, action: 'DEACTIVATE_EMPLOYEE', storeId: employee.store_id, details: { employeeId: id, reason: 'has shift history' } });
  return success(
    res,
    { id, deleted: false, deactivated: true, futureShiftCount: count ?? 0 },
    'Employee has roster history, so it was deactivated instead of deleted'
  );
}

module.exports = { list, create, update, remove };
