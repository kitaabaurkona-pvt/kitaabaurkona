import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../hooks/useToast';
import { actOnNdr, CARRIER_NAMES, carrierOf, listNdr } from '../../services/shippingService';
import { LoadError, StateBlock } from '../../components/store/States';
import { LinesSkeleton } from '../../components/store/Skeletons';
import PageHead from '../../components/admin/PageHead';

// Parcels the courier could not deliver (NDR): ask for another attempt, or give the
// courier a new address or phone number. Moved here from Shipping (Orders menu).
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
        <Link to={`/admin/orders/track?q=${encodeURIComponent(item.order_number ?? '')}`}>Order {item.order_number}</Link> · {carrierName} AWB {item.awb} · {item.customer}
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

function AdminFailedDeliveries() {
  useDocumentTitle('Non-delivery report (NDR)');
  const ndr = useAsync(() => listNdr(), []);
  const { show } = useToast();

  return (
    <div className="stack">
      <PageHead title="Non-delivery report (NDR)" />
      <section className="panel stack-sm" aria-label="Failed delivery attempts">
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

export default AdminFailedDeliveries;
