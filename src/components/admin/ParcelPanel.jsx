import { useState } from 'react';
import { ADMIN_SHIPMENT_LABELS, bookNow, bookReturnPickup, cancelShipment, getRates, setCourier } from '../../services/shippingService';
import { formatPrice } from '../../utils/format';

// One order's parcel(s) for the admin: state, courier, AWB, cost, label, and the actions
// that make sense right now. Every action runs in the shipping Edge Function.
function ParcelPanel({ order, onChanged }) {
  const shipments = order.shipments ?? [];
  const forward = shipments.find((s) => s.kind === 'forward' && s.status !== 'cancelled') ?? null;
  const reverse = shipments.find((s) => s.kind === 'reverse' && s.status !== 'cancelled') ?? null;
  const [working, setWorking] = useState(null);
  const [error, setError] = useState(null);
  const [rates, setRates] = useState(null);
  const [choice, setChoice] = useState('');
  const [confirmReturn, setConfirmReturn] = useState(false);

  async function run(name, fn) {
    if (working) return;
    setWorking(name);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(null);
    }
  }

  async function loadRates() {
    if (working) return;
    setWorking('rates');
    setError(null);
    try {
      const r = await getRates(order.id);
      setRates(r.couriers);
      setChoice(r.chosen ?? r.couriers[0]?.id ?? '');
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(null);
    }
  }

  const button = (name, label, onClick, className = 'btn btn-outline btn-sm') => (
    <button type="button" className={className} aria-busy={working === name} aria-disabled={Boolean(working) || undefined} onClick={onClick}>
      {working === name && <span className="spinner" aria-hidden="true" />}
      {label}
    </button>
  );

  const canBook = forward && ['queued', 'failed'].includes(forward.status);
  const canReturn = order.status === 'delivered' && !reverse;
  if (!forward && !reverse && !canReturn) return null;

  return (
    <div className="parcel-admin stack-sm">
      {[forward, reverse].filter(Boolean).map((s) => (
        <div key={s.id} className="parcel-admin-row">
          <p className="parcel-admin-title">
            {s.kind === 'reverse' ? 'Return pickup' : 'Parcel'}: <span className="status" data-status={s.status}>{ADMIN_SHIPMENT_LABELS[s.status] ?? s.status}</span>
          </p>
          <p className="page-meta">
            {[
              s.courier_name,
              s.awb_number && `AWB ${s.awb_number}`,
              s.total_charges != null && `Courier cost ${formatPrice(s.total_charges)}`,
              s.status === 'queued' && 'Waiting to be booked (books within a few minutes while automatic booking is on)',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {s.status === 'failed' && s.last_error && <p className="notice" data-tone="error">{s.last_error}</p>}
          {s.label_url && (
            <a className="btn btn-outline btn-sm" href={s.label_url} target="_blank" rel="noopener noreferrer">
              Open shipping label
            </a>
          )}
        </div>
      ))}

      {rates && canBook && (
        <div className="inline-actions">
          <label className="visually-hidden" htmlFor={`courier-${order.id}`}>
            Courier
          </label>
          <select id={`courier-${order.id}`} className="select select-sm" value={choice} onChange={(e) => setChoice(e.target.value)}>
            {rates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {formatPrice(c.total_charges)}
              </option>
            ))}
          </select>
          {button('courier', 'Save courier', () =>
            run('courier', async () => {
              await setCourier(order.id, choice);
              setRates(null);
            }),
          )}
        </div>
      )}

      <div className="inline-actions">
        {canBook && button('book', forward.status === 'failed' ? 'Retry booking' : 'Book now', () => run('book', () => bookNow(order.id)), 'btn btn-dark btn-sm')}
        {canBook && !rates && button('rates', 'Change courier', loadRates)}
        {forward?.status === 'cancel_requested' && button('cancel', 'Cancel with courier now', () => run('cancel', () => cancelShipment(order.id)), 'btn btn-danger btn-sm')}
        {canReturn && !confirmReturn && button('return', 'Book return pickup', () => setConfirmReturn(true))}
        {canReturn && confirmReturn && (
          <>
            {button('return', `Yes, pick up order ${order.order_number}`, () => run('return', () => bookReturnPickup(order.id)), 'btn btn-dark btn-sm')}
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirmReturn(false)}>
              Keep as is
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="notice" data-tone="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default ParcelPanel;
