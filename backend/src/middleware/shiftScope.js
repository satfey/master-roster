const supabase = require('../config/supabase');
const { failure } = require('../utils/apiResponse');
const { getAllowedStoreIds } = require('./storeScope');

/**
 * Ownership check for routes that address a single shift by id in the request body.
 *
 * storeScope cannot cover these: the request carries no storeId at all, only `shiftId`. The store
 * a shift belongs to is two hops away (shift -> roster -> store), so it has to be read here,
 * before the controller writes.
 *
 * Without this, PUT /labor was reachable by any holder of `labor:input` — which every Store
 * Manager legitimately has for their own store — against ANY shift in the chain, since
 * laborService.recordActualHours looks the shift up by id and never asks whose it is.
 *
 * Same rule as storeScope/rosterScope via getAllowedStoreIds(): null = unrestricted (ADMIN),
 * otherwise the shift's store must be one the caller may touch.
 */
async function shiftScope(req, res, next) {
  const shiftId = req.body?.shiftId;
  if (!shiftId) return failure(res, 'shiftId is required', 400);

  const allowedStoreIds = getAllowedStoreIds(req.user);
  if (allowedStoreIds === null) return next(); // ADMIN — unrestricted

  const { data: shift, error: shiftError } = await supabase.from('shift').select('roster_id').eq('id', shiftId).maybeSingle();
  if (shiftError) return next(shiftError);
  if (!shift) return failure(res, 'Shift not found', 404);

  const { data: roster, error: rosterError } = await supabase.from('roster').select('store_id').eq('id', shift.roster_id).maybeSingle();
  if (rosterError) return next(rosterError);
  // A shift whose roster is missing has no resolvable owner, so it cannot be shown to belong to
  // this caller — refuse rather than fall through to the controller.
  if (!roster) return failure(res, 'Shift not found', 404);

  if (!allowedStoreIds.includes(roster.store_id)) {
    return failure(res, 'You can only access your own store', 403);
  }

  return next();
}

module.exports = { shiftScope };
