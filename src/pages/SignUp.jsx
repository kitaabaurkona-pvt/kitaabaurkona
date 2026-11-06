import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import AuthShell from '../components/auth/AuthShell';
import { useGoogleSignIn } from '../hooks/useGoogleSignIn';
import {
  AuthDivider,
  ChoiceGroup,
  GoogleButton,
  PasswordField,
  PhoneField,
  SubmitButton,
  TextField,
} from '../components/auth/fields';
import {
  ADDRESS_MAX_LENGTH,
  GENDER_OPTIONS,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  digitsOnly,
  focusField,
  normalizeEmail,
  normalizeName,
  signUpErrorMessage,
  validateSignUp,
} from '../utils/authForm';

const EMPTY_FORM = {
  fullName: '',
  email: '',
  phone: '',
  gender: '',
  password: '',
  confirmPassword: '',
  address: '',
};

function SignUp() {
  const { signUp, isAuthenticated, loading } = useAuth();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingEmail, setPendingEmail] = useState(null);
  const google = useGoogleSignIn();

  if (loading) return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const fieldError = (field) => (error?.field === field ? error.message : undefined);
  const setValue = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const onText = (key) => (event) => setValue(key, event.target.value);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const values = {
      fullName: normalizeName(form.fullName),
      email: normalizeEmail(form.email),
      phone: form.phone,
      gender: form.gender,
      password: form.password,
      confirmPassword: form.confirmPassword,
      address: form.address.trim(),
    };
    const invalid = validateSignUp(values);
    if (invalid) {
      setError(invalid);
      focusField(invalid.field);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const { session } = await signUp(values.email, values.password, {
        full_name: values.fullName,
        phone: values.phone,
        gender: values.gender,
        ...(values.address && { address: values.address }),
      });
      if (!session) {
        setForm(EMPTY_FORM);
        setPendingEmail(values.email);
      }
    } catch (err) {
      setError({ field: null, message: signUpErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  if (pendingEmail) {
    return (
      <AuthShell title="Check your email" backTo="/sign-in" backLabel="Back to log in">
        <p className="auth-notice">
          We sent a confirmation link to <strong>{pendingEmail}</strong>. Open it to activate your
          account.
        </p>
        <Link to="/sign-in" className="btn-primary">
          Go to log in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign up" backTo="/sign-in" backLabel="Back to log in">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <TextField
          id="full-name"
          label="Full name"
          type="text"
          autoComplete="name"
          maxLength={NAME_MAX_LENGTH}
          placeholder="Enter your full name"
          required
          value={form.fullName}
          onChange={onText('fullName')}
          error={fieldError('full-name')}
        />
        <TextField
          id="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          placeholder="Enter your email address"
          required
          value={form.email}
          onChange={onText('email')}
          error={fieldError('email')}
        />
        <PhoneField
          id="phone"
          label="Mobile number"
          prefix="+91"
          autoComplete="tel-national"
          maxLength={10}
          placeholder="Enter your mobile number"
          required
          value={form.phone}
          onChange={(event) => setValue('phone', digitsOnly(event.target.value, 10))}
          error={fieldError('phone')}
        />
        <ChoiceGroup
          name="gender"
          legend="Gender"
          options={GENDER_OPTIONS}
          value={form.gender}
          onChange={(value) => setValue('gender', value)}
          error={fieldError('gender')}
        />
        <PasswordField
          id="password"
          label="Password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          placeholder="Minimum 8 characters"
          required
          value={form.password}
          onChange={onText('password')}
          error={fieldError('password')}
        />
        <PasswordField
          id="confirm-password"
          label="Confirm password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          placeholder="Re-enter your password"
          required
          value={form.confirmPassword}
          onChange={onText('confirmPassword')}
          error={fieldError('confirm-password')}
        />
        <TextField
          id="address"
          label="Delivery address"
          multiline
          rows={3}
          autoComplete="street-address"
          maxLength={ADDRESS_MAX_LENGTH}
          placeholder="Enter street address, city, pincode..."
          value={form.address}
          onChange={onText('address')}
          error={fieldError('address')}
        />
        {error && !error.field && (
          <p className="auth-error" role="alert">
            {error.message}
          </p>
        )}
        <SubmitButton busy={submitting} idleLabel="Create account" busyLabel="Creating account…" />
      </form>
      <AuthDivider />
      <GoogleButton busy={google.busy} onClick={google.start} error={google.error} />
      <p className="auth-switch">
        Already have an account?
        <Link to="/sign-in">Log in</Link>
      </p>
    </AuthShell>
  );
}

export default SignUp;
