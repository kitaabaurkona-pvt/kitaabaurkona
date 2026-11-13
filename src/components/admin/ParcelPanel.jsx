import { useState } from 'react';
import {
  ADMIN_SHIPMENT_LABELS,
  bookNow,
  bookReturnPickup,
  cancelShipment,
  CARRIER_NAMES,
  CARRIER_PANELS,
  carrierOf,
  getLabel,
  getRates,
  linkAwb,
  setCarrier,
  setCourier,
} from '../../services/shippingService';
import { formatPrice } from '../../utils/format';

// One order's parcel(s) for the admin: carrier, state, courier, AWB, cost, label, and the
// actions that make sense right now. Every action runs in the shipping Edge Function.
// The admin decides which carrier (Xpressbees or Delhivery) ships each order, any time
// before it is booked.
function ParcelPanel({ order, onChanged }) {
  const shipments = order.shipments ?? [];
  const forward = shipments.find((s) => s.kind === 'forward' && s.status !== 'cancelled') ?? null;
  const reverse = shipments.find((s) => s.kind === 'reverse' && s.status !== 'cancelled') ?? null;
  const [working, setWorking] = useState(null);
  const [error, setError] = useState(null);
  const [rates, setRates] = useState(null);
  const [choice, setChoice] = useState('');
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [awb, setAwb] = useState('');
  const [confirmRebook, setConfirmRebook] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);

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

  // Delhivery makes its label on request. The tab is opened at the click (so it is not
  // blocked as a pop-up) and pointed at the label once the link arrives.
  async function openLabel(s) {
    if (working) return;
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setWorking(`label-${s.id}`);
    setError(null);
    try {
      const { url } = await getLabel(order.id, s.kind);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (err) {
      tab?.close();
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

  const carrier = carrierOf(forward);
  const carrierName = CARRIER_NAMES[carrier];
  const other = carrier === 'delhivery' ? 'xpressbees' : 'delhivery';
  const canBook = forward && ['queued', 'failed'].includes(forward.status);
  // The carrier answered a booking unclearly: it may be booked there already.
  const held = Boolean(forward?.needs_check) && forward.status === 'failed';
  const label = (s) => (s.needs_check && s.status === 'failed' ? ADMIN_SHIPMENT_LABELS.needs_check : (ADMIN_SHIPMENT_LABELS[s.status] ?? s.status));
  const canReturn = order.status === 'delivered' && !reverse;
  if (!forward && !reverse && !canReturn) return null;

  function switchCarrier(checked) {
    run('carrier', async () => {
      await setCarrier(order.id, other, checked);
      setRates(null);
      setConfirmSwitch(false);
      setConfirmRebook(false);
    });
  }

  return (
    <div className="parcel-admin stack-sm">
      {[forward, reverse].filter(Boolean).map((s) => {
        const sCarrier = carrierOf(s);
        const showsCourier = s.courier_name && !s.courier_name.startsWith(CARRIER_NAMES[sCarrier]);
        return (
          <div key={s.id} className="parcel-admin-row">
            <p className="parcel-admin-title">
              {s.kind === 'reverse' ? 'Return pickup' : 'Parcel'}: <span className="status" data-status={s.needs_check && s.status === 'failed' ? 'exception' : s.status}>{label(s)}</span>
            </p>
            <p className="page-meta">
              {[
                showsCourier ? `${CARRIER_NAMES[sCarrier]} · ${s.courier_name}` : (s.courier_name ?? CARRIER_NAMES[sCarrier]),
                s.awb_number && `AWB ${s.awb_number}`,
                s.total_charges != null && `Courier cost ${formatPrice(s.total_charges)}`,
                s.status === 'queued' && 'Waiting to be booked (books within a few minutes while automatic booking is on)',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {s.status === 'failed' && s.last_error && <p className="notice" data-tone="error">{s.last_error}</p>}
            {s === forward && held && (
              <div className="parcel-check stack-sm">
                <p className="page-meta">
                  Open the{' '}
                  <a href={CARRIER_PANELS[carrier]} target="_blank" rel="noopener noreferrer">
                    {carrierName} panel
                  </a>{' '}
                  and search for <strong>KAK-{order.order_number}</strong>. If it is booked there, paste its AWB here. If it is not, book it again or send it with {CARRIER_NAMES[other]}.
                </p>
                <div className="inline-actions">
                  <label className="visually-hidden" htmlFor={`awb-${order.id}`}>
                    AWB number from {carrierName}
                  </label>
                  <input
                    id={`awb-${order.id}`}
                    className="input input-sm"
                    inputMode="numeric"
                    maxLength={30}
                    placeholder="AWB number"
                    value={awb}
                    onChange={(e) => setAwb(e.target.value.replace(/[^0-9A-Za-z]/g, ''))}
                  />
                  {button('link', 'Link this AWB', () =>
                    run('link', async () => {
                      if (!/^[0-9A-Za-z]{6,30}$/.test(awb)) throw new Error(`Enter the AWB number shown in ${carrierName}.`);
                      await linkAwb(order.id, awb);
                      setAwb('');
                    }),
                  )}
                </div>
              </div>
            )}
            {s.label_url && sCarrier === 'xpressbees' && (
              <a className="btn btn-outline btn-sm" href={s.label_url} target="_blank" rel="noopener noreferrer">
                Open shipping label
              </a>
            )}
            {sCarrier === 'delhivery' && s.awb_number && ['booked', 'in_transit', 'out_for_delivery', 'exception'].includes(s.status) &&
              button(`label-${s.id}`, 'Open shipping label', () => openLabel(s))}
          </div>
        );
      })}

      {rates && canBook && (
        <div className="inline-actions">
          <label className="visually-hidden" htmlFor={`courier-${order.id}`}>
            Courier
          </label>
          <select id={`courier-${order.id}`} className="select select-sm" value={choice} onChange={(e) => setChoice(e.target.value)}>
            {rates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.total_charges != null ? ` · ${formatPrice(c.total_charges)}` : ''}
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
        {canBook && !held && button('book', `${forward.status === 'failed' ? 'Retry booking' : 'Book now'} with ${carrierName}`, () => run('book', () => bookNow(order.id)), 'btn btn-dark btn-sm')}
        {canBook && held && !confirmRebook && !confirmSwitch && button('book', `Not booked there: book again`, () => setConfirmRebook(true))}
        {canBook && held && confirmRebook && (
          <>
            {button('book', `Yes, KAK-${order.order_number} is not in ${carrierName}`, () => run('book', async () => {
              await bookNow(order.id, true);
              setConfirmRebook(false);
            }), 'btn btn-dark btn-sm')}
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirmRebook(false)}>
              Keep as is
            </button>
          </>
        )}
        {canBook && !rates && !confirmSwitch && !confirmRebook && button('rates', 'Change courier', loadRates)}
        {canBook && !held && button('carrier', `Ship with ${CARRIER_NAMES[other]} instead`, () => switchCarrier(false))}
        {canBook && held && !confirmSwitch && !confirmRebook && button('carrier', `Not booked there: ship with ${CARRIER_NAMES[other]}`, () => setConfirmSwitch(true))}
        {canBook && held && confirmSwitch && (
          <>
            {button('carrier', `Yes, KAK-${order.order_number} is not in ${carrierName}`, () => switchCarrier(true), 'btn btn-dark btn-sm')}
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirmSwitch(false)}>
              Keep as is
            </button>
          </>
        )}
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
