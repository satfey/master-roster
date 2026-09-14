const { redact } = require('./redact');

/**
 * NOTE: the new ERD (master_roster_erd.html) does not include an
 * ActivityLog table, so there is nowhere to persist these events yet.
 * For now this just logs to the console so nothing breaks; add an
 * `activity_log` table back to the schema if you want persisted audit
 * trails again (the original MySQL-based schema had one — see git history
 * / the previous docs/DatabaseDesign.md if needed).
 */
async function logActivity({ userId, action, storeId = null, details = null }) {
  // `details` is whatever the calling controller passed — in at least one case an entire request
  // body. Redacting here rather than at each call site means a new caller cannot leak by accident.
  console.log('[activity]', { userId, action, storeId, details: redact(details), at: new Date().toISOString() });
}

module.exports = { logActivity };
