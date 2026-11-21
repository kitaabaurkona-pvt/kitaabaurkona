import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../hooks/useToast';
import {
  ADMIN_SHIPMENT_LABELS,
  CARRIER_NAMES,
  carrierOf,
  countDelhiveryAwaitingPickup,
  getShippingSettings,
  listProblemShipments,
  registerDelhiveryWarehouse,
  updateShippingSettings,
} from '../../services/shippingService';
import { adminErrorMessage } from '../../services/adminService';
import { formatDate } from '../../utils/format';
import { INDIAN_STATES } from '../../utils/storeForm';
import { LoadError, StateBlock } from '../../components/store/States';
import { LinesSkeleton } from '../../components/store/Skeletons';
import PageHead from '../../components/admin/PageHead';
import DelhiveryPickup from '../../components/admin/DelhiveryPickup';

const FIELDS = [
  ['warehouse_name', 'Xpressbees warehouse name (exactly as in your Xpressbees panel)', 100],
  ['delhivery_warehouse_name', 'Delhivery warehouse name (exactly as registered with Delhivery)', 100],
  ['pickup_name', 'Pickup contact name', 80],
  ['pickup_address', 'Pickup address', 200],
  ['pickup_city', 'City', 60],
  ['pickup_pincode', 'PIN code', 6],
  ['pickup_phone', 'Mobile number', 10],
  ['pickup_email', 'Contact email', 120],
];

function SettingsForm({ initial }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const { show } = useToast();
  const busy = useRef(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const [newSkip, setNewSkip] = useState('');
  const skips = form.skip_couriers ?? [];
  function addSkip() {
    const name = newSkip.trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!name || skips.some((x) => x.toLowerCase() === name.toLowerCase())) return setNewSkip('');
    set('skip_couriers', [...skips, name]);
    setNewSkip('');
  }

  function problem() {
    if (!/^[1-9][0-9]{5}$/.test(form.pickup_pincode)) return 'Enter a 6-digit PIN code.';
    if (!/^[6-9][0-9]{9}$/.test(form.pickup_phone)) return 'Enter a 10-digit mobile number.';
    if ('pickup_email' in form && !/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(form.pickup_email ?? '')) return 'Enter a contact email address.';
    return null;
  }

  async function save(event) {
    event.preventDefault();
    if (busy.current) return;
    const invalid = problem();
    if (invalid) return setError(invalid);
    busy.current = true;
    setSaving('save');
    setError(null);
    try {
      const saved = await updateShippingSettings(form);
      if (saved) setForm(saved);
      show({ message: 'Shipping settings saved' });
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  // Delhivery books parcels only for a pickup location registered on the account. This
  // saves the form, then registers the pickup address with Delhivery under the name above.
  async function registerWithDelhivery() {
    if (busy.current) return;
    const invalid = problem() ?? (!form.delhivery_warehouse_name?.trim() ? 'Type the Delhivery warehouse name first.' : null);
    if (invalid) return setError(invalid);
    busy.current = true;
    setSaving('register');
    setError(null);
    try {
      const saved = await updateShippingSettings(form);
      if (saved) setForm(saved);
    } catch (err) {
      setError(adminErrorMessage(err));
      busy.current = false;
      setSaving(false);
      return;
    }
    try {
      const r = await registerDelhiveryWarehouse();
      show({ message: r.created ? `Pickup address registered with Delhivery as "${r.name}"` : `Delhivery already has the pickup location "${r.name}"` });
    } catch (err) {
      setError(err.message);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <form className="panel stack-sm" onSubmit={save} noValidate aria-labelledby="ship-settings-heading">
      <h2 id="ship-settings-heading" className="panel-title">
        Booking
      </h2>
      <div className="switch-row switch-row-flush">
        <span id="auto-book-label">Book parcels automatically</span>
        <button type="button" role="switch" className="switch" aria-checked={form.auto_book} aria-labelledby="auto-book-label" onClick={() => set('auto_book', !form.auto_book)} />
      </div>
      <div>
        <label className="label" htmlFor="ship-default_carrier">
          Carrier for new orders
        </label>
        <select id="ship-default_carrier" className="select" value={form.default_carrier ?? 'xpressbees'} onChange={(e) => set('default_carrier', e.target.value)}>
          {Object.entries(CARRIER_NAMES).map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <p className="page-meta">
        {form.auto_book
          ? `New orders are booked with ${CARRIER_NAMES[form.default_carrier ?? 'xpressbees']} straight away. Turn automatic booking off to choose the carrier for each order in Orders before booking it.`
          : `New orders wait in Orders with ${CARRIER_NAMES[form.default_carrier ?? 'xpressbees']} selected. Switch any of them to the other carrier there, then book it.`}
      </p>
      {!form.warehouse_name && <p className="notice" data-tone="error">Nothing is booked with Xpressbees until its warehouse name is filled in.</p>}
      {!form.delhivery_warehouse_name && <p className="notice" data-tone="error">Nothing is booked with Delhivery until its warehouse name is filled in.</p>}
      <div className="stack-sm">
        <p className="label" id="skip-label">
          Xpressbees couriers never booked automatically
        </p>
        <p className="page-meta">A courier lands here by itself when Xpressbees answers a booking with it unclearly. Remove it to use it again.</p>
        {skips.length > 0 ? (
          <ul className="skip-list" aria-labelledby="skip-label">
            {skips.map((name) => (
              <li key={name}>
                <span>{name}</span>
                <button type="button" className="btn-link" onClick={() => set('skip_couriers', skips.filter((x) => x !== name))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="page-meta">None.</p>
        )}
        <div className="inline-actions">
          <label className="visually-hidden" htmlFor="skip-new">
            Courier name to skip
          </label>
          <input id="skip-new" className="input input-sm" maxLength={100} placeholder="Courier name, as Xpressbees lists it" value={newSkip} onChange={(e) => setNewSkip(e.target.value)} />
          <button type="button" className="btn btn-outline btn-sm" onClick={addSkip}>
            Add
          </button>
        </div>
      </div>
      <div className="form-grid form-grid-2">
        {FIELDS.map(([key, label, max]) => (
          <div key={key} className={['warehouse_name', 'delhivery_warehouse_name', 'pickup_address'].includes(key) ? 'span-2' : undefined}>
            <label className="label" htmlFor={`ship-${key}`}>
              {label}
            </label>
            <input id={`ship-${key}`} className="input" maxLength={max} value={form[key] ?? ''} onChange={(e) => set(key, e.target.value)} />
          </div>
        ))}
        <div>
          <label className="label" htmlFor="ship-pickup_state">
            State
          </label>
          <select id="ship-pickup_state" className="select" value={form.pickup_state} onChange={(e) => set('pickup_state', e.target.value)}>
            {INDIAN_STATES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <p className="notice" data-tone="error" role="alert">
          {error}
        </p>
      )}
      <div className="inline-actions">
        <button type="submit" className="btn btn-dark" aria-busy={saving === 'save'} aria-disabled={Boolean(saving) || undefined}>
          {saving === 'save' && <span className="spinner" aria-hidden="true" />}
          Save settings
        </button>
        {form.delhivery_warehouse_name?.trim() && (
          <button type="button" className="btn btn-outline" aria-busy={saving === 'register'} aria-disabled={Boolean(saving) || undefined} onClick={registerWithDelhivery}>
            {saving === 'register' && <span className="spinner" aria-hidden="true" />}
            Register pickup address with Delhivery
          </button>
        )}
      </div>
    </form>
  );
}

function AdminShipping() {
  useDocumentTitle('Shipping');
  const settings = useAsync(() => getShippingSettings(), []);
  const problems = useAsync(() => listProblemShipments(), []);
  const waiting = useAsync(() => countDelhiveryAwaitingPickup(), []);

  return (
    <div className="stack">
      <PageHead title="Shipping" />
      {settings.loading && !settings.data && <LinesSkeleton count={2} label="Loading shipping settings…" />}
      {settings.error && <LoadError onRetry={settings.retry} what="shipping settings" />}
      {settings.data && <SettingsForm initial={settings.data} />}
      {settings.data?.delhivery_warehouse_name && waiting.data != null && <DelhiveryPickup key={waiting.data} waiting={waiting.data} />}

      <section className="panel stack-sm" aria-labelledby="problems-heading">
        <h2 id="problems-heading" className="panel-title">Parcels needing attention</h2>
        {problems.loading && !problems.data && <LinesSkeleton count={2} label="Loading parcels…" />}
        {problems.error && <LoadError onRetry={problems.retry} what="parcels" />}
        {problems.data && problems.data.length === 0 && <StateBlock title="Nothing needs attention." />}
        {problems.data && problems.data.length > 0 && (
          <ul className="line-list">
            {problems.data.map((p) => (
              <li key={p.id} className="ndr-row">
                <p>
                  <span className="status" data-status={p.needs_check && p.status === 'failed' ? 'exception' : p.status}>
                    {p.needs_check && p.status === 'failed' ? ADMIN_SHIPMENT_LABELS.needs_check : (ADMIN_SHIPMENT_LABELS[p.status] ?? p.status)}
                  </span>{' '}
                  {CARRIER_NAMES[carrierOf(p)]} {p.kind === 'reverse' ? 'return pickup' : 'parcel'}
                  {p.awb_number ? ` · AWB ${p.awb_number}` : ''} · updated {formatDate(p.updated_at)}
                </p>
                {p.last_error && <p className="page-meta">{p.last_error}</p>}
              </li>
            ))}
          </ul>
        )}
        <Link to="/admin/orders" className="section-link">Open orders to retry or cancel</Link>
      </section>

    </div>
  );
}

export default AdminShipping;
