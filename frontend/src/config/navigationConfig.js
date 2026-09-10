import {
  PieChart,
  LineChart,
  TrendingUp,
  CalendarDays,
  BarChart3,
  Settings,
  Store,
  ClipboardList,
  Upload,
  ScrollText,
  CalendarRange
} from 'lucide-react';
import { PERMISSIONS } from './permissions';

/**
 * One navigation config consumed by the desktop navbar, tablet sidebar and
 * mobile bottom nav. Only the visual presentation differs between them.
 *
 * center: renders in the raised navy circle of the mobile bottom nav.
 */
export const NAVIGATION_ITEMS = [
  {
    id: 'dashboard',
    label: 'ภาพรวมข้อมูล',
    labelEn: 'Overview',
    path: '/dashboard',
    icon: PieChart,
    permission: PERMISSIONS.VIEW_DASHBOARD
  },
  {
    id: 'sales',
    label: 'ยอดขาย',
    labelEn: 'Sales',
    path: '/sales',
    icon: LineChart,
    permission: PERMISSIONS.VIEW_SALES
  },
  {
    id: 'forecast',
    label: 'พยากรณ์ยอดขาย',
    labelEn: 'Forecast',
    path: '/forecast',
    icon: TrendingUp,
    permission: PERMISSIONS.VIEW_FORECAST
  },
  {
    id: 'roster',
    label: 'จัดตารางพนักงาน',
    labelEn: 'Roster',
    path: '/roster',
    icon: CalendarDays,
    permission: PERMISSIONS.VIEW_SCHEDULE,
    center: true
  },
  {
    id: 'targets',
    label: 'เป้าหมายยอดขาย',
    labelEn: 'Sales Target',
    path: '/targets',
    icon: BarChart3,
    permission: PERMISSIONS.VIEW_SALES_TARGET
  },
  {
    id: 'settings',
    label: 'ตั้งค่าระบบ',
    labelEn: 'Settings',
    path: '/settings',
    icon: Settings,
    permission: PERMISSIONS.VIEW_SETTINGS
  },
  {
    id: 'labor-guideline',
    label: 'เกณฑ์ชั่วโมงแรงงาน',
    labelEn: 'Labor Guideline',
    path: '/settings/labor-guideline',
    icon: CalendarRange,
    permission: PERMISSIONS.VIEW_LABOR_GUIDELINE
  },
  {
    id: 'area-stores',
    label: 'สาขาในเขต',
    labelEn: 'Area Stores',
    path: '/area/stores',
    icon: Store,
    permission: PERMISSIONS.VIEW_AREA_STORES
  },
  {
    id: 'schedule-review',
    label: 'ตรวจตาราง',
    labelEn: 'Schedule Review',
    path: '/area/schedule-review',
    icon: ClipboardList,
    permission: PERMISSIONS.REVIEW_SCHEDULE_ANOMALY
  },
  {
    id: 'import',
    label: 'นำเข้าข้อมูล',
    labelEn: 'Import',
    path: '/admin/import',
    icon: Upload,
    permission: PERMISSIONS.IMPORT_FILES
  },
  {
    id: 'import-excel',
    label: 'อัปโหลด Excel',
    labelEn: 'Upload Excel',
    path: '/admin/import/excel',
    icon: Upload,
    permission: PERMISSIONS.IMPORT_FILES
  },
  {
    id: 'audit-log',
    label: 'Audit Log',
    labelEn: 'Audit Log',
    path: '/admin/audit-log',
    icon: ScrollText,
    permission: PERMISSIONS.VIEW_AUDIT_LOG
  }
];

/** Filter the config down to what the current permission set allows. */
export const getNavigationItems = (permissions = []) =>
  NAVIGATION_ITEMS.filter((item) => permissions.includes(item.permission));
