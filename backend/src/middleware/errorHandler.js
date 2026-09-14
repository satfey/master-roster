const multer = require('multer');
const { describeError } = require('../utils/redact');

// Centralized error handler. Combined with `express-async-errors`, any thrown
// error (sync or async) inside a route handler will be routed here.
function errorHandler(err, req, res, next) {
  // A MulterError (wrong multipart field name, file too large, etc.) is a
  // client mistake, not a server fault — without this, it falls through to
  // the 500 branch below with no `status` set, which is misleading for
  // something as ordinary as uploading a file under the wrong field name.
  const status = err instanceof multer.MulterError ? 400 : err.status || 500;

  // A 4xx message is one this app wrote for the caller ("storeId is required", "You can only
  // access your own store") and is safe to return. A 5xx message is whatever happened to be
  // thrown — in this codebase that is usually a raw PostgREST/Postgres error, whose text carries
  // table names, column names and constraint names. Returning those hands an attacker a free map
  // of the schema, so 5xx answers with a fixed string and the real error goes to the log only.
  const message = status >= 500 ? 'Internal server error' : err.message || 'Request failed';

  // Expected client errors (bad input, validation, 404s, etc.) are normal,
  // frequent, and already returned to the caller with a clear message and
  // status — dumping the full stack for every one of them makes the console
  // look like the app is crashing when it's actually working as designed.
  // Full stacks are reserved for genuinely unexpected 5xx failures.
  if (status >= 500) {
    // describeError, not the raw object: a PostgREST failure carries `details`/`hint` that quote
    // the row that failed, so dumping it wrote that record — pay included — into the server log.
    console.error(`[500] ${req.method} ${req.originalUrl}`, describeError(err));
  } else {
    console.warn(`[${status}] ${req.method} ${req.originalUrl} — ${message}`);
  }

  res.status(status).json({
    success: false,
    message,
    errors: err.errors || null,
  });
}

module.exports = errorHandler;
