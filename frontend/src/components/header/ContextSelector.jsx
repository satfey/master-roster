import { useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useStoreScope } from '../../hooks/useStoreScope';
import { ALL_STORES } from '../../context/StoreScopeContext';
import { ROLE_LABELS } from '../../config/roles';
import './ContextSelector.css';

const MONTHS = ['July 2026', 'August 2026', 'September 2026'];

/**
 * Role / Store / Month selectors.
 * The store list and the current selection live in StoreScopeContext, so the
 * roster pages react to this control. A Store Manager only ever sees their own
 * store and the control is disabled, so an unauthorised storeId can never
 * reach the service layer.
 */
export default function ContextSelector() {
  const { role } = useAuth();
  const { stores, storeId, canViewManyStores, selectStore } = useStoreScope();
  const [month, setMonth] = useState(MONTHS[0]);

  const storeLocked = !canViewManyStores || stores.length <= 1;

  return (
    <div className="context-bar">
      <div className="context-bar__field">
        <select value={role ?? ''} disabled aria-label="บทบาท">
          <option value={role ?? ''}>{ROLE_LABELS[role] ?? 'Select Role'}</option>
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </div>

      <div className="context-bar__field">
        <select
          value={storeId ?? ''}
          disabled={storeLocked}
          onChange={(e) => selectStore(e.target.value)}
          aria-label="สาขา"
        >
          {canViewManyStores && <option value={ALL_STORES}>All Store</option>}
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </div>

      <div className="context-bar__field context-bar__field--month">
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="เดือน">
          {MONTHS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <CalendarDays size={14} aria-hidden="true" />
      </div>
    </div>
  );
}
