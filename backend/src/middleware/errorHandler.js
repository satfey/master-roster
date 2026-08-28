// Centralized error handler. Combined with `express-async-errors`, any thrown
// error (sync or async) inside a route handler will be routed here.
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = err.message || 'Internal server error';

  // Expected client errors (bad input, validation, 404s, etc.) are normal,
  // frequent, and already returned to the caller with a clear message and
  // status — dumping the full stack for every one of them makes the console
  // look like the app is crashing when it's actually working as designed.
  // Full stacks are reserved for genuinely unexpected 5xx failures.
  if (status >= 500) {
    console.error(err);
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
