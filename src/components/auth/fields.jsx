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

export function PasswordField({ id, label, error, labelAction, ...props }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <div className="field-label-row">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        {labelAction}
      </div>
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

// aria-disabled (not disabled) keeps keyboard focus on the button while a request runs;
// the page handlers ignore submits while busy.
export function SubmitButton({ busy, idleLabel, busyLabel }) {
  return (
    <button type="submit" className="btn-primary" aria-disabled={busy || undefined} aria-busy={busy}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {busy ? busyLabel : idleLabel}
    </button>
  );
}

export function AuthDivider() {
  return (
    <div className="auth-divider">
      <span>or</span>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
    </svg>
  );
}

export function GoogleButton({ busy, onClick, error }) {
  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        aria-disabled={busy || undefined}
        aria-busy={busy}
        onClick={onClick}
      >
        {busy ? <span className="spinner" aria-hidden="true" /> : <GoogleLogo />}
        {busy ? 'Redirecting…' : 'Continue with Google'}
      </button>
      {error && (
        <p className="auth-error auth-error--spaced" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
