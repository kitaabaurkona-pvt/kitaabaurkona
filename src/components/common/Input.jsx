/**
 * Reusable Input component.
 * @param {object} props
 * @param {string} [props.label] - Accessible label text.
 * @param {string} [props.type] - Input type (text, email, password, number, etc.).
 * @param {string} [props.value]
 * @param {function} [props.onChange]
 * @param {string} [props.placeholder]
 * @param {string} [props.error] - Validation error message.
 */
function Input({ label, type = 'text', value, onChange, placeholder, error, id, ...rest }) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div>
      {label && <label htmlFor={inputId}>{label}</label>}
      <input
        id={inputId}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-invalid={!!error}
        {...rest}
      />
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

export default Input;
