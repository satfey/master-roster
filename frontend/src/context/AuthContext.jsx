import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { getPermissionsForRole } from '../config/rolePermissions';
import { clearSession, persistSession, restoreSession, signIn } from '../services/authService';
import { onUnauthorized } from '../lib/auth.js';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    restoreSession()
      .then((restored) => {
        if (active) setUser(restored);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Fires when any API call comes back 401 for an authenticated request (e.g.
  // the token expired mid-session) — drops straight back to the login screen
  // instead of leaving a signed-out session rendering a stale page.
  useEffect(() => onUnauthorized(() => setUser(null)), []);

  const login = useCallback(async ({ email, password, remember = false }) => {
    setError(null);
    setLoading(true);
    try {
      const authenticated = await signIn({ email, password });
      persistSession(authenticated, remember);
      setUser(authenticated);
      return authenticated;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setError(null);
  }, []);

  const permissions = useMemo(() => (user ? getPermissionsForRole(user.role) : []), [user]);

  const value = useMemo(
    () => ({
      user,
      role: user?.role ?? null,
      permissions,
      isAuthenticated: Boolean(user),
      loading,
      error,
      login,
      logout
    }),
    [user, permissions, loading, error, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
