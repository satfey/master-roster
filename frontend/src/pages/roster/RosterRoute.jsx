import FullPageLoader from '../../components/common/FullPageLoader';
import { useStoreScope } from '../../hooks/useStoreScope';
import NetworkRosterPage from './NetworkRosterPage';
import RosterPage from '../store-manager/RosterPage';

/**
 * /roster for every role. Which view renders depends only on the store scope
 * in the context bar: "All Store" (Admin / Area Coach) shows the exception
 * heatmap, a single store shows that store's roster.
 */
export default function RosterRoute() {
  const { loading, isAllStores, canViewManyStores } = useStoreScope();

  if (loading) return <FullPageLoader />;
  if (canViewManyStores && isAllStores) return <NetworkRosterPage />;
  return <RosterPage />;
}
