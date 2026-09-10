import { NavLink } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import './DesktopNavbar.css';

/** Horizontal navbar for >= 1200px. Same config as the other two navs. */
export default function DesktopNavbar() {
  const { navigationItems } = usePermissions();

  return (
    <nav className="desktop-nav" aria-label="เมนูหลัก">
      {navigationItems.map(({ id, label, path, icon: Icon }) => (
        <NavLink
          key={id}
          to={path}
          className={({ isActive }) => `desktop-nav__item${isActive ? ' is-active' : ''}`}
        >
          <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
