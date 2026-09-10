import { Outlet } from 'react-router-dom';
import MasterRosterHeader from '../header/MasterRosterHeader';
import MobileBottomNav from '../navigation/MobileBottomNav';
import './layouts.css';

export default function MobileLayout() {
  return (
    <div className="layout layout--mobile">
      <MasterRosterHeader />
      <main className="layout__main">
        <Outlet />
      </main>
      <MobileBottomNav />
    </div>
  );
}
