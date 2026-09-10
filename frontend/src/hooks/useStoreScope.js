import { useContext } from 'react';
import { StoreScopeContext } from '../context/StoreScopeContext';

export function useStoreScope() {
  const ctx = useContext(StoreScopeContext);
  if (!ctx) throw new Error('useStoreScope must be used inside a StoreScopeProvider');
  return ctx;
}
