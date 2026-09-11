const supabase = require('../config/supabase');
const { failure } = require('../utils/apiResponse');
const { getAllowedStoreIds } = require('./storeScope');

/**
 * Ownership check for the employee routes addressed by employee id (/employee/:id).
 *
 * storeScope cannot be used here: it resolves its target from `req.params.id` first, and on these
 * routes that is the EMPLOYEE id, so it would compare an employee id against the caller's store
 * and reject everything. The employee's store is only knowable by reading the employee.
 *
 * Two separate checks, because employeeController.update takes `storeId` in the body and writes it
 * straight to the row — so the request can MOVE an employee:
 *   1. the employee's current store must be one the caller may touch, and
 *   2. the destination store, when one is given, must be too.
 * Checking only (1) would let a manager transfer their own staff into any store in the chain;
 * checking only (2) would let them pull another store's staff into their own.
 */
async function employeeScope(req, res, next) {
  const employeeId = req.params.id;
  if (!employeeId) return failure(res, 'Employee id is required', 400);

  const allowedStoreIds = getAllowedStoreIds(req.user);
  if (allowedStoreIds === null) return next(); // ADMIN — unrestricted

  const { data: employee, error } = await supabase.from('employee').select('store_id').eq('id', employeeId).maybeSingle();
  if (error) return next(error);
  if (!employee) return failure(res, 'Employee not found', 404);

  if (!allowedStoreIds.includes(employee.store_id)) {
    return failure(res, 'You can only access your own store', 403);
  }

  const destinationStoreId = req.body?.storeId;
  if (destinationStoreId && !allowedStoreIds.includes(destinationStoreId)) {
    return failure(res, 'You can only move an employee to your own store', 403);
  }

  return next();
}

module.exports = { employeeScope };
