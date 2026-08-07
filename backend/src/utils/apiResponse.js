// Small helper to keep API responses consistent across all controllers.

function success(res, data, message = 'OK', status = 200) {
  return res.status(status).json({ success: true, message, data });
}

function failure(res, message = 'Something went wrong', status = 400, errors = null) {
  return res.status(status).json({ success: false, message, errors });
}

module.exports = { success, failure };
