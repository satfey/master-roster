const { failure } = require('../utils/apiResponse');

/**
 * RBAC check. With the system identity (`permissions: ['*']`) from the
 * temporary authenticate middleware, every check passes — this keeps the
 * real per-role logic ready to go once login is implemented.
 */
function authorize(...requiredPermissions) {
  return (req, res, next) => {
    if (!req.user) return failure(res, 'Not authenticated', 401);

    if (req.user.permissions.includes('*')) return next();

    const hasPermission = requiredPermissions.every((perm) => req.user.permissions.includes(perm));
    if (!hasPermission) return failure(res, 'You do not have permission to perform this action', 403);

    next();
  };
}

module.exports = authorize;
