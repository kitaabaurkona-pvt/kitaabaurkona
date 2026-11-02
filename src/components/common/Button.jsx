/**
 * Reusable Button component.
 * @param {object} props
 * @param {React.ReactNode} props.children - Button label / content.
 * @param {string} [props.variant] - Visual variant (e.g. 'primary', 'secondary', 'danger').
 * @param {boolean} [props.disabled]
 * @param {function} [props.onClick]
 */
function Button({ children, variant = 'primary', disabled = false, onClick, ...rest }) {
  return (
    <button
      data-variant={variant}
      disabled={disabled}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}

export default Button;
