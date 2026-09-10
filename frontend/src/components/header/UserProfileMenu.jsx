import { useEffect } from 'react';
import { LogOut, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { ROLES, ROLE_LABELS } from '../../config/roles';
import './UserProfileMenu.css';

const initialsOf = (name = '') =>
  name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'U';

/** Account Details bottom sheet — screenshot 9. */
export default function UserProfileMenu({ open, onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !user) return null;

  const areaLine =
    user.role === ROLES.ADMIN
      ? 'All Stores / Head Office'
      : user.areaName ?? user.storeName ?? '-';

  const handleSignOut = () => {
    onClose();
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="profile-sheet__backdrop" onClick={onClose}>
      <div
        className="profile-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Account Details"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="profile-sheet__handle" aria-hidden="true" />

        <header className="profile-sheet__head">
          <h2>Account Details</h2>
          <button type="button" onClick={onClose} aria-label="ปิด">
            <X size={22} />
          </button>
        </header>

        <div className="profile-sheet__identity">
          <span className="profile-sheet__avatar">{initialsOf(user.name)}</span>
          <div className="profile-sheet__facts">
            <p className="profile-sheet__name">{user.name}</p>
            <p>Role: {ROLE_LABELS[user.role]}</p>
            <p>Area: {areaLine}</p>
            <p>ID: {user.employeeId}</p>
          </div>
        </div>

        <button type="button" className="profile-sheet__signout" onClick={handleSignOut}>
          Sign out <LogOut size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
