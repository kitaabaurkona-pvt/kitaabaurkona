import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import AuthShell from '../components/auth/AuthShell';
import {
  AuthDivider,
  GoogleButton,
  PasswordField,
  SubmitButton,
  TextField,
} from '../components/auth/fields';
import { useGoogleSignIn } from '../hooks/useGoogleSignIn';
import Splash from '../components/Splash';
import {
  focusField,
  normalizeEmail,
  safeRedirect,
  signInErrorMessage,
  validateSignIn,
} from '../utils/authForm';

function SignIn() {
  const { signIn, isAuthenticated, loading } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const google = useGoogleSignIn(location.state?.from);

  if (loading) return <Splash />;
  if (isAuthenticated) return <Navigate to={safeRedirect(location.state?.from)} replace />;

  const fieldError = (field) => (error?.field === field ? error.message : undefined);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const values = { email: normalizeEmail(email), password };
    const invalid = validateSignIn(values);
    if (invalid) {
      setError(invalid);
      focusField(invalid.field);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await signIn(values.email, values.password);
    } catch (err) {
      setError({ field: null, message: signInErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title="Log in" backTo="/" backLabel="Back to home">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <TextField
          id="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          placeholder="Enter your email address"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldError('email')}
        />
        <PasswordField
          id="password"
          label="Password"
          autoComplete="current-password"
          labelAction={
            <Link to="/forgot-password" className="field-link">
              Forgot password?
            </Link>
          }
          maxLength={72}
          placeholder="Enter your password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldError('password')}
        />
        {error && !error.field && (
          <p className="auth-error" role="alert">
            {error.message}
          </p>
        )}
        <SubmitButton busy={submitting} idleLabel="Log in" busyLabel="Logging in…" />
      </form>
      <AuthDivider />
      <GoogleButton busy={google.busy} onClick={google.start} error={google.error} />
      <p className="auth-switch">
        New to Kitaab Aur Kona?
        <Link to="/sign-up">Sign up</Link>
      </p>
    </AuthShell>
  );
}

export default SignIn;
