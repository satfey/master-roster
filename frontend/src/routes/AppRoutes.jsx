import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../components/auth/ProtectedRoute';
import PermissionRoute from '../components/auth/PermissionRoute';
import ResponsiveLayout from '../components/layout/ResponsiveLayout';
import { ROLES } from '../config/roles';
import { PERMISSIONS } from '../config/permissions';

import LoginPage from '../pages/auth/LoginPage';
import UnauthorizedPage from '../pages/UnauthorizedPage';
import NotFoundPage from '../pages/NotFoundPage';
import RoleHomeRedirect from './RoleHomeRedirect';

import DashboardPage from '../pages/store-manager/DashboardPage';
import SalesPage from '../pages/store-manager/SalesPage';
import RosterRoute from '../pages/roster/RosterRoute';
import ImportPage from '../pages/admin/ImportPage';

// Screens talking to the live backend on their own paths. The roster screen is
// not among them any more: /roster is the design's own RosterPage, now reading
// and generating through the real backend (see services/rosterService.js).
import SalesForecastTab from '../pages/SalesForecastTab.jsx';
import UploadExcelTab from '../pages/UploadExcelTab.jsx';
import TargetsPage from '../pages/store-manager/TargetsPage';
import SettingsPage from '../pages/store-manager/SettingsPage';
import StoreManagementPage from '../pages/store-manager/StoreManagementPage';
import StaffManagementPage from '../pages/store-manager/StaffManagementPage';
import SalesManagementPage from '../pages/admin/SalesManagementPage';
import LaborGuidelinePage from '../pages/admin/LaborGuidelinePage';

import AreaDashboardPage from '../pages/area-coach/DashboardPage';
import AreaStoresPage from '../pages/area-coach/StoresPage';
import ScheduleReviewPage from '../pages/area-coach/ScheduleReviewPage';

import AdminDashboardPage from '../pages/admin/DashboardPage';
import AuditLogPage from '../pages/admin/AuditLogPage';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute>
            <ResponsiveLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<RoleHomeRedirect />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />

        {/* Store Manager */}
        <Route
          path="/dashboard"
          element={
            <PermissionRoute permission={PERMISSIONS.VIEW_DASHBOARD}>
              <DashboardPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/sales"
          element={
            <PermissionRoute permission={PERMISSIONS.VIEW_SALES}>
              <SalesPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/forecast"
          element={
            <PermissionRoute permission={PERMISSIONS.VIEW_FORECAST}>
              <SalesForecastTab />
            </PermissionRoute>
          }
        />
        <Route
          path="/roster"
          element={
            <PermissionRoute permission={PERMISSIONS.VIEW_SCHEDULE}>
              <RosterRoute />
            </PermissionRoute>
          }
        />
        <Route
          path="/targets"
          element={
            <PermissionRoute permission={PERMISSIONS.VIEW_SALES_TARGET}>
              <TargetsPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <PermissionRoute permission={PERMISSIONS.VIEW_SETTINGS}>
              <SettingsPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/settings/store-management"
          element={
            <PermissionRoute permission={PERMISSIONS.MANAGE_STORE}>
              <StoreManagementPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/settings/staff-management"
          element={
            <PermissionRoute permission={PERMISSIONS.MANAGE_STAFF}>
              <StaffManagementPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/settings/labor-guideline"
          element={
            <PermissionRoute permission={PERMISSIONS.VIEW_LABOR_GUIDELINE}>
              <LaborGuidelinePage />
            </PermissionRoute>
          }
        />
        <Route
          path="/settings/sales-management"
          element={
            <PermissionRoute permission={PERMISSIONS.MANAGE_SALES_TARGET}>
              <SalesManagementPage />
            </PermissionRoute>
          }
        />

        {/* Area Coach */}
        <Route
          path="/area/dashboard"
          element={
            <PermissionRoute allowedRoles={[ROLES.AREA_COACH, ROLES.ADMIN]}>
              <AreaDashboardPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/area/stores"
          element={
            <PermissionRoute permission={PERMISSIONS.VIEW_AREA_STORES}>
              <AreaStoresPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/area/schedule-review"
          element={
            <PermissionRoute permission={PERMISSIONS.REVIEW_SCHEDULE_ANOMALY}>
              <ScheduleReviewPage />
            </PermissionRoute>
          }
        />

        {/* Admin */}
        <Route
          path="/admin/dashboard"
          element={
            <PermissionRoute allowedRoles={[ROLES.ADMIN]}>
              <AdminDashboardPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/admin/import"
          element={
            <PermissionRoute permission={PERMISSIONS.IMPORT_FILES}>
              <ImportPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/admin/import/excel"
          element={
            <PermissionRoute permission={PERMISSIONS.IMPORT_FILES}>
              <UploadExcelTab />
            </PermissionRoute>
          }
        />
        <Route
          path="/admin/audit-log"
          element={
            <PermissionRoute permission={PERMISSIONS.VIEW_AUDIT_LOG}>
              <AuditLogPage />
            </PermissionRoute>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
