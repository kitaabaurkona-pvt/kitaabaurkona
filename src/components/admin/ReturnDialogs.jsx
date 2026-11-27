import { useEffect, useRef, useState } from 'react';
import {
  adminCloseReturnRequest,
  adminCreateReturnRequest,
  adminDecideReturn,
  adminErrorMessage,
  adminReturnPhotoUrls,
  adminSetReturnNote,
  adminSettleReturn,
} from '../../services/adminService';
import { tryReturnPickup } from '../../services/shippingService';
import { useToast } from '../../hooks/useToast';
import { formatOrderNumber, formatPrice } from '../../utils/format';
import { formatRequestNumber, RETURN_CLOSE_REASONS, RETURN_REASONS, RETURN_REJECT_REASONS, returnErrorMessage, UPI_PATTERN } from '../../utils/returns';
import { OrderDialog } from './OrderDialogs';

const messageOf = (err) => returnErrorMessage(err) ?? adminErrorMessage(err);
const titleOf = (request) => `${formatRequestNumber(request.request_number)} · ${formatOrderNumber(request.order_number)}`;

function useAction() {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const busy = useRef(false);
  async function run(fn) {
    if (busy.current) return false;
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(messageOf(err));
      return false;
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  return { working, error, setError, run };
}

function ErrorLine({ error }) {
  return error ? (
    <p className="notice" data-tone="error" role="alert">
      {error}
    </p>
  ) : null;
}

// Reasons as stacked buttons (as in the cancel pop-up).
function ReasonButtons({ reasons, value, onChange, label }) {
  return (
    <div className="ap-reasons" role="radiogroup" aria-label={label}>
      {reasons.map((reason) => (
        <button key={reason} type="button" role="radio" className="ap-reason" aria-checked={value === reason} onClick={() => onChange(reason)}>
          {reason}
        </button>
      ))}
    </div>
  );
}

function NoteForm({ request, onClose, onChanged }) {
  const [note, setNote] = useState(request.note ?? '');
  const { working, error, run } = useAction();
  const { show } = useToast();
  async function save(event) {
    event.preventDefault();
    if (await run(() => adminSetReturnNote(request.id, note))) {
      show({ message: note.trim() ? 'Note saved' : 'Note removed' });
      onChanged();
      onClose();
    }
  }
  return (
    <form className="stack-sm" onSubmit={save} noValidate>
      <label className="label" htmlFor="return-note">
        Note
      </label>
      <textarea id="return-note" className="textarea" rows={4} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      <ErrorLine error={error} />
      <div className="inline-actions ap-dialog-actions">
        <button type="submit" className="btn btn-dark btn-sm" aria-busy={working || undefined}>
          {working && <span className="spinner" aria-hidden="true" />}
          Save note
        </button>
      </div>
    </form>
  );
}

export function ReturnNoteDialog({ request, onClose, onChanged }) {
  return (
    <OrderDialog open={Boolean(request)} title={request ? `Notes · ${titleOf(request)}` : ''} onClose={onClose}>
      {request && <NoteForm key={request.id} request={request} onClose={onClose} onChanged={onChanged} />}
    </OrderDialog>
  );
}

function ApproveForm({ request, onClose, onChanged }) {
  const { working, error, run } = useAction();
  const { show } = useToast();
  async function approve() {
    let pickupError = null;
    const ok = await run(async () => {
      await adminDecideReturn(request.id, 'approved');
      pickupError = await tryReturnPickup(request.order_id);
    });
    if (!ok) return;
    if (pickupError) show({ message: `Approved, but the return pickup was not booked: ${pickupError} Retry it from Ongoing or Pickup Failed.`, tone: 'error' });
    else show({ message: request.kind === 'exchange' ? `${titleOf(request)} approved: pickup booked and replacement order placed` : `${titleOf(request)} approved: pickup booked` });
    onChanged();
    onClose();
  }
  return (
    <div className="stack-sm">
      <p>
        {request.kind === 'exchange'
          ? 'A return pickup is booked with the courier that delivered the order, and a free replacement order for the same books goes to Process orders.'
          : 'A return pickup is booked with the courier that delivered the order. The refund is sent once the books are picked up.'}
      </p>
      <ul className="admin-items">
        {request.items.map((i) => (
          <li key={i.sku}>
            <span>
              {i.title} × {i.quantity}
            </span>
            <span className="tnum">{formatPrice(Number(i.unit_price) * i.quantity)}</span>
          </li>
        ))}
      </ul>
      <ErrorLine error={error} />
      <div className="inline-actions ap-dialog-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
          Not Now
        </button>
        <button type="button" className="btn btn-dark btn-sm" aria-busy={working || undefined} onClick={approve}>
          {working && <span className="spinner" aria-hidden="true" />}
          Approve
        </button>
      </div>
    </div>
  );
}

export function ApproveDialog({ request, onClose, onChanged }) {
  return (
    <OrderDialog open={Boolean(request)} title={request ? `Approve ${request.kind} ${titleOf(request)}?` : ''} onClose={onClose}>
      {request && <ApproveForm key={request.id} request={request} onClose={onClose} onChanged={onChanged} />}
    </OrderDialog>
  );
}

// Reject (a new request) or Close (an approved one that will not go through): a reason
// from the list, and remarks for Other.
function ReasonForm({ request, reasons, submitLabel, action, done, onClose, onChanged }) {
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const { working, error, setError, run } = useAction();
  const { show } = useToast();
  async function submit(event) {
    event.preventDefault();
    if (!reason) return setError('Choose a reason.');
    if (reason === 'Other' && !remarks.trim()) return setError('Write what happened in the remarks.');
    if (await run(() => action(reason, remarks.trim()))) {
      show({ message: `${titleOf(request)} ${done}` });
      onChanged();
      onClose();
    }
  }
  return (
    <form className="stack-sm" onSubmit={submit} noValidate>
      <ReasonButtons
        reasons={reasons}
        value={reason}
        label="Reason"
        onChange={(value) => {
          setReason(value);
          setError(null);
        }}
      />
      {reason && (
        <div>
          <label className="label" htmlFor="return-remarks">
            Remarks
            {reason === 'Other' && <span className="ap-required" aria-hidden="true"> *</span>}
          </label>
          <input id="return-remarks" className="input" maxLength={100} placeholder="Add your remarks (max 100 characters)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
      )}
      <ErrorLine error={error} />
      <div className="inline-actions ap-dialog-actions">
        <button type="submit" className="btn btn-dark btn-sm" aria-disabled={!reason || undefined} aria-busy={working || undefined}>
          {working && <span className="spinner" aria-hidden="true" />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function RejectDialog({ request, onClose, onChanged }) {
  return (
    <OrderDialog open={Boolean(request)} title="Select reason for rejection" onClose={onClose}>
      {request && (
        <ReasonForm
          key={request.id}
          request={request}
          reasons={RETURN_REJECT_REASONS}
          submitLabel="Reject"
          done="rejected"
          action={(reason, remarks) => adminDecideReturn(request.id, 'rejected', reason, remarks)}
          onClose={onClose}
          onChanged={onChanged}
        />
      )}
    </OrderDialog>
  );
}

export function CloseRequestDialog({ request, onClose, onChanged }) {
  const livePickup = request?.pickupLive;
  return (
    <OrderDialog open={Boolean(request)} title={request ? `Close ${titleOf(request)}` : ''} onClose={onClose}>
      {request && (
        <div className="stack-sm">
          {livePickup && (
            <p className="notice" data-tone="warn">
              A return pickup is still booked for this order. Cancel it in the courier&apos;s panel if it should not happen.
            </p>
          )}
          <ReasonForm
            key={request.id}
            request={request}
            reasons={RETURN_CLOSE_REASONS}
            submitLabel="Close request"
            done="closed"
            action={(reason, remarks) => adminCloseReturnRequest(request.id, reason, remarks)}
            onClose={onClose}
            onChanged={onChanged}
          />
        </div>
      )}
    </OrderDialog>
  );
}

// Settlement: "Send Refund" (GoKwik) or "Paid Offline" (UPI or bank, with its reference).
function RefundForm({ request, mode, onClose, onChanged }) {
  const [amount, setAmount] = useState(String(Number(request.amount)));
  const [reference, setReference] = useState('');
  const { working, error, setError, run } = useAction();
  const { show } = useToast();
  async function submit(event) {
    event.preventDefault();
    const value = Number(amount);
    if (!(value > 0) || value > Number(request.amount)) return setError(`Enter an amount from ₹1 to ${formatPrice(request.amount)}.`);
    if (mode === 'offline' && !reference.trim()) return setError('Write the UTR or payment reference.');
    if (await run(() => adminSettleReturn(request.id, mode, value, mode === 'offline' ? reference.trim() : null))) {
      show({ message: mode === 'gokwik' ? `${formatPrice(value)} refund sent to GoKwik for ${titleOf(request)}` : `${titleOf(request)} marked paid offline` });
      onChanged();
      onClose();
    }
  }
  return (
    <form className="stack-sm" onSubmit={submit} noValidate>
      <p>
        {mode === 'gokwik'
          ? 'GoKwik refunds this amount to the way the customer paid. The request closes once GoKwik confirms the refund.'
          : 'Record money you sent to the customer yourself (UPI or bank transfer).'}
      </p>
      {mode === 'offline' && request.refund_upi && (
        <p>
          Customer&apos;s UPI ID: <strong className="tnum">{request.refund_upi}</strong>
        </p>
      )}
      <div>
        <label className="label" htmlFor="refund-amount">
          Refund amount (₹)
        </label>
        <input id="refund-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
      </div>
      {mode === 'offline' && (
        <div>
          <label className="label" htmlFor="refund-ref">
            UTR or payment reference
          </label>
          <input id="refund-ref" className="input" maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      )}
      <ErrorLine error={error} />
      <div className="inline-actions ap-dialog-actions">
        <button type="submit" className="btn btn-dark btn-sm" aria-busy={working || undefined}>
          {working && <span className="spinner" aria-hidden="true" />}
          {mode === 'gokwik' ? 'Send Refund' : 'Mark Paid Offline'}
        </button>
      </div>
    </form>
  );
}

// open: { request, mode: 'gokwik' | 'offline' } or null.
export function RefundDialog({ open, onClose, onChanged }) {
  return (
    <OrderDialog open={Boolean(open)} title={open ? `${open.mode === 'gokwik' ? 'Send refund' : 'Paid offline'} · ${titleOf(open.request)}` : ''} onClose={onClose}>
      {open && <RefundForm key={`${open.request.id}-${open.mode}`} request={open.request} mode={open.mode} onClose={onClose} onChanged={onChanged} />}
    </OrderDialog>
  );
}

// The customer's photos, from short-lived links.
export function ReturnPhotos({ paths }) {
  const [urls, setUrls] = useState(null);
  const key = paths.join('|');
  useEffect(() => {
    let active = true;
    adminReturnPhotoUrls(key ? key.split('|') : []).then(
      (found) => active && setUrls(found),
      () => active && setUrls({}),
    );
    return () => {
      active = false;
    };
  }, [key]);
  if (!paths.length) return <p className="page-meta">No photos.</p>;
  if (!urls) return <span className="spinner" aria-label="Loading photos" />;
  return (
    <div className="ap-return-photos">
      {paths.map((path, i) =>
        urls[path] ? (
          <a key={path} href={urls[path]} target="_blank" rel="noopener noreferrer" className="ap-return-photo">
            <img src={urls[path]} alt={`Customer photo ${i + 1}`} />
          </a>
        ) : (
          <span key={path} className="ap-return-photo ap-return-photo-missing">
            Not found
          </span>
        ),
      )}
    </div>
  );
}

export function PhotosDialog({ request, onClose }) {
  return (
    <OrderDialog open={Boolean(request)} title={request ? `Media by customer · ${titleOf(request)}` : ''} onClose={onClose}>
      {request && <ReturnPhotos paths={request.photos ?? []} />}
    </OrderDialog>
  );
}

// An admin records a request the customer made by phone (in the order's side panel).
export function AdminReturnForm({ order, onDone, onCancel }) {
  const [kind, setKind] = useState('return');
  const [picked, setPicked] = useState(() => (order.order_items.length === 1 ? { [order.order_items[0].sku]: order.order_items[0].quantity } : {}));
  const [reason, setReason] = useState('');
  const [remark, setRemark] = useState('');
  const [upi, setUpi] = useState('');
  const { working, error, setError, run } = useAction();
  const { show } = useToast();
  const items = Object.entries(picked).map(([sku, quantity]) => ({ sku, quantity }));

  async function submit(event) {
    event.preventDefault();
    if (!items.length) return setError('Choose the books coming back.');
    if (!reason) return setError('Choose a reason.');
    if (reason === 'Other' && !remark.trim()) return setError('Write what is wrong in the remark.');
    if (kind === 'return' && upi.trim() && !UPI_PATTERN.test(upi.trim())) return setError('That UPI ID does not look right.');
    if (await run(() => adminCreateReturnRequest({ orderId: order.id, kind, items, reason, remark: remark.trim(), refundUpi: kind === 'return' ? upi.trim() : '' }))) {
      show({ message: `${kind === 'exchange' ? 'Exchange' : 'Return'} request for ${formatOrderNumber(order.order_number)} added to New Request` });
      onDone();
    }
  }

  return (
    <form className="stack-sm" onSubmit={submit} noValidate>
      <div className="ap-segment" role="group" aria-label="Return or exchange">
        <button type="button" aria-pressed={kind === 'return'} onClick={() => setKind('return')}>
          Return
        </button>
        <button type="button" aria-pressed={kind === 'exchange'} onClick={() => setKind('exchange')}>
          Exchange
        </button>
      </div>
      <fieldset className="ap-fieldset">
        <legend className="label">Books coming back</legend>
        {order.order_items.map((item) => {
          const on = picked[item.sku] != null;
          return (
            <div key={item.sku} className="ap-return-pick">
              <label className="pick">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setPicked((current) => {
                      const next = { ...current };
                      if (on) delete next[item.sku];
                      else next[item.sku] = item.quantity;
                      return next;
                    })
                  }
                />
                <span>
                  {item.title} × {item.quantity}
                </span>
              </label>
              {on && item.quantity > 1 && (
                <select className="select select-sm" aria-label={`Copies of ${item.title}`} value={picked[item.sku]} onChange={(e) => setPicked((c) => ({ ...c, [item.sku]: Number(e.target.value) }))}>
                  {Array.from({ length: item.quantity }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </fieldset>
      <div>
        <label className="label" htmlFor="admin-return-reason">
          Reason
        </label>
        <select id="admin-return-reason" className="select select-sm" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Choose a reason</option>
          {RETURN_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="admin-return-remark">
          Customer remark
        </label>
        <input id="admin-return-remark" className="input input-sm" maxLength={300} value={remark} onChange={(e) => setRemark(e.target.value)} />
      </div>
      {kind === 'return' && order.payment_method === 'cod' && (
        <div>
          <label className="label" htmlFor="admin-return-upi">
            Customer&apos;s UPI ID for the refund
          </label>
          <input id="admin-return-upi" className="input input-sm" autoComplete="off" value={upi} onChange={(e) => setUpi(e.target.value)} />
        </div>
      )}
      <ErrorLine error={error} />
      <div className="inline-actions">
        <button type="submit" className="btn btn-dark btn-sm" aria-busy={working || undefined}>
          {working && <span className="spinner" aria-hidden="true" />}
          Add request
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

