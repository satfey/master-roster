import { useState } from 'react';
import { Globe, Menu } from 'lucide-react';
import UserProfileMenu from './UserProfileMenu';
import ContextSelector from './ContextSelector';
import { useAuth } from '../../hooks/useAuth';
import './MasterRosterHeader.css';

const initialsOf = (name = '') =>
  name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'U';

/** Navy bar + warm context bar. Shared by every device layout. */
export default function MasterRosterHeader({ showContextBar = true, onMenuClick, menuOpen = false }) {
  const { user } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [lang, setLang] = useState('TH');

  return (
    <>
      <header className="mr-header">
        <div className="mr-header__left">
          {onMenuClick && (
            <button
              type="button"
              className="mr-header__menu"
              onClick={onMenuClick}
              aria-label="เปิดเมนู"
              aria-expanded={menuOpen}
            >
              <Menu size={22} />
            </button>
          )}
          <span className="mr-header__brand">Master Roster</span>
        </div>
        <div className="mr-header__actions">
          <button
            type="button"
            className="mr-header__lang"
            onClick={() => setLang((prev) => (prev === 'TH' ? 'EN' : 'TH'))}
            aria-label={`เปลี่ยนภาษา ปัจจุบัน ${lang}`}
          >
            <Globe size={14} strokeWidth={2.5} aria-hidden="true" />
            {lang}
          </button>
          <button
            type="button"
            className="mr-header__avatar"
            onClick={() => setProfileOpen(true)}
            aria-label="บัญชีผู้ใช้"
          >
            {initialsOf(user?.name)}
          </button>
        </div>
      </header>

      {showContextBar && <ContextSelector />}

      <UserProfileMenu open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}
