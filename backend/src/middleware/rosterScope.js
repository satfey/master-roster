const supabase = require('../config/supabase');
const { failure } = require('../utils/apiResponse');
const { getAllowedStoreIds } = require('./storeScope');

/**
 * Ownership check for the roster routes addressed by roster id (/roster/:id).
 *
 * storeScope can't be used on these: it resolves its target from
 * `req.params.id || req.params.storeId || req.query.storeId || req.body.storeId`, and on these
 * routes `req.params.id` is the ROSTER id, not a store id — it would compare a roster UUID against
 * the user's store and reject every request. The store a roster belongs to is only knowable by
 * reading the roster, so that lookup happens here, before the controller runs.
 *
 * This must stay ahead of the controller rather than inside it: rosterController.update and
 * .remove both write immediately (UPDATE roster / DELETE shift) with no ownership check of their
 * own, so a check performed after the fact would already have mutated another store's roster.
 *
 * Mirrors storeScope's rule via the same getAllowedStoreIds(): null = unrestricted
 * (ADMIN/EXECUTIVE), otherwise the roster's store must be one the caller is allowed to touch.
 */
async function rosterScope(req, res, next) {
  const rosterId = req.params.id;
  if (!rosterId) return failure(res, 'Roster id is required', 400);

  const allowedStoreIds = getAllowedStoreIds(req.user);
  if (allowedStoreIds === null) return next(); // ADMIN / EXECUTIVE — unrestricted

  const { data: roster, error } = await supabase.from('roster').select('store_id').eq('id', rosterId).maybeSingle();
  if (error) return next(error);

  // Same 404 the controller itself would return for an unknown id.
  if (!roster) return failure(res, 'Roster not found', 404);

  // A roster that exists but belongs to another store answers 403, not 404 — the same message
  // storeScope gives, so a legitimate user gets a straight answer instead of a confusing "not
  // found". This does tell a caller that some roster id exists somewhere in the chain; that's an
  // accepted trade for a clear message, given roster ids are unguessable UUIDs. Switch this to the
  // 404 above if that ever needs to be hidden too.
  if (!allowedStoreIds.includes(roster.store_id)) {
    return failure(res, 'You can only access your own store', 403);
  }

  return next();
}

module.exports = { rosterScope };
