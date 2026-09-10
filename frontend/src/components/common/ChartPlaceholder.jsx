import './ChartPlaceholder.css';

/**
 * Flat grey block standing in for a chart that has no backend data yet.
 * Dimensions match the screenshot so the page rhythm is preserved.
 */
export default function ChartPlaceholder({ label, height = 120 }) {
  return (
    <div className="chart-placeholder" style={{ minHeight: height }}>
      {String(label)
        .split('\n')
        .map((line) => (
          <span key={line}>{line}</span>
        ))}
    </div>
  );
}
