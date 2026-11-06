import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWishlist } from '../hooks/useWishlist';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { getProfile, updateProfile } from '../services/profileService';
import { listOrders } from '../services/orderService';
import { formatCount } from '../utils/format';
import { GENDER_OPTIONS, normalizeName } from '../utils/authForm';
import { LoadError, Loading } from '../components/store/States';

const GENDER_LABELS = Object.fromEntries(GENDER_OPTIONS.map((o) => [o.value, o.label]));

function validateProfile(p) {
  if (p.full_name && (p.full_name.length < 2 || p.full_name.length > 80)) return { field: 'acc-name', message: 'Enter your full name (2-80 characters).' };
  if (p.phone && !/^[6-9][0-9]{9}$/.test(p.phone)) return { field: 'acc-phone', message: 'Enter a valid 10-digit mobile number.' };
  if (p.address && p.address.length > 300) return { field: 'acc-address', message: 'Address must be at most 300 characters.' };
  return null;
}

function EditProfile({ userId, profile, onSaved, onCancel }) {
  const [form, setForm] = useState({
    full_name: profile.full_name ?? '',
    phone: profile.phone ?? '',
    gender: profile.gender ?? '',
    address: profile.address ?? '',
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const set = (key) => (event) => setForm((c) => ({ ...c, [key]: event.target.value }));
  const msg = (id) => (error?.field === id ? error.message : null);

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy.current) return;
    const values = {
      full_name: normalizeName(form.full_name) || null,
      phone: form.phone.replace(/\D/g, '') || null,
      gender: form.gender || null,
      address: form.address.trim() || null,
    };
    const problem = validateProfile(values);
    if (problem) {
      setError(problem);
      document.getElementById(problem.field)?.focus();
      return;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateProfile(userId, values);
      onSaved(saved);
    } catch {
      busy.current = false;
      setSaving(false);
      setError({ field: null, message: 'Your details could not be saved. Try again.' });
    }
  }

  return (
    <form className="panel stack-sm" onSubmit={handleSubmit} noValidate aria-labelledby="edit-heading">
      <h2 id="edit-heading" className="panel-title">
        Edit details
      </h2>
      <div className="form-grid form-grid-2">
        <div>
          <label className="label" htmlFor="acc-name">Full name</label>
          <input id="acc-name" className="input" autoComplete="name" maxLength={80} value={form.full_name} onChange={set('full_name')} aria-invalid={msg('acc-name') ? 'true' : undefined} />
          {msg('acc-name') && <p className="field-message" role="alert">{msg('acc-name')}</p>}
        </div>
        <div>
          <label className="label" htmlFor="acc-phone">Mobile number</label>
          <input id="acc-phone" className="input" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10} value={form.phone} onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} aria-invalid={msg('acc-phone') ? 'true' : undefined} />
          {msg('acc-phone') && <p className="field-message" role="alert">{msg('acc-phone')}</p>}
        </div>
        <div>
          <label className="label" htmlFor="acc-gender">Gender</label>
          <select id="acc-gender" className="select" value={form.gender} onChange={set('gender')}>
            <option value="">Not set</option>
            {GENDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="span-2">
          <label className="label" htmlFor="acc-address">Delivery address</label>
          <textarea id="acc-address" className="textarea" rows={3} maxLength={300} autoComplete="street-address" value={form.address} onChange={set('address')} aria-invalid={msg('acc-address') ? 'true' : undefined} />
          {msg('acc-address') && <p className="field-message" role="alert">{msg('acc-address')}</p>}
        </div>
      </div>
      {error && !error.field && <p className="notice" data-tone="error" role="alert">{error.message}</p>}
      <div className="inline-actions">
        <button type="submit" className="btn btn-primary" aria-busy={saving} aria-disabled={saving || undefined}>
          {saving && <span className="spinner" aria-hidden="true" />}
          {saving ? 'Saving…' : 'Save details'}
        </button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Account() {
  useDocumentTitle('Account');
  const navigate = useNavigate();
  const { user, role, signOut } = useAuth();
  const { count: savedCount } = useWishlist();
  const profile = useAsync(() => getProfile(user.id), [user.id]);
  const orders = useAsync(() => listOrders(), []);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      navigate('/sign-in', { replace: true });
    } catch {
      setSigningOut(false);
      setNotice({ tone: 'error', text: 'Could not sign out. Try again.' });
    }
  }

  const p = profile.data ?? {};
  const details = [
    ['Name', p.full_name],
    ['Email', p.email ?? user.email],
    ['Mobile number', p.phone],
    ['Gender', GENDER_LABELS[p.gender]],
    ['Delivery address', p.address],
  ];

  return (
    <div className="container page">
      <div className="page-head">
        <h1 className="page-title">Account</h1>
      </div>

      <div className="stack">
        <div className="stat-row">
          <Link to="/orders" className="stat">
            <span className="stat-value">{orders.data ? formatCount(orders.data.length) : '–'}</span>
            <span className="stat-label">Orders</span>
          </Link>
          <Link to="/wishlist" className="stat">
            <span className="stat-value">{formatCount(savedCount)}</span>
            <span className="stat-label">Saved books</span>
          </Link>
        </div>

        {notice && (
          <p className="notice" data-tone={notice.tone} role="status">
            {notice.text}
          </p>
        )}

        {profile.loading && <Loading label="Loading your details…" />}
        {profile.error && <LoadError onRetry={profile.retry} what="your details" />}
        {profile.data !== undefined && !editing && (
          <section className="stack-sm" aria-labelledby="details-heading">
            <div className="section-head">
              <h2 id="details-heading" className="section-title">
                Your details
              </h2>
              <button type="button" className="btn-link" onClick={() => { setNotice(null); setEditing(true); }}>
                Edit
              </button>
            </div>
            <dl className="info-list">
              {details.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value || 'Not added'}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {profile.data !== undefined && editing && (
          <EditProfile
            userId={user.id}
            profile={p}
            onCancel={() => setEditing(false)}
            onSaved={(saved) => {
              profile.setData(saved);
              setEditing(false);
              setNotice({ tone: 'ok', text: 'Your details were saved.' });
            }}
          />
        )}

        <div className="inline-actions">
          {role === 'admin' && (
            <Link to="/admin" className="btn btn-dark">
              Open admin panel
            </Link>
          )}
          <button type="button" className="btn btn-outline" aria-busy={signingOut} onClick={handleSignOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Account;
