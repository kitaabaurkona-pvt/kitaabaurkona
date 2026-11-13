import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../hooks/useToast';
import {
  actOnNdr,
  ADMIN_SHIPMENT_LABELS,
  CARRIER_NAMES,
  carrierOf,
  countDelhiveryAwaitingPickup,
  getShippingSettings,
  listNdr,
  listProblemShipments,
  requestDelhiveryPickup,
  updateShippingSettings,
} from '../../services/shippingService';
import { adminErrorMessage } from '../../services/adminService';
import { formatDate } from '../../utils/format';
import { INDIAN_STATES } from '../../utils/storeForm';
import { LoadError, StateBlock } from '../../components/store/States';
import { LinesSkeleton } from '../../components/store/Skeletons';

// Today's date in India, as YYYY-MM-DD.
const indiaToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

const FIELDS = [
  ['warehouse_name', 'Xpressbees warehouse name (exactly as in your Xpressbees panel)', 100],
  ['delhivery_warehouse_name', 'Delhivery warehouse name (exactly as registered with Delhivery)', 100],
  ['pickup_name', 'Pickup contact name', 80],
  ['pickup_address', 'Pickup address', 200],
  ['pickup_city', 'City', 60],
  ['pickup_pincode', 'PIN code', 6],
  ['pickup_phone', 'Mobile number', 10],
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

  async function save(event) {
    event.preventDefault();
    if (busy.current) return;
    if (!/^[1-9][0-9]{5}$/.test(form.pickup_pincode)) return setError('Enter a 6-digit PIN code.');
    if (!/^[6-9][0-9]{9}$/.test(form.pickup_phone)) return setError('Enter a 10-digit mobile number.');
    busy.current = true;
    setSaving(true);
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
      <div>
        <button type="submit" className="btn btn-dark" aria-busy={saving}>
          {saving && <span className="spinner" aria-hidden="true" />}
          Save settings
        </button>
      </div>
    </form>
  );
}

function NdrRow({ item, onDone }) {
  const carrierName = CARRIER_NAMES[carrierOf(item)];
  const [mode, setMode] = useState(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [address, setAddress] = useState({ name: item.customer, address_1: '', address_2: '' });
  const [phone, setPhone] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (working) return;
    let action_data;
    if (mode === 're-attempt') action_data = { re_attempt_date: date };
    if (mode === 'change_address') action_data = { name: address.name, address_1: address.address_1, address_2: address.address_2 };
    if (mode === 'change_phone') action_data = { phone };
    setWorking(true);
    setError(null);
    try {
      const { results } = await actOnNdr([{ awb: item.awb, action: mode, action_data }]);
      if (results[0] && !results[0].ok) throw new Error(results[0].message || `${carrierName} refused that action.`);
      onDone(`Sent to ${carrierName} for AWB ${item.awb}`);
      setMode(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <li className="ndr-row stack-sm">
      <p>
        <Link to={`/admin/orders`}>Order {item.order_number}</Link> · {carrierName} AWB {item.awb} · {item.customer}
      </p>
      <p className="page-meta">
        {[item.remarks, item.date, item.attempts != null && `${item.attempts} attempt${item.attempts === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
      </p>
      <div className="inline-actions">
        <button type="button" className="chip" aria-pressed={mode === 're-attempt'} onClick={() => setMode('re-attempt')}>Re-attempt</button>
        <button type="button" className="chip" aria-pressed={mode === 'change_address'} onClick={() => setMode('change_address')}>Change address</button>
        <button type="button" className="chip" aria-pressed={mode === 'change_phone'} onClick={() => setMode('change_phone')}>Change phone</button>
      </div>
      {mode && (
        <div className="stack-sm">
          {mode === 're-attempt' && (
            <div>
              <label className="label" htmlFor={`ndr-date-${item.awb}`}>Re-attempt on</label>
              <input id={`ndr-date-${item.awb}`} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          )}
          {mode === 'change_address' && (
            <div className="form-grid">
              <div>
                <label className="label" htmlFor={`ndr-name-${item.awb}`}>Name</label>
                <input id={`ndr-name-${item.awb}`} className="input" maxLength={80} value={address.name} onChange={(e) => setAddress((a) => ({ ...a, name: e.target.value }))} />
              </div>
              <div>
                <label className="label" htmlFor={`ndr-a1-${item.awb}`}>Address line 1</label>
                <input id={`ndr-a1-${item.awb}`} className="input" maxLength={200} value={address.address_1} onChange={(e) => setAddress((a) => ({ ...a, address_1: e.target.value }))} />
              </div>
              <div>
                <label className="label" htmlFor={`ndr-a2-${item.awb}`}>Address line 2</label>
                <input id={`ndr-a2-${item.awb}`} className="input" maxLength={200} value={address.address_2} onChange={(e) => setAddress((a) => ({ ...a, address_2: e.target.value }))} />
              </div>
            </div>
          )}
          {mode === 'change_phone' && (
            <div>
              <label className="label" htmlFor={`ndr-phone-${item.awb}`}>New mobile number</label>
              <input id={`ndr-phone-${item.awb}`} className="input" inputMode="numeric" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} />
            </div>
          )}
          <div className="inline-actions">
            <button type="button" className="btn btn-dark btn-sm" aria-busy={working} onClick={submit}>
              {working && <span className="spinner" aria-hidden="true" />}
              Send to {carrierName}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setMode(null)}>Close</button>
          </div>
          {error && <p className="notice" data-tone="error" role="alert">{error}</p>}
        </div>
      )}
    </li>
  );
}

// Delhivery collects parcels only when asked: a date, a time and how many parcels.
function DelhiveryPickup({ waiting }) {
  const [date, setDate] = useState(indiaToday);
  const [time, setTime] = useState('14:00');
  const [count, setCount] = useState(() => String(Math.max(1, waiting)));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const { show } = useToast();

  async function submit(event) {
    event.preventDefault();
    if (working) return;
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 500) return setError('Enter how many parcels (1 to 500).');
    if (!/^\d{2}:\d{2}$/.test(time)) return setError('Choose a pickup time.');
    setWorking(true);
    setError(null);
    try {
      const r = await requestDelhiveryPickup({ date, time, count: n });
      show({ message: `Delhivery pickup ${r.pickup_id} requested for ${r.date} at ${r.time}` });
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <form className="panel stack-sm" onSubmit={submit} noValidate aria-labelledby="dl-pickup-heading">
      <h2 id="dl-pickup-heading" className="panel-title">
        Delhivery pickup
      </h2>
      <p className="page-meta">{waiting === 1 ? '1 Delhivery parcel is' : `${waiting} Delhivery parcels are`} booked and waiting to be collected.</p>
      <div className="form-grid form-grid-2">
        <div>
          <label className="label" htmlFor="dl-pickup-date">
            Date
          </label>
          <input id="dl-pickup-date" className="input" type="date" min={indiaToday()} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="dl-pickup-time">
            Time
          </label>
          <input id="dl-pickup-time" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="dl-pickup-count">
            Parcels
          </label>
          <input id="dl-pickup-count" className="input" inputMode="numeric" maxLength={3} value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} />
        </div>
      </div>
      {error && (
        <p className="notice" data-tone="error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button type="submit" className="btn btn-dark" aria-busy={working}>
          {working && <span className="spinner" aria-hidden="true" />}
          Request Delhivery pickup
        </button>
      </div>
    </form>
  );
}

function AdminShipping() {
  useDocumentTitle('Admin shipping');
  const settings = useAsync(() => getShippingSettings(), []);
  const problems = useAsync(() => listProblemShipments(), []);
  const ndr = useAsync(() => listNdr(), []);
  const waiting = useAsync(() => countDelhiveryAwaitingPickup(), []);
  const { show } = useToast();

  return (
    <div className="stack">
      {settings.loading && !settings.data && <LinesSkeleton count={2} label="Loading shipping settings…" />}
      {settings.error && <LoadError onRetry={settings.retry} what="shipping settings" />}
      {settings.data && <SettingsForm initial={settings.data} />}
      {settings.data?.delhivery_warehouse_name && waiting.data != null && <DelhiveryPickup key={waiting.data} waiting={waiting.data} />}

      <section className="stack-sm" aria-labelledby="problems-heading">
        <h2 id="problems-heading" className="section-title">Parcels needing attention</h2>
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

      <section className="stack-sm" aria-labelledby="ndr-heading">
        <h2 id="ndr-heading" className="section-title">Failed delivery attempts</h2>
        {ndr.loading && !ndr.data && <LinesSkeleton count={2} label="Asking the couriers for failed deliveries…" />}
        {ndr.error && <LoadError onRetry={ndr.retry} what="failed deliveries" />}
        {ndr.data?.unavailable?.length > 0 && (
          <p className="notice" data-tone="error">
            {ndr.data.unavailable.join(' and ')} could not be reached, so its failed deliveries are missing here.
          </p>
        )}
        {ndr.data && ndr.data.items.length === 0 && <StateBlock title="No failed delivery attempts." />}
        {ndr.data && ndr.data.items.length > 0 && (
          <ul className="line-list">
            {ndr.data.items.map((item) => (
              <NdrRow
                key={item.awb}
                item={item}
                onDone={(message) => {
                  show({ message });
                  ndr.retry();
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default AdminShipping;
