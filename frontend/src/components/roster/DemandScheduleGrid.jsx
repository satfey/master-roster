import './DemandScheduleGrid.css';

/** Headcount Demand vs Schedule (AI Mapping). Cells read "demand/scheduled". */
export default function DemandScheduleGrid({ days, rows, legend }) {
  return (
    <>
      <div className="scroll-x">
        <table className="demand-grid">
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
                  return (
                    <td key={day}>
                      <span className={`demand-cell demand-cell--${cell.status}`}>
                        {cell.demand}/{cell.scheduled}
                      </span>
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
