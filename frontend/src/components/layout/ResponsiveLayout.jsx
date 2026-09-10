import { useResponsive } from '../../hooks/useResponsive';
import DesktopLayout from './DesktopLayout';
import TabletLayout from './TabletLayout';
import MobileLayout from './MobileLayout';

/**
 * Picks exactly one layout. Navbar, sidebar and bottom nav are never mounted
 * at the same time.
 */
export default function ResponsiveLayout() {
  const { device } = useResponsive();
  if (device === 'desktop') return <DesktopLayout />;
  if (device === 'tablet') return <TabletLayout />;
  return <MobileLayout />;
}
