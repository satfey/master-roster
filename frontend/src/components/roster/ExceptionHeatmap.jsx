import { MapPin } from 'lucide-react';
import { DAY_LABELS } from '../../config/rosterDisplay';
// Same table shell and legend as the Store Manager demand grid.
import './DemandScheduleGrid.css';
import './ExceptionHeatmap.css';

/**
 * All-store exception heatmap (Admin / Area Coach).
 * A pin means "this many stores have a problem in this block" — clicking it
 * opens the list of those stores.
 */
export default function ExceptionHeatmap({ days, rows, legend, onSelect }) {
  const pinLabel = (row, cell, status) =>
    `${DAY_LABELS[cell.day] ?? cell.day} ${row.name}: ${
      status === 'understaffed'
        ? `${cell.understaffed.length} สาขาที่พนักงานไม่พอ`
        : `${cell.overstaffed.length} สาขาที่พนักงานเกิน`
    } กดเพื่อดูรายชื่อสาขา`;

  return (
    <>
      <div className="scroll-x">
        <table className="demand-grid exception-grid">
          <thead>
            <tr>
              <th className="demand-grid__time-col">
                TIME
                <br />
                BLOCK
              </th>
              {days.map((day) => (
                <th key={day}>{day}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="demand-grid__time-col">
                  {row.label.split('\n').map((line) => (
                    <span key={line} className="demand-grid__label">
                      {line}
                    </span>
                  ))}
                  <span className="demand-grid__caption">{row.caption}</span>
                </th>
                {days.map((day) => {
                  const cell = row.cells.find((c) => c.day === day);
                  if (!cell) return <td key={day} />;

                  const clean = cell.understaffed.length === 0 && cell.overstaffed.length === 0;
                  return (
                    <td key={day}>
                      <div className="exception-cell">
                        {cell.understaffed.length > 0 && (
                          <button
                            type="button"
                            className="exception-pin exception-pin--understaffed"
                            onClick={() => onSelect(row, cell, 'understaffed')}
                            aria-label={pinLabel(row, cell, 'understaffed')}
                          >
                            <MapPin size={10} strokeWidth={2.5} aria-hidden="true" />
                            {cell.understaffed.length} สาขา
                          </button>
                        )}

                        {cell.overstaffed.length > 0 && (
                          <button
                            type="button"
                            className="exception-pin exception-pin--overstaffed"
                            onClick={() => onSelect(row, cell, 'overstaffed')}
                            aria-label={pinLabel(row, cell, 'overstaffed')}
                          >
                            <MapPin size={10} strokeWidth={2.5} aria-hidden="true" />
                            {cell.overstaffed.length} สาขา
                          </button>
                        )}

                        {clean &&
                          (cell.matched.length > 0 ? (
                            <span className="exception-pin exception-pin--matched">
                              {cell.matched.length} สาขา
                            </span>
                          ) : (
                            <span className="exception-cell__none">-</span>
                          ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="demand-legend">
        {legend.map((item) => (
          <li key={item.id}>
            <span className={`demand-legend__dot demand-legend__dot--${item.tone}`} aria-hidden="true" />
            {item.label}
          </li>
        ))}
      </ul>
    </>
  );
}
