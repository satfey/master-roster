const { failure } = require('../utils/apiResponse');

/**
 * Throttles repeated failed logins.
 *
 * POST /login had no limit of any kind: no delay, no lockout, no counter. bcrypt at 10 rounds
 * makes each guess cost something, but nothing stopped an attacker running a credential-stuffing
 * list against it indefinitely, and this API's only authentication is that one endpoint.
 *
 * Counted per (IP + email) rather than per IP alone: per-IP only would let one attacker behind a
 * shared corporate NAT lock out every colleague, and per-email only would let an attacker lock a
 * known account out on purpose. Requiring both means an attacker slows down on the account they
 * are actually attacking while everyone else is unaffected.
 *
 * Only FAILURES count. clearLoginAttempts() is called by the controller on a successful password
 * check, so a user who mistypes twice and then gets it right starts clean.
 *
 * Deliberately in-memory: this runs as a single Node process, and a shared store (Redis, or a
 * table) would be needed only once it runs as more than one. If this is ever scaled horizontally,
 * this file is the thing to replace — an in-memory counter per instance multiplies the real limit
 * by the instance count.
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILURES = 10;

/** key -> { failures, firstFailureAt } */
const attempts = new Map();

function keyFor(req) {
  const email = String(req.body?.email || '').toLowerCase().trim();
  return `${req.ip}|${email}`;
}

/** Drops entries whose window has passed, so the map cannot grow without bound. */
function prune(now) {
  for (const [key, entry] of attempts) {
    if (now - entry.firstFailureAt >= WINDOW_MS) attempts.delete(key);
  }
}

function loginRateLimit(req, res, next) {
  const now = Date.now();
  prune(now);

  const entry = attempts.get(keyFor(req));
  if (entry && entry.failures >= MAX_FAILURES && now - entry.firstFailureAt < WINDOW_MS) {
    const retryAfterSeconds = Math.ceil((WINDOW_MS - (now - entry.firstFailureAt)) / 1000);
    res.set('Retry-After', String(retryAfterSeconds));
    return failure(res, 'Too many failed login attempts. Please try again later.', 429);
  }

  return next();
}

/** Called by the login controller when a password check fails. */
function recordFailedLogin(req) {
  const now = Date.now();
  const key = keyFor(req);
  const entry = attempts.get(key);

  if (!entry || now - entry.firstFailureAt >= WINDOW_MS) {
    attempts.set(key, { failures: 1, firstFailureAt: now });
    return;
  }
  entry.failures += 1;
}

/** Called by the login controller on success, so a legitimate user is never punished for a typo. */
function clearLoginAttempts(req) {
  attempts.delete(keyFor(req));
}

/** Test seam only — resets the counter between cases. */
function __resetLoginAttempts() {
  attempts.clear();
}

module.exports = { loginRateLimit, recordFailedLogin, clearLoginAttempts, __resetLoginAttempts, MAX_FAILURES, WINDOW_MS };
