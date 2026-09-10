import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { ROLE_HOME_PATH } from '../../config/roles';
import FullPageLoader from '../common/FullPageLoader';

/**
 * Route level authorisation. Works for a manually typed URL, not just a
 * hidden nav link.
 *
 *   <PermissionRoute allowedRoles={[ROLES.ADMIN]}>...</PermissionRoute>
 *   <PermissionRoute permission={PERMISSIONS.VIEW_AUDIT_LOG}>...</PermissionRoute>
 */
export default function PermissionRoute({ children, allowedRoles, permission, permissions }) {
  const { role, loading, isAuthenticated } = useAuth();
  const { hasPermission, hasAnyPermission } = usePermissions();

  if (loading) return <FullPageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const roleOk = !allowedRoles || allowedRoles.includes(role);
  const permissionOk = !permission || hasPermission(permission);
  const anyPermissionOk = !permissions || hasAnyPermission(permissions);

  if (roleOk && permissionOk && anyPermissionOk) return children;

  return <Navigate to="/unauthorized" replace state={{ fallback: ROLE_HOME_PATH[role] }} />;
}
