import { useEffect, useRef } from 'react';
import { ArrowRight, Clock, MapPin, UserMinus, UserPlus, X } from 'lucide-react';
import Button from '../common/Button';
import { DAY_LABELS } from '../../config/rosterDisplay';
import { storesInCell } from '../../utils/exceptionHeatmap';
import './StoreExceptionModal.css';

/** A gap of one person is a warning, two or more is a problem. */
const toneOf = (gap) => (gap >= 2 ? 'red' : 'amber');

/**
 * The pop-up that stands between the all-store heatmap and a single store's
 * roster: it names the stores behind one pin, then hands over to their
 * schedule. Only stores already inside the session's scope can appear here.
 */
export default function StoreExceptionModal({ selection, onClose, onOpenStore }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!selection) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [selection, onClose]);

  if (!selection) return null;

  const { row, cell, status } = selection;
  const entries = storesInCell(cell, status);
  const understaffed = status === 'understaffed';
  const GapIcon = understaffed ? UserMinus : UserPlus;
  const title = understaffed
    ? `${entries.length} สาขาที่พนักงานไม่พอ (Understaffed)`
    : `${entries.length} สาขาที่พนักงานเกิน (Overstaffed)`;

  return (
    <div className="store-exception__backdrop" onClick={onClose}>
      <div
        className="store-exception"
        role="dialog"
        aria-modal="true"
        aria-labelledby="store-exception-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="store-exception__head">
          <h2 id="store-exception-title">
            <MapPin size={16} aria-hidden="true" />
            {title}
          </h2>
          <button type="button" ref={closeRef} onClick={onClose} aria-label="ปิด">
            <X size={18} />
          </button>
        </header>

        <p className="store-exception__meta">
          <span>
            {DAY_LABELS[cell.day] ?? cell.day} ({cell.day})
          </span>
          <span>
            <Clock size={13} aria-hidden="true" />
            {row.from} - {row.to} ({row.name})
          </span>
        </p>

        <ul className="store-exception__list">
          {entries.map((entry) => (
            <li key={entry.store.id}>
              <div className="store-exception__store">
                <p className="store-exception__name">{entry.store.nameTh ?? entry.store.name}</p>
                <p className="store-exception__id">ID: {entry.store.code ?? entry.store.id}</p>
                <span className={`store-exception__gap is-${toneOf(entry.gap)}`}>
                  <GapIcon size={12} aria-hidden="true" />
                  {understaffed ? 'ขาด' : 'เกิน'} {entry.gap} คน
                </span>
              </div>
              <Button
                variant="primary"
                size="sm"
                icon={ArrowRight}
                iconPosition="right"
                onClick={() => onOpenStore(entry.store)}
              >
                ดูตาราง
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
