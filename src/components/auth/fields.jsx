import { useState } from 'react';

function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} className="field-error" role="alert">
      {message}
    </p>
  );
}

export function TextField({ id, label, error, multiline = false, ...props }) {
  const Control = multiline ? 'textarea' : 'input';
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <Control
        id={id}
        name={id}
        className="field-input"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function PhoneField({ id, label, error, prefix, ...props }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="phone-group" data-invalid={error ? 'true' : undefined}>
        <span className="phone-prefix">{prefix}</span>
        <input
          id={id}
          name={id}
          type="tel"
          inputMode="numeric"
          className="phone-input"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          {...props}
        />
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function EyeIcon({ crossed }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M4 4l16 16" />}
    </svg>
  );
}

export function PasswordField({ id, label, error, ...props }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-control">
        <input
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          className="field-input field-input--padded"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          {...props}
        />
        <button
          type="button"
          className="field-toggle"
          aria-label="Show password"
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          <EyeIcon crossed={visible} />
        </button>
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function ChoiceGroup({ name, legend, options, value, onChange, error }) {
  return (
    <fieldset className="field" aria-describedby={error ? `${name}-error` : undefined}>
      <legend className="field-label">{legend}</legend>
      <div className="choice-grid">
        {options.map((option) => (
          <label key={option.value} className="choice">
            <input
              id={`${name}-${option.value}`}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="choice-input"
              required
            />
            <span className="choice-pill">{option.label}</span>
          </label>
        ))}
      </div>
      <FieldError id={`${name}-error`} message={error} />
    </fieldset>
  );
}

export function SubmitButton({ busy, idleLabel, busyLabel }) {
  return (
    <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {busy ? busyLabel : idleLabel}
    </button>
  );
}
