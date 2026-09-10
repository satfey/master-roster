import './Button.css';

export default function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  icon: Icon,
  iconPosition = 'left',
  children,
  className = '',
  ...rest
}) {
  const classes = [
    'btn',
    `btn--${variant}`,
    `btn--${size}`,
    fullWidth ? 'btn--block' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} {...rest}>
      {Icon && iconPosition === 'left' && <Icon size={16} aria-hidden="true" />}
      {children}
      {Icon && iconPosition === 'right' && <Icon size={16} aria-hidden="true" />}
    </button>
  );
}
