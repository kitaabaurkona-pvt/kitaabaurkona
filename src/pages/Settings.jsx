import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useCart } from '../hooks/useCart';
import { usePreferences } from '../hooks/usePreferences';
import { useToast } from '../hooks/useToast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PASSWORD_MAX_LENGTH, updatePasswordErrorMessage, validatePasswordPair } from '../utils/authForm';
import { plural } from '../utils/format';
import { Reveal } from '../components/motion/Reveal';

const SECTIONS = [
  ['appearance', 'Appearance'],
  ['security', 'Password'],
  ['sessions', 'Sessions'],
  ['cart', 'Cart'],
  ['more', 'More'],
];

function OptionGroup({ name, legend, value, options, onChange }) {
  return (
    <fieldset className="option-fieldset">
      <legend className="label">{legend}</legend>
      <div className="option-group">
        {options.map(([optionValue, label]) => (
          <label key={optionValue} className="option">
            <input
              type="radio"
              name={name}
              value={optionValue}
              checked={value === optionValue}
              onChange={() => onChange(optionValue)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ChangePassword() {
  const { updatePassword } = useAuth();
  const { show } = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy.current) return;
    const problem = validatePasswordPair(password, confirm);
    if (problem) {
      setError(problem);
      document.getElementById(problem.field === 'password' ? 'new-password' : 'new-password-confirm')?.focus();
      return;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await updatePassword(password);
      setPassword('');
      setConfirm('');
      show({ message: 'Password changed. Other devices have been signed out.' });
    } catch (err) {
      setError({ field: null, message: updatePasswordErrorMessage(err) });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const fieldError = (field) => (error?.field === field ? error.message : null);

  return (
    <form className="form-grid form-grid-2" onSubmit={handleSubmit} noValidate>
      <div>
        <label className="label" htmlFor="new-password">
          New password
        </label>
        <input
          id="new-password"
          className="input"
          type="password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          placeholder="Minimum 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={fieldError('password') ? 'true' : undefined}
        />
        {fieldError('password') && <p className="field-message" role="alert">{fieldError('password')}</p>}
      </div>
      <div>
        <label className="label" htmlFor="new-password-confirm">
          Confirm new password
        </label>
        <input
          id="new-password-confirm"
          className="input"
          type="password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={fieldError('confirm-password') ? 'true' : undefined}
        />
        {fieldError('confirm-password') && <p className="field-message" role="alert">{fieldError('confirm-password')}</p>}
      </div>
      {error && !error.field && (
        <p className="notice span-2" data-tone="error" role="alert">
          {error.message}
        </p>
      )}
      <div className="span-2">
        <button type="submit" className="btn btn-primary" aria-busy={saving} aria-disabled={saving || undefined}>
          {saving && <span className="spinner" aria-hidden="true" />}
          {saving ? 'Changing…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}

function Settings() {
  useDocumentTitle('Settings');
  const navigate = useNavigate();
  const { theme, motion, setTheme, setMotion } = usePreferences();
  const { signOutEverywhere } = useAuth();
  const { count, clear } = useCart();
  const { show } = useToast();
  const [confirmClear, setConfirmClear] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOutEverywhere() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOutEverywhere();
      navigate('/sign-in', { replace: true });
    } catch {
      setSigningOut(false);
      show({ message: 'Could not sign out everywhere. Try again.', tone: 'error' });
    }
  }

  function handleClearCart() {
    clear();
    setConfirmClear(false);
    show({ message: 'Your cart is now empty.' });
  }

  return (
    <div className="container page">
      <div className="page-head">
        <h1 className="page-title">Settings</h1>
      </div>

      <div className="settings-grid">
        <nav className="settings-nav" aria-label="Settings sections">
          <ul>
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a className="chip" href={`#${id}`}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="stack">
          <Reveal as="section" id="appearance" className="panel settings-section" aria-labelledby="appearance-heading">
            <h2 id="appearance-heading" className="panel-title">
              Appearance
            </h2>
            <div className="stack-sm">
              <OptionGroup
                name="theme"
                legend="Theme"
                value={theme}
                onChange={setTheme}
                options={[
                  ['system', 'System'],
                  ['light', 'Light'],
                  ['dark', 'Dark'],
                ]}
              />
              <div className="setting-row">
                <div>
                  <h3 id="motion-label">Reduce animations</h3>
                  <p>Turns off page, card and menu animations on this device.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  className="switch"
                  aria-checked={motion === 'reduce'}
                  aria-labelledby="motion-label"
                  onClick={() => setMotion(motion === 'reduce' ? 'system' : 'reduce')}
                />
              </div>
            </div>
          </Reveal>

          <Reveal as="section" id="security" className="panel settings-section" aria-labelledby="security-heading">
            <h2 id="security-heading" className="panel-title">
              Password
            </h2>
            <ChangePassword />
          </Reveal>

          <Reveal as="section" id="sessions" className="panel settings-section" aria-labelledby="sessions-heading">
            <h2 id="sessions-heading" className="panel-title">
              Sessions
            </h2>
            <div className="setting-row">
              <div>
                <h3>Sign out of all devices</h3>
                <p>Ends every session for your account, including this one.</p>
              </div>
              <button type="button" className="btn btn-outline" aria-busy={signingOut} onClick={handleSignOutEverywhere}>
                {signingOut ? 'Signing out…' : 'Sign out everywhere'}
              </button>
            </div>
          </Reveal>

          <Reveal as="section" id="cart" className="panel settings-section" aria-labelledby="cart-heading">
            <h2 id="cart-heading" className="panel-title">
              Cart
            </h2>
            <div className="setting-row">
              <div>
                <h3>Clear cart</h3>
                <p>{count > 0 ? `${plural(count, 'item')} saved in this browser.` : 'Your cart is empty.'}</p>
              </div>
              {count > 0 && !confirmClear && (
                <button type="button" className="btn btn-danger" onClick={() => setConfirmClear(true)}>
                  Clear cart
                </button>
              )}
              {count > 0 && confirmClear && (
                <div className="inline-actions">
                  <button type="button" className="btn btn-danger" onClick={handleClearCart}>
                    Yes, clear cart
                  </button>
                  <button type="button" className="btn btn-outline" onClick={() => setConfirmClear(false)}>
                    Keep items
                  </button>
                </div>
              )}
            </div>
          </Reveal>

          <Reveal as="section" id="more" className="panel settings-section" aria-labelledby="more-heading">
            <h2 id="more-heading" className="panel-title">
              More
            </h2>
            <div className="inline-actions">
              <Link to="/account" className="btn btn-outline">
                Edit account details
              </Link>
              <Link to="/terms" className="btn btn-outline">
                Terms and conditions
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  );
}

export default Settings;
