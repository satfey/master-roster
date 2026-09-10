import './Card.css';

/** White rounded card used for every section in the design. */
export default function Card({ title, icon: Icon, children, className = '', padded = true }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <header className="card-head">
          {Icon && <Icon size={16} strokeWidth={2} aria-hidden="true" />}
          <h2>{title}</h2>
        </header>
      )}
      <div className={padded ? 'card-body' : 'card-body card-body--flush'}>{children}</div>
    </section>
  );
}
