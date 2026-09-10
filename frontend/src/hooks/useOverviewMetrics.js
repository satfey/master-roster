import { useEffect, useState } from 'react';
import { useStoreScope } from './useStoreScope';
import { getOverviewMetrics } from '../services/dashboardService';

/**
 * Headline dashboard tiles for the store currently in scope, from the backend.
 * Returns [] while loading, when no store is selected, or when the backend has
 * nothing to report — the screens render no tiles rather than placeholder ones.
 */
export function useOverviewMetrics() {
  const { selectedStoreId } = useStoreScope();
  const [metrics, setMetrics] = useState([]);

  useEffect(() => {
    let active = true;
    if (!selectedStoreId) {
      setMetrics([]);
      return undefined;
    }
    getOverviewMetrics(selectedStoreId)
      .then((tiles) => active && setMetrics(tiles))
      .catch(() => active && setMetrics([]));
    return () => {
      active = false;
    };
  }, [selectedStoreId]);

  return metrics;
}
