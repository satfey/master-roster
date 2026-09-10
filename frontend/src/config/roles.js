/**
 * Centralised role definitions.
 * Never compare raw strings such as role === "admin" anywhere else in the app.
 */
export const ROLES = {
  ADMIN: 'ADMIN',
  AREA_COACH: 'AREA_COACH',
  STORE_MANAGER: 'STORE_MANAGER'
};

/** Human readable labels shown in the UI (profile sheet, context bar). */
export const ROLE_LABELS = {
  [ROLES.ADMIN]: 'Admin / HR',
  [ROLES.AREA_COACH]: 'Area Coach',
  [ROLES.STORE_MANAGER]: 'Store Manager'
};

/** Where each role lands after a successful sign in. */
export const ROLE_HOME_PATH = {
  [ROLES.ADMIN]: '/admin/dashboard',
  [ROLES.AREA_COACH]: '/area/dashboard',
  [ROLES.STORE_MANAGER]: '/dashboard'
};

export const isValidRole = (role) => Object.values(ROLES).includes(role);
