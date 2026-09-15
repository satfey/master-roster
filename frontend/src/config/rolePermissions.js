import { ROLES } from './roles';
import { PERMISSIONS as P } from './permissions';

/**
 * What each role may do, for UX gating only — the backend enforces the real matrix and will
 * refuse anything this file gets wrong.
 *
 * These names are the UI's own; the backend checks its own strings. Keep the pairs in step, or a
 * button appears that only ever returns 403:
 *
 *   VIEW_SCHEDULE          -> schedule:view          (reading a roster)
 *   GENERATE_SCHEDULE      -> schedule:generate      (creating/regenerating one)
 *   VIEW_SALES             -> sales:view
 *   VIEW_FORECAST          -> forecast:view
 *   VIEW_PRODUCTIVITY      -> productivity:view
 *   VIEW_LABOR_GUIDELINE   -> labor_guideline:view   (Admin + Area Coach)
 *   MANAGE_LABOR_GUIDELINE -> labor_guideline:manage (Admin only)
 *   IMPORT_FILES           -> data:import / sales:import
 *   MANAGE_STAFF           -> employee:manage        (Admin; Store Manager for their own store only)
 */
export const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: Object.values(P),

  [ROLES.AREA_COACH]: [
    P.VIEW_DASHBOARD,
    P.VIEW_KPI,
    P.VIEW_PRODUCTIVITY,
    P.VIEW_SALES,
    P.VIEW_FORECAST,
    P.VIEW_SALES_TARGET,
    P.VIEW_SCHEDULE,
    P.REVIEW_SCHEDULE_ANOMALY,
    P.VIEW_AREA_STORES,
    P.VIEW_LABOR_GUIDELINE // read-only: an Area Coach may see the guideline, never edit it
  ],

  [ROLES.STORE_MANAGER]: [
    P.VIEW_DASHBOARD,
    P.VIEW_KPI,
    P.VIEW_PRODUCTIVITY,
    P.VIEW_SALES,
    P.VIEW_FORECAST,
    P.VIEW_SALES_TARGET,
    P.VIEW_SCHEDULE,
    P.GENERATE_SCHEDULE,
    P.ENTER_DAILY_SALES,
    P.MANAGE_STORE,
    P.MANAGE_STAFF,
    P.VIEW_SETTINGS,
    P.VIEW_OWN_STORE
  ]
};

export const getPermissionsForRole = (role) => ROLE_PERMISSIONS[role] ?? [];
