import { useCallback, useMemo } from 'react';
import { useAuth } from './useAuth';
import { getNavigationItems } from '../config/navigationConfig';

export function usePermissions() {
  const { permissions, role } = useAuth();

  const hasPermission = useCallback(
    (permission) => permissions.includes(permission),
    [permissions]
  );

  const hasAnyPermission = useCallback(
    (list = []) => list.some((p) => permissions.includes(p)),
    [permissions]
  );

  const hasRole = useCallback((allowed = []) => allowed.includes(role), [role]);

  const navigationItems = useMemo(() => getNavigationItems(permissions), [permissions]);

  return { permissions, role, hasPermission, hasAnyPermission, hasRole, navigationItems };
}
