import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HOME_PATH } from '../config/roles';

/** Sends "/" to the right landing page for the signed in role. */
export default function RoleHomeRedirect() {
  const { role } = useAuth();
  return <Navigate to={ROLE_HOME_PATH[role] ?? '/login'} replace />;
}
