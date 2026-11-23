import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import {
  adminErrorMessage,
  adminSetOrderNote,
  adminSetOrderStatus,
  adminSetStage,
  adminUpdateOrderAddress,
  fulfilmentOf,
  NEXT_STATUSES,
  stageOf,
  STAGES,
} from '../../services/adminService';
import { useToast } from '../../hooks/useToast';
import { formatDate, formatOrderNumber, formatPrice, ORDER_STATUS_LABELS, plural } from '../../utils/format';
import { INDIAN_STATES, normalizeShipping, validateShipping } from '../../utils/storeForm';
import OrderStatus from '../store/OrderStatus';
import ParcelPanel from './ParcelPanel';

const TO_SHIP = ['confirmed', 'paid'];
const stageName = (value) => STAGES.find(([v]) => v === value)?.[1] ?? value;

// Where the order is in Print -> Pack -> Handover, and a way to move it to another step.
function StageControl({ order, onChanged }) {
  const current = stageOf(order);
  const [target, setTarget] = useState(current);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const { show } = useToast();
  const f = fulfilmentOf(order);

  async function move() {
    if (working || target === current) return;
    setWorking(true);
    setError(null);
    try {
      await adminSetStage([order.id], target);
      show({ message: `${formatOrderNumber(order.order_number)} moved to ${stageName(target)}` });
      onChanged();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="stack-sm">
      <p>
        Now at <strong>{stageName(current)}</strong>
        {f?.handed_over_at && ` · handed over ${formatDate(f.handed_over_at)}`}
      </p>
      <div className="inline-actions">
        <label className="visually-hidden" htmlFor={`stage-${order.id}`}>
          Move to step
        </label>
        <select id={`stage-${order.id}`} className="select select-sm" value={target} onChange={(e) => setTarget(e.target.value)}>
          {STAGES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-outline btn-sm" aria-busy={working} aria-disabled={target === current || undefined} onClick={move}>
          {working && <span className="spinner" aria-hidden="true" />}
          Move
        </button>
      </div>
      {error && <p className="notice" data-tone="error" role="alert">{error}</p>}
    </div>
  );
}

// The admins' private note on the order.
export function NoteEditor({ order, onChanged, onSaved }) {
  const saved = fulfilmentOf(order)?.note ?? '';
  const [note, setNote] = useState(saved);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const { show } = useToast();

  async function save() {
    if (working || note.trim() === saved) return;
    setWorking(true);
    setError(null);
    try {
      await adminSetOrderNote(order.id, note);
      show({ message: note.trim() ? 'Note saved' : 'Note removed' });
      onChanged();
      onSaved?.();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="stack-sm">
      <label className="visually-hidden" htmlFor={`note-${order.id}`}>
        Note about this order
      </label>
      <textarea
        id={`note-${order.id}`}
        className="textarea"
        rows={3}
        maxLength={500}
        placeholder="Only admins see this note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="inline-actions">
        <button type="button" className="btn btn-outline btn-sm" aria-busy={working} aria-disabled={note.trim() === saved || undefined} onClick={save}>
          {working && <span className="spinner" aria-hidden="true" />}
          Save note
        </button>
      </div>
      {error && <p className="notice" data-tone="error" role="alert">{error}</p>}
    </div>
  );
}

// Whether the courier has the address already: once a parcel is booked it keeps it.
const addressLocked = (order) =>
  !['pending_payment', 'confirmed', 'paid'].includes(order.status) ||
  (order.shipments ?? []).some((s) => s.kind === 'forward' && (!['queued', 'failed', 'cancelled'].includes(s.status) || (s.status === 'failed' && s.needs_check)));

function AddressEditor({ order, onChanged, onClose }) {
  const [form, setForm] = useState({
    name: order.shipping_name,
    phone: order.shipping_phone,
    address: order.shipping_address,
    city: order.shipping_city,
    state: order.shipping_state,
    pincode: order.shipping_pincode,
  });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const { show } = useToast();
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const id = (key) => `addr-${key}-${order.id}`;

  async function save(event) {
    event.preventDefault();
    if (working) return;
    const clean = normalizeShipping(form);
    const problem = validateShipping(clean);
    if (problem) return setError(problem.message);
    setWorking(true);
    setError(null);
    try {
      await adminUpdateOrderAddress(order.id, clean);
      show({ message: `Address of ${formatOrderNumber(order.order_number)} updated` });
      onChanged();
      onClose();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  const field = (key, label, props = {}) => (
    <div>
      <label className="label" htmlFor={id(key)}>
        {label}
      </label>
      <input id={id(key)} className="input" value={form[key]} onChange={(e) => set(key, e.target.value)} {...props} />
    </div>
  );

  return (
    <form className="stack-sm" onSubmit={save} noValidate>
      <div className="form-grid form-grid-2">
        {field('name', 'Name', { maxLength: 80, autoComplete: 'off' })}
        {field('phone', 'Mobile number', { maxLength: 10, inputMode: 'numeric' })}
        <div className="span-2">
          <label className="label" htmlFor={id('address')}>
            Address
          </label>
          <input id={id('address')} className="input" maxLength={300} value={form.address} onChange={(e) => set('address', e.target.value)} />
        </div>
        {field('city', 'City', { maxLength: 60 })}
        <div>
          <label className="label" htmlFor={id('state')}>
            State
          </label>
          <select id={id('state')} className="select" value={form.state} onChange={(e) => set('state', e.target.value)}>
            {!INDIAN_STATES.includes(form.state) && <option value={form.state}>{form.state}</option>}
            {INDIAN_STATES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        {field('pincode', 'PIN code', { maxLength: 6, inputMode: 'numeric' })}
      </div>
      {error && <p className="notice" data-tone="error" role="alert">{error}</p>}
      <div className="inline-actions">
        <button type="submit" className="btn btn-dark btn-sm" aria-busy={working}>
          {working && <span className="spinner" aria-hidden="true" />}
          Save address
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
          Keep as is
        </button>
      </div>
    </form>
  );
}

function CustomerSection({ order, onChanged, edit = false }) {
  const [editing, setEditing] = useState(edit);
  const locked = addressLocked(order);
  return (
    <>
      {editing && !locked ? (
        <AddressEditor order={order} onChanged={onChanged} onClose={() => setEditing(false)} />
      ) : (
        <address className="address">
          {order.shipping_name}, {order.shipping_phone}
          <br />
          {order.shipping_address}, {order.shipping_city}, {order.shipping_state} {order.shipping_pincode}
        </address>
      )}
      {!editing && !locked && (
        <button type="button" className="btn btn-outline btn-sm ap-sheet-action" onClick={() => setEditing(true)}>
          Edit address
        </button>
      )}
      {locked && TO_SHIP.includes(order.status) && <p className="page-meta">The parcel is booked, so the address is with the courier and can no longer change here.</p>}
    </>
  );
}

const ACTION_LABELS = {
  paid: 'Mark paid',
  shipped: 'Mark shipped',
  delivered: 'Mark delivered',
  cancelled: 'Cancel order',
};

function OrderActions({ order, onChanged, onCancel }) {
  const [working, setWorking] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState(null);
  const busy = useRef(false);
  const { show } = useToast();
  const next = NEXT_STATUSES[order.status] ?? [];
  if (next.length === 0) return null;

  async function apply(status) {
    if (busy.current) return;
    busy.current = true;
    setWorking(status);
    setError(null);
    try {
      await adminSetOrderStatus(order.id, status);
      show({ message: `${formatOrderNumber(order.order_number)} is now ${ORDER_STATUS_LABELS[status].toLowerCase()}` });
      onChanged();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      busy.current = false;
      setWorking(null);
      setConfirmCancel(false);
    }
  }

  return (
    <div className="stack-sm">
      <div className="inline-actions">
        {next
          .filter((status) => status !== 'cancelled')
          .map((status) => (
            <button key={status} type="button" className="btn btn-dark btn-sm" aria-busy={working === status} aria-disabled={Boolean(working) || undefined} onClick={() => apply(status)}>
              {working === status && <span className="spinner" aria-hidden="true" />}
              {ACTION_LABELS[status]}
            </button>
          ))}
        {next.includes('cancelled') && !confirmCancel && (
          <button type="button" className="btn btn-danger btn-sm" aria-disabled={Boolean(working) || undefined} onClick={() => !working && (onCancel ? onCancel(order) : setConfirmCancel(true))}>
            Cancel order
          </button>
        )}
        {confirmCancel && (
          <>
            <button type="button" className="btn btn-danger btn-sm" aria-busy={working === 'cancelled'} onClick={() => apply('cancelled')}>
              {working === 'cancelled' && <span className="spinner" aria-hidden="true" />}
              Yes, cancel {formatOrderNumber(order.order_number)}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirmCancel(false)}>
              Keep order
            </button>
          </>
        )}
      </div>
      {order.status === 'paid' && confirmCancel && <p className="page-meta">The books go back into stock.</p>}
      {error && <p className="notice" data-tone="error" role="alert">{error}</p>}
    </div>
  );
}

// Everything about one order, in a panel that slides in from the right: the books, the
// money, the address, the parcel (carrier, courier, booking, label) and status changes.
// focus: the section to show first ('address' also opens the address form, 'parcel').
function OrderDrawer({ order, focus = null, onClose, onChanged, onPrint, onCancel, printing = false }) {
  const orderId = order?.id;
  useEffect(() => {
    if (!orderId || !focus) return undefined;
    const timer = setTimeout(() => document.getElementById(`sheet-${focus}`)?.scrollIntoView({ block: 'start' }), 50);
    return () => clearTimeout(timer);
  }, [orderId, focus]);
  const total = Number(order?.total ?? order?.subtotal ?? 0);
  const toCollect = order?.payment_method === 'cod' ? Math.max(0, total - Number(order.amount_paid ?? 0)) : 0;

  return (
    <Dialog.Root open={Boolean(order)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ap-drawer-overlay" />
        {order && (
          <Dialog.Content className="ap-sheet ap" aria-describedby={undefined}>
            <div className="ap-sheet-head">
              <div>
                <Dialog.Title className="ap-sheet-title">{formatOrderNumber(order.order_number)}</Dialog.Title>
                <p className="page-meta">
                  Placed {formatDate(order.created_at)}
                  {order.is_test && ' · GoKwik sandbox test order (not shipped)'}
                </p>
              </div>
              <div className="inline-actions">
                <OrderStatus status={order.status} />
                <Dialog.Close asChild>
                  <button type="button" className="ap-icon-button" aria-label="Close order">
                    <X size={22} aria-hidden="true" />
                  </button>
                </Dialog.Close>
              </div>
            </div>

            <div className="ap-sheet-body">
              <section className="ap-sheet-section" aria-labelledby="sheet-books">
                <h3 id="sheet-books">{plural(order.item_count, 'book')}</h3>
                <ul className="admin-items">
                  {order.order_items.map((item) => (
                    <li key={item.sku}>
                      <span>
                        {item.title} × {item.quantity}
                        <span className="ap-book-sku">SKU {item.sku}</span>
                      </span>
                      <span className="tnum">{formatPrice(Number(item.unit_price) * item.quantity)}</span>
                    </li>
                  ))}
                </ul>
                <dl className="ap-sums">
                  {Number(order.discount_total) > 0 && (
                    <div>
                      <dt>Discount</dt>
                      <dd>−{formatPrice(order.discount_total)}</dd>
                    </div>
                  )}
                  {Number(order.other_charges) > 0 && (
                    <div>
                      <dt>Other charges</dt>
                      <dd>{formatPrice(order.other_charges)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Order total</dt>
                    <dd>{formatPrice(total)}</dd>
                  </div>
                  <div>
                    <dt>{order.payment_method === 'cod' ? 'Cash to collect' : 'Paid online'}</dt>
                    <dd>{formatPrice(order.payment_method === 'cod' ? toCollect : total)}</dd>
                  </div>
                </dl>
              </section>

              <section className="ap-sheet-section" aria-labelledby="sheet-address">
                <h3 id="sheet-address">Customer</h3>
                <CustomerSection key={order.id} order={order} onChanged={onChanged} edit={focus === 'address'} />
              </section>

              {TO_SHIP.includes(order.status) && (
                <section className="ap-sheet-section" aria-labelledby="sheet-stage">
                  <h3 id="sheet-stage">Packing step</h3>
                  <StageControl key={`${order.id}-${stageOf(order)}`} order={order} onChanged={onChanged} />
                </section>
              )}

              {onPrint && !['pending_payment', 'cancelled'].includes(order.status) && (
                <section className="ap-sheet-section" aria-labelledby="sheet-docs">
                  <h3 id="sheet-docs">Print</h3>
                  <div className="inline-actions">
                    {(order.shipments ?? []).some((s) => s.kind === 'forward' && s.status !== 'cancelled' && s.awb_number) && (
                      <button type="button" className="btn btn-outline btn-sm" aria-disabled={printing || undefined} onClick={() => !printing && onPrint('labels', order)}>
                        Label
                      </button>
                    )}
                    <button type="button" className="btn btn-outline btn-sm" aria-disabled={printing || undefined} onClick={() => !printing && onPrint('invoices', order)}>
                      Invoice
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" aria-disabled={printing || undefined} onClick={() => !printing && onPrint('slips', order)}>
                      Packing slip
                    </button>
                    {printing && <span className="spinner" aria-label="Preparing the PDF" />}
                  </div>
                </section>
              )}

              <section className="ap-sheet-section" aria-labelledby="sheet-note">
                <h3 id="sheet-note">Note</h3>
                <NoteEditor key={order.id} order={order} onChanged={onChanged} />
              </section>

              <section className="ap-sheet-section" aria-labelledby="sheet-parcel">
                <h3 id="sheet-parcel">Parcel</h3>
                <ParcelPanel order={order} onChanged={onChanged} />
                {!(order.shipments ?? []).length && <p className="page-meta">No parcel yet.</p>}
              </section>

              <section className="ap-sheet-section" aria-labelledby="sheet-status">
                <h3 id="sheet-status">Order status</h3>
                <OrderActions order={order} onChanged={onChanged} onCancel={onCancel} />
                {(NEXT_STATUSES[order.status] ?? []).length === 0 && <p className="page-meta">Nothing left to change.</p>}
              </section>
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default OrderDrawer;
