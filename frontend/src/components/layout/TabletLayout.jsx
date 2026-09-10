import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import MasterRosterHeader from '../header/MasterRosterHeader';
import TabletSidebar from '../navigation/TabletSidebar';
import './layouts.css';

export default function TabletLayout() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="layout layout--tablet">
      <MasterRosterHeader onMenuClick={() => setMenuOpen(true)} menuOpen={menuOpen} />
      <TabletSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <main className="layout__main">
        <Outlet />
      </main>
    </div>
  );
}
