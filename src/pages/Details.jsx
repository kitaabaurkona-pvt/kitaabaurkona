import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { getProfile, updateProfile } from '../services/profileService';
import { safeRedirect } from '../utils/authForm';
import { INDIAN_STATES, normalizeShipping, validateShipping } from '../utils/storeForm';
import { forgetLoginPhone, loginPhone } from '../utils/loginPhone';
import { LoadError } from '../components/store/States';
import { LinesSkeleton } from '../components/store/Skeletons';

function Field({ id, label, error, children }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="field-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// "Your details": name, mobile and delivery address, filled in once and saved on the
// customer's own account. New customers land here after logging in (DetailsGate); the
// saved details then fill checkout and My Account.
function DetailsForm({ userId, profile, onSaved, onSkip }) {
  const [form, setForm] = useState(() => ({
    name: profile.full_name ?? '',
    phone: profile.phone || loginPhone() || '',
    address: profile.address ?? '',
    city: profile.city ?? '',
    state: profile.state ?? '',
    pincode: profile.pincode ?? '',
  }));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const set = (key) => (event) => setForm((c) => ({ ...c, [key]: event.target.value }));
  const digits = (key, max) => (event) => setForm((c) => ({ ...c, [key]: event.target.value.replace(/\D/g, '').slice(0, max) }));
  const fieldError = (id) => (error?.field === id ? error.message : undefined);
  const invalid = (id) => ({ 'aria-invalid': fieldError(id) ? 'true' : undefined, 'aria-describedby': fieldError(id) ? `${id}-error` : undefined });

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy.current) return;
    const s = normalizeShipping(form);
    const problem = validateShipping(s);
    if (problem) {
      setError(problem);
      document.getElementById(problem.field)?.focus();
      return;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await updateProfile(userId, { full_name: s.name, phone: s.phone, address: s.address, city: s.city, state: s.state, pincode: s.pincode });
      forgetLoginPhone();
      await onSaved();
    } catch {
      busy.current = false;
      setSaving(false);
      setError({ field: null, message: 'Your details could not be saved. Try again.' });
    }
  }

  return (
    <form className="panel stack-sm details-form" onSubmit={handleSubmit} noValidate aria-labelledby="details-form-heading">
      <h2 id="details-form-heading" className="panel-title">
        Delivery details
      </h2>
      <div className="form-grid form-grid-2">
        <Field id="ship-name" label="Full name" error={fieldError('ship-name')}>
          <input id="ship-name" className="input" autoComplete="name" maxLength={80} value={form.name} onChange={set('name')} required {...invalid('ship-name')} />
        </Field>
        <Field id="ship-phone" label="Mobile number" error={fieldError('ship-phone')}>
          <input id="ship-phone" className="input" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10} value={form.phone} onChange={digits('phone', 10)} required {...invalid('ship-phone')} />
        </Field>
        <div className="span-2">
          <Field id="ship-address" label="House, street and area" error={fieldError('ship-address')}>
            <textarea id="ship-address" className="textarea" autoComplete="street-address" maxLength={300} rows={3} value={form.address} onChange={set('address')} required {...invalid('ship-address')} />
          </Field>
        </div>
        <Field id="ship-city" label="City" error={fieldError('ship-city')}>
          <input id="ship-city" className="input" autoComplete="address-level2" maxLength={60} value={form.city} onChange={set('city')} required {...invalid('ship-city')} />
        </Field>
        <Field id="ship-state" label="State" error={fieldError('ship-state')}>
          <select id="ship-state" className="select" autoComplete="address-level1" value={form.state} onChange={set('state')} required {...invalid('ship-state')}>
            <option value="">Choose a state</option>
            {INDIAN_STATES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="ship-pincode" label="PIN code" error={fieldError('ship-pincode')}>
          <input id="ship-pincode" className="input" inputMode="numeric" autoComplete="postal-code" maxLength={6} value={form.pincode} onChange={digits('pincode', 6)} required {...invalid('ship-pincode')} />
        </Field>
      </div>
      {error && !error.field && (
        <p className="notice" data-tone="error" role="alert">
          {error.message}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-block" aria-busy={saving} aria-disabled={saving || undefined}>
        {saving && <span className="spinner" aria-hidden="true" />}
        {saving ? 'Saving…' : 'Save and continue'}
      </button>
      {onSkip && (
        <button type="button" className="btn btn-outline btn-block" onClick={onSkip} disabled={saving}>
          Skip for now
        </button>
      )}
    </form>
  );
}

function Details() {
  useDocumentTitle('Your details');
  const { user, signOut, refreshDetails, skipDetails } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const profile = useAsync(() => getProfile(user.id), [user.id]);
  const [signingOut, setSigningOut] = useState(false);
  const goingTo = safeRedirect(location.state?.from);
  // Checkout needs the details, so it offers no skipping; anywhere else they can wait.
  const forCheckout = goingTo === '/checkout' || goingTo.startsWith('/checkout?');

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      navigate('/sign-in', { replace: true });
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <div className="container page details-page">
      <div className="page-head">
        <h1 className="page-title">Your details</h1>
      </div>
      {profile.loading && <LinesSkeleton count={3} label="Loading your details…" />}
      {profile.error && <LoadError onRetry={profile.retry} what="your details" />}
      {profile.data !== undefined && !profile.loading && (
        <DetailsForm
          userId={user.id}
          profile={profile.data ?? {}}
          onSaved={async () => {
            await refreshDetails();
            navigate(goingTo, { replace: true });
          }}
          onSkip={
            forCheckout
              ? null
              : () => {
                  skipDetails();
                  navigate(goingTo, { replace: true });
                }
          }
        />
      )}
      <button type="button" className="btn btn-outline details-sign-out" onClick={handleSignOut} aria-busy={signingOut}>
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}

export default Details;
