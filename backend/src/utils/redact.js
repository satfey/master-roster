/**
 * Strips sensitive values out of anything on its way to a log.
 *
 * Server logs are not a private place: on a hosted platform they are visible to everyone with
 * dashboard access, they are shipped to whatever log aggregator is attached, and they are retained
 * long after the request is gone. Anything written there has effectively left the application.
 *
 * The call sites that matter here both pass data they do not control the shape of —
 * activityLogger receives whatever `details` a controller hands it (in one case an entire request
 * body), and errorHandler receives whatever a driver threw (a PostgREST error carries `details`
 * and `hint` strings that quote the offending row's values). Rather than auditing every caller
 * forever, the values are filtered at the point of writing.
 *
 * Matching is on the KEY, case-insensitively and as a substring, so `password`, `password_hash`,
 * `newPassword` and `PASSWORD` are all caught by one entry.
 */

const SENSITIVE_KEY_PATTERN =
  /pass(word)?|secret|token|api[-_]?key|authorization|cookie|session|hash|salt|credential|private[-_]?key|comp_amount|compamount|pay_rate|salary|wage/i;

const REDACTED = '[redacted]';
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2000;

/**
 * Returns a copy of `value` with sensitive fields replaced by '[redacted]'.
 *
 * Depth, array length and string length are capped as well — an error thrown while importing a
 * 100k-row workbook can otherwise carry the whole payload into the log, which is both a disclosure
 * and unreadable. Cycles are handled, since error objects routinely contain them.
 */
function redact(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]` : value;
  }
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[depth limit]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redact(item, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`…and ${value.length - MAX_ARRAY_ITEMS} more`);
    return items;
  }

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(item, depth + 1, seen);
  }
  return out;
}

/**
 * A bounded, redacted description of a thrown value, for the 5xx log line.
 *
 * `console.error(err)` printed the whole object. For a Supabase/PostgREST failure that includes
 * `details` and `hint`, which quote the row that failed — so a failed employee insert put that
 * person's record, pay included, straight into the log.
 */
function describeError(err) {
  if (!(err instanceof Error)) return { thrown: redact(err) };

  return {
    name: err.name,
    message: redact(err.message),
    code: err.code,
    // PostgREST puts the offending values in these two, so they go through the redactor as well.
    details: err.details === undefined ? undefined : redact(err.details),
    hint: err.hint === undefined ? undefined : redact(err.hint),
    stack: err.stack,
  };
}

module.exports = { redact, describeError, REDACTED, SENSITIVE_KEY_PATTERN };
