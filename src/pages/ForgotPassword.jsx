import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import AuthShell from '../components/auth/AuthShell';
import { SubmitButton, TextField } from '../components/auth/fields';
import {
  RESEND_COOLDOWN_SECONDS,
  focusField,
  isRateLimited,
  isValidEmail,
  normalizeEmail,
  resetRequestErrorMessage,
} from '../utils/authForm';

function ForgotPassword() {
  const { requestPasswordReset, isAuthenticated, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState(null);
  const [resent, setResent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (loading) return null;
  if (isAuthenticated) return <Navigate to="/" replace />;

  async function send(address, isResend) {
    setSubmitting(true);
    setError(null);
    setResent(false);
    try {
      await requestPasswordReset(address);
      setSentTo(address);
      setResent(isResend);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError({ field: null, message: resetRequestErrorMessage(err) });
      if (isRateLimited(err)) setCooldown(RESEND_COOLDOWN_SECONDS);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      setError({ field: 'email', message: 'Enter a valid email address.' });
      focusField('email');
      return;
    }
    send(normalized, false);
  }

  function handleResend() {
    if (submitting || cooldown > 0) return;
    send(sentTo, true);
  }

  const loginFooter = (
    <p className="auth-switch">
      Remember your password?
      <Link to="/sign-in">Log in</Link>
    </p>
  );

  if (sentTo) {
    const waiting = cooldown > 0;
    return (
      <AuthShell title="Check your email" backTo="/sign-in" backLabel="Back to log in">
        <p className="auth-notice">
          If an account exists for <strong>{sentTo}</strong>, we sent a link to reset your password.
        </p>
        <div className="auth-actions">
          {error && (
            <p className="auth-error" role="alert">
              {error.message}
            </p>
          )}
          <button
            type="button"
            className="btn-secondary"
            aria-disabled={submitting || waiting || undefined}
            onClick={handleResend}
          >
            {submitting && <span className="spinner" aria-hidden="true" />}
            {submitting ? 'Sending…' : waiting ? `Resend in ${cooldown}s` : 'Resend link'}
          </button>
        </div>
        {resent && (
          <p className="auth-status" role="status">
            Link sent again.
          </p>
        )}
        {loginFooter}
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot password" backTo="/sign-in" backLabel="Back to log in">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <TextField
          id="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          placeholder="Enter your registered email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={error?.field === 'email' ? error.message : undefined}
        />
        {error && !error.field && (
          <p className="auth-error" role="alert">
            {error.message}
          </p>
        )}
        <SubmitButton busy={submitting} idleLabel="Send reset link" busyLabel="Sending…" />
      </form>
      {loginFooter}
    </AuthShell>
  );
}

export default ForgotPassword;
