import './EmptyState.css';

/** Empty-data state — screenshot 5 shows the roster page with no schedule yet. */
export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="empty-state">
      {Icon && <Icon size={28} strokeWidth={1.5} aria-hidden="true" />}
      {title && <p className="empty-state__title">{title}</p>}
      {description && <p className="empty-state__desc">{description}</p>}
      {action}
    </div>
  );
}
