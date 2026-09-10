import { NavLink } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import './MobileBottomNav.css';

const MAX_ITEMS = 5;

/**
 * Fixed bottom navigation. The item flagged `center` renders in the raised
 * navy circle. Active state comes from NavLink, so a refresh keeps it correct.
 */
export default function MobileBottomNav() {
  const { navigationItems } = usePermissions();
  const items = navigationItems.slice(0, MAX_ITEMS);

  return (
    <nav className="bottom-nav" aria-label="เมนูหลัก">
      {items.map(({ id, label, path, icon: Icon, center }) => (
        <NavLink
          key={id}
          to={path}
          className={({ isActive }) =>
            [
              'bottom-nav__item',
              center ? 'bottom-nav__item--center' : '',
              isActive ? 'is-active' : ''
            ]
              .filter(Boolean)
              .join(' ')
          }
        >
          <span className="bottom-nav__icon">
            <Icon size={center ? 22 : 20} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className="bottom-nav__label">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
