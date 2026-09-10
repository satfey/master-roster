import { ChevronRight, FileText, LineChart, Store, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { PERMISSIONS } from '../../config/permissions';
import './SettingsPage.css';

/**
 * The settings menu — the landing page of the ตั้งค่าระบบ tab for every role.
 * Rows are filtered by permission, so an Admin sees all four entries while a
 * Store Manager only sees the two they may open.
 */
const SETTINGS_ENTRIES = [
  {
    id: 'store',
    label: 'Store Management',
    path: '/settings/store-management',
    icon: Store,
    permission: PERMISSIONS.MANAGE_STORE
  },
  {
    id: 'staff',
    label: 'Staff Management',
    path: '/settings/staff-management',
    icon: Users,
    permission: PERMISSIONS.MANAGE_STAFF
  },
  {
    id: 'sales',
    label: 'Sales Management',
    path: '/settings/sales-management',
    icon: LineChart,
    permission: PERMISSIONS.MANAGE_SALES_TARGET
  },
  {
    id: 'audit',
    label: 'System Audit Log',
    path: '/admin/audit-log',
    icon: FileText,
    permission: PERMISSIONS.VIEW_AUDIT_LOG
  }
];

export default function SettingsPage() {
  const { hasPermission } = usePermissions();
  const entries = SETTINGS_ENTRIES.filter((entry) => hasPermission(entry.permission));

  return (
    <div className="page settings-page">
      {entries.map(({ id, label, path, icon: Icon }) => (
        <Link key={id} to={path} className="settings-row">
          <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
          <span>{label}</span>
          <ChevronRight size={17} aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}
