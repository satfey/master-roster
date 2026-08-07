// Centralized error handler. Combined with `express-async-errors`, any thrown
// error (sync or async) inside a route handler will be routed here.
function errorHandler(err, req, res, next) {
  console.error(err);

  const status = err.status || 500;
  const message = err.message || 'Internal server error';

  res.status(status).json({
    success: false,
    message,
    errors: err.errors || null,
  });
}

module.exports = errorHandler;
