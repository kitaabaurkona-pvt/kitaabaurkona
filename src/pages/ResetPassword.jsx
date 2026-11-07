import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import AuthShell from '../components/auth/AuthShell';
import { PasswordField, SubmitButton } from '../components/auth/fields';
import Splash from '../components/Splash';
import {
  PASSWORD_MAX_LENGTH,
  focusField,
  updatePasswordErrorMessage,
  validatePasswordPair,
} from '../utils/authForm';

function ResetPassword() {
  const { updatePassword, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <Splash />;

  // The emailed link signs the user in with a short-lived recovery session; without
  // one there is nothing to authorize a password change, so the form is not shown.
  if (!isAuthenticated) {
    return (
      <AuthShell title="Link expired" backTo="/sign-in" backLabel="Back to log in">
        <p className="auth-notice">This reset link is invalid or has expired.</p>
        <Link to="/forgot-password" className="btn-primary">
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  const fieldError = (field) => (error?.field === field ? error.message : undefined);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const invalid = validatePasswordPair(password, confirmPassword);
    if (invalid) {
      setError(invalid);
      focusField(invalid.field);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await updatePassword(password);
      navigate('/', { replace: true });
    } catch (err) {
      setError({ field: null, message: updatePasswordErrorMessage(err) });
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title="Set a new password" backTo="/" backLabel="Back to home">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <PasswordField
          id="password"
          label="New password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          placeholder="Minimum 8 characters"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldError('password')}
        />
        <PasswordField
          id="confirm-password"
          label="Confirm new password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          placeholder="Re-enter your new password"
          required
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          error={fieldError('confirm-password')}
        />
        {error && !error.field && (
          <p className="auth-error" role="alert">
            {error.message}
          </p>
        )}
        <SubmitButton busy={submitting} idleLabel="Update password" busyLabel="Updating…" />
      </form>
    </AuthShell>
  );
}

export default ResetPassword;
