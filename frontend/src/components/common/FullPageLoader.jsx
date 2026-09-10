import './FullPageLoader.css';

export default function FullPageLoader({ label = 'กำลังโหลด' }) {
  return (
    <div className="full-loader" role="status" aria-live="polite">
      <span className="full-loader__spinner" aria-hidden="true" />
      <span className="full-loader__label">{label}</span>
    </div>
  );
}
