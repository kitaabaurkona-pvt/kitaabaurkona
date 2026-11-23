import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Warning, X } from '@phosphor-icons/react';
import {
  adminCancelOrder,
  adminErrorMessage,
  adminSetCallStatus,
  CALL_STATUSES,
  CANCEL_REASONS,
  CUSTOMER_CANCEL_REASONS,
  CUSTOMER_CANCELLED,
  fulfilmentOf,
} from '../../services/adminService';
import { useToast } from '../../hooks/useToast';
import { formatOrderNumber } from '../../utils/format';
import { NoteEditor } from './OrderDrawer';

// A small box in the middle of the screen (ShopDeck's pop-ups).
export function OrderDialog({ open, title, onClose, children }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ap-drawer-overlay" />
        <Dialog.Content className="ap-dialog ap" aria-describedby={undefined}>
          <div className="ap-dialog-head">
            <Dialog.Title className="ap-dialog-title">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="ap-icon-button" aria-label="Close">
                <X size={20} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function NoteDialog({ order, onClose, onChanged }) {
  return (
    <OrderDialog open={Boolean(order)} title={order ? `Notes · ${formatOrderNumber(order.order_number)}` : ''} onClose={onClose}>
      {order && <NoteEditor key={order.id} order={order} onChanged={onChanged} onSaved={onClose} />}
    </OrderDialog>
  );
}

// ShopDeck's "Customer Call Status and Order Related Remarks" (the Edit link under the customer).
function CallStatusForm({ order, onClose, onChanged }) {
  const f = fulfilmentOf(order);
  const [status, setStatus] = useState(f?.call_status ?? 'pending');
  const [remarks, setRemarks] = useState(f?.call_remarks ?? '');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const { show } = useToast();

  async function save(event) {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      await adminSetCallStatus(order.id, status, remarks);
      show({ message: `Call status of ${formatOrderNumber(order.order_number)} saved` });
      onChanged();
      onClose();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <form className="stack-sm" onSubmit={save}>
      <div>
        <label className="label" htmlFor="call-status">
          Customer Call Status<span className="ap-required" aria-hidden="true"> *</span>
        </label>
        <select id="call-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
          {CALL_STATUSES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="call-remarks">
          Order related remarks if any?
        </label>
        <input id="call-remarks" className="input" maxLength={100} placeholder="Add your remarks (max 100 characters)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </div>
      {error && (
        <p className="notice" data-tone="error" role="alert">
          {error}
        </p>
      )}
      <div className="inline-actions ap-dialog-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-dark btn-sm" aria-busy={working || undefined}>
          {working && <span className="spinner" aria-hidden="true" />}
          Save
        </button>
      </div>
    </form>
  );
}

export function CallStatusDialog({ order, onClose, onChanged }) {
  return (
    <OrderDialog open={Boolean(order)} title="Customer Call Status and Order Related Remarks" onClose={onClose}>
      {order && <CallStatusForm key={order.id} order={order} onClose={onClose} onChanged={onChanged} />}
    </OrderDialog>
  );
}

// ShopDeck's Cancel: a warning first, then "Select reason for cancellation" (kept for
// the courier in case of a return or an exchange).
function CancelFlow({ order, onClose, onChanged }) {
  const [step, setStep] = useState('warn');
  const [reason, setReason] = useState('');
  const [customerReason, setCustomerReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const busy = useRef(false);
  const { show } = useToast();
  const byCustomer = reason === CUSTOMER_CANCELLED;
  const needsRemarks = reason === 'Other' || (byCustomer && customerReason === 'Other');

  async function cancel(event) {
    event.preventDefault();
    if (busy.current) return;
    if (!reason) return setError('Choose the reason for cancelling.');
    if (byCustomer && !customerReason) return setError('Choose the customer’s reason.');
    if (needsRemarks && !remarks.trim()) return setError('Write what happened in the remarks.');
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      await adminCancelOrder(order.id, { reason, customerReason: byCustomer ? customerReason : null, remarks });
      show({ message: `${formatOrderNumber(order.order_number)} is now cancelled` });
      onChanged();
      onClose();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  if (step === 'warn') {
    return (
      <OrderDialog open title={`Cancel ${formatOrderNumber(order.order_number)}?`} onClose={onClose}>
        <div className="stack-sm ap-cancel-warn">
          <Warning size={44} weight="fill" aria-hidden="true" />
          <p className="ap-strong">You are about to cancel this order</p>
          <p className="page-meta">{order.status === 'pending_payment' ? 'The order was never paid, so nothing else changes.' : 'The books go back into stock and a booked parcel is cancelled with the courier.'}</p>
          <div className="inline-actions ap-dialog-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
              Not Now
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setStep('reason')}>
              Cancel Order
            </button>
          </div>
        </div>
      </OrderDialog>
    );
  }

  return (
    <OrderDialog open title="Select reason for cancellation" onClose={onClose}>
      <form className="stack-sm" onSubmit={cancel} noValidate>
        <div className="ap-reasons" role="radiogroup" aria-label="Reason for cancellation">
          {CANCEL_REASONS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              className="ap-reason"
              aria-checked={reason === value}
              onClick={() => {
                setReason(value);
                setError(null);
              }}
            >
              {value}
            </button>
          ))}
        </div>
        {byCustomer && (
          <div>
            <label className="label" htmlFor="cancel-customer-reason">
              Customer reason<span className="ap-required" aria-hidden="true"> *</span>
            </label>
            <select
              id="cancel-customer-reason"
              className="select"
              value={customerReason}
              onChange={(e) => {
                setCustomerReason(e.target.value);
                setError(null);
              }}
            >
              <option value="">Choose the customer’s reason</option>
              {CUSTOMER_CANCEL_REASONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        )}
        {reason && (
          <div>
            <label className="label" htmlFor="cancel-remarks">
              Remarks
              {needsRemarks && <span className="ap-required" aria-hidden="true"> *</span>}
            </label>
            <input id="cancel-remarks" className="input" maxLength={100} placeholder="Add your remarks (max 100 characters)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        )}
        {error && (
          <p className="notice" data-tone="error" role="alert">
            {error}
          </p>
        )}
        <div className="inline-actions ap-dialog-actions">
          <button type="submit" className="btn btn-dark btn-sm" aria-disabled={!reason || undefined} aria-busy={working || undefined}>
            {working && <span className="spinner" aria-hidden="true" />}
            Submit
          </button>
        </div>
      </form>
    </OrderDialog>
  );
}

export function CancelDialog({ order, onClose, onChanged }) {
  return order ? <CancelFlow key={order.id} order={order} onClose={onClose} onChanged={onChanged} /> : null;
}
