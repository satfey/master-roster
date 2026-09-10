import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { X } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import './TabletSidebar.css';

/**
 * Off-canvas drawer for 768px - 1199px. Hidden until the hamburger is pressed,
 * closes on Escape, on backdrop click and after a navigation item is chosen.
 */
export default function TabletSidebar({ open, onClose }) {
  const { navigationItems } = usePermissions();
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    panelRef.current?.querySelector('a')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`sidebar-backdrop${open ? ' is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        className={`tablet-sidebar${open ? ' is-open' : ''}`}
        aria-hidden={!open}
        aria-label="เมนูหลัก"
      >
        <div className="tablet-sidebar__head">
          <span>เมนู</span>
          <button type="button" onClick={onClose} aria-label="ปิดเมนู">
            <X size={18} />
          </button>
        </div>

        <nav>
          {navigationItems.map(({ id, label, path, icon: Icon }) => (
            <NavLink
              key={id}
              to={path}
              onClick={onClose}
              tabIndex={open ? 0 : -1}
              className={({ isActive }) => `tablet-sidebar__item${isActive ? ' is-active' : ''}`}
            >
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
