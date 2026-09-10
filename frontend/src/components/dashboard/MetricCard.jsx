import './MetricCard.css';

/** One bordered tile inside the Overview card. */
export default function MetricCard({ label, value, tone = 'green', delta, direction = 'up' }) {
  return (
    <div className="metric-tile">
      <p className="metric-tile__label">{label}</p>
      <p className={`metric-tile__value metric-tile__value--${tone}`}>{value}</p>
      {delta && (
        <p className={`metric-tile__delta metric-tile__delta--${direction}`}>
          <span aria-hidden="true">{direction === 'up' ? '▲' : '▼'}</span> {delta}
        </p>
      )}
    </div>
  );
}
