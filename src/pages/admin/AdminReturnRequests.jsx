import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, ArrowUp, CaretDown, Info, MagnifyingGlass, NotePencil, X } from '@phosphor-icons/react';
import { ADMIN_PAGE_SIZE, adminListReturnRequests, adminReturnOverview, RETURN_TABS } from '../../services/adminService';
import { ADMIN_SHIPMENT_LABELS, CARRIER_NAMES, carrierOf, trackingUrl, tryReturnPickup } from '../../services/shippingService';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../hooks/useToast';
import { formatCount, formatOrderNumber, formatPrice, ORDER_STATUS_LABELS, plural } from '../../utils/format';
import { downloadCsv } from '../../utils/csv';
import { formatRequestNumber, RETURN_KINDS, RETURN_REASONS, RETURN_WINDOW_DAYS } from '../../utils/returns';
import { LoadError, StateBlock } from '../../components/store/States';
import { LinesSkeleton } from '../../components/store/Skeletons';
import PageHead from '../../components/admin/PageHead';
import DateRange from '../../components/admin/DateRange';
import HoverHint from '../../components/admin/HoverHint';
import {
  ApproveDialog,
  CloseRequestDialog,
  PhotosDialog,
  RefundDialog,
  RejectDialog,
  ReturnNoteDialog,
  ReturnPhotos,
} from '../../components/admin/ReturnDialogs';

const POLICY = `Return or Exchange within ${RETURN_WINDOW_DAYS} days`;
const TIPS = {
  new: 'Return and exchange requests raised by customers appear here. Please accept or reject them as early as possible.',
  ongoing: 'Approved return and exchange requests appear here until the books are picked up. They are not yet ready for settlement.',
  pickup_failed: `Requests whose return pickup did not happen. Retry the pickup or close the request. After 7 days they move to Closed Requests.`,
  settlement_pending: 'Returns picked up from the customer, waiting for their refund. Please settle them as early as possible.',
  closed: 'Closed requests appear here. No further action is needed on them.',
};
const FILTER_KEYS = ['q', 'by', 'from', 'to', 'afrom', 'ato', 'reason', 'type', 'source', 'action', 'settle'];
const SOURCES = { website: 'Website', admin: 'Admin panel' };
const ACTIONS = [
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['withdrawn', 'Withdrawn by customer'],
];
const SETTLE_STATES = [
  ['not_started', 'Not started'],
  ['in_progress', 'In progress'],
  ['failed', 'Failed'],
];

const dateTime = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const stamp = (value) => {
  if (!value) return null;
  const [date, time] = dateTime.format(new Date(value)).split(', ');
  return (
    <>
      <span className="ap-strong tnum">{time}</span>
      <span className="ap-cell-meta tnum">{date}</span>
    </>
  );
};
const list = (value) => (value ? value.split('|').filter(Boolean) : []);

// The request's return pickup: the newest reverse parcel of its order.
function pickupOf(request, orders) {
  const parcels = (orders[request.order_id]?.shipments ?? []).filter((s) => s.kind === 'reverse');
  parcels.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return parcels.find((s) => s.status !== 'cancelled') ?? parcels[0] ?? null;
}
const forwardOf = (order) => (order?.shipments ?? []).find((s) => s.kind === 'forward' && s.status !== 'cancelled') ?? null;

// Where the refund or the replacement is: [label, tone, value for the filter].
function settlementOf(request, orders, payments) {
  if (request.kind === 'exchange') {
    const replacement = orders[request.replacement_order_id];
    if (!replacement) return ['Not started', null, 'not_started'];
    if (replacement.status === 'delivered') return ['Success', 'ok', 'success'];
    if (replacement.status === 'cancelled') return ['Failed', 'danger', 'failed'];
    return ['In progress', 'warn', 'in_progress'];
  }
  if (request.refund_mode === 'offline') return ['Success', 'ok', 'success'];
  if (request.refund_mode === 'gokwik') {
    const state = payments[request.order_id]?.refund_status;
    if (state === 'successful') return ['Success', 'ok', 'success'];
    if (state === 'failed') return ['Failed', 'danger', 'failed'];
    return ['In progress', 'warn', 'in_progress'];
  }
  if (request.stage === 'closed') return ['Not applicable', null, 'na'];
  return ['Not started', null, 'not_started'];
}

const canSendRefund = (request, orders, payments) => {
  const order = orders[request.order_id];
  const pay = payments[request.order_id];
  return Boolean(pay) && Number(order?.amount_paid ?? 0) > 0 && !['requested', 'initiated', 'pending', 'auto_refund'].includes(pay.refund_status);
};

// A drop-down of check boxes (ShopDeck's Return/Exchange Reason and Request Type).
function CheckMenu({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!box.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const chosen = new Set(value);
  return (
    <div className="ap-menu ap-check-menu" ref={box}>
      <button type="button" className="ap-range-button" data-empty={chosen.size === 0 || undefined} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{chosen.size ? `${label} (${chosen.size})` : label}</span>
        <CaretDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="ap-menu-list ap-check-list" role="group" aria-label={label}>
          {options.map(([v, text]) => (
            <label key={v} className="pick">
              <input
                type="checkbox"
                checked={chosen.has(v)}
                onChange={() => {
                  const next = new Set(chosen);
                  if (next.has(v)) next.delete(v);
                  else next.add(v);
                  onChange([...next]);
                }}
              />
              <span>{text}</span>
            </label>
          ))}
          {chosen.size > 0 && (
            <button type="button" className="btn-link" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Summary({ data }) {
  const card = (value, label, about, warn) => (
    <div className="ap-stat ap-stat-flip" tabIndex={0} data-tone={warn ? 'danger' : undefined}>
      <span className="ap-stat-face">
        <span className="ap-stat-value">
          {value}
          {warn && <span className="ap-pill">{warn}</span>}
        </span>
        <span className="ap-stat-label">{label}</span>
      </span>
      <span className="ap-stat-about">
        <strong>{label}</strong>
        {about}
      </span>
    </div>
  );
  return (
    <section aria-labelledby="returns-summary">
      <h2 id="returns-summary" className="ap-section-title">
        Summary <span className="page-meta">(Last 30 days)</span>
      </h2>
      <div className="ap-summary ap-summary-returns">
        {card(`${data.return_rate}%`, 'Customer Return Request %', 'Requests raised for every 100 orders delivered in the last 30 days.')}
        {card(`${data.unprocessed_rate}%`, 'Unprocessed Request %', 'Requests of the last 30 days still waiting to be accepted or rejected.', data.unprocessed_rate > 20 ? 'Please process return requests' : null)}
        {card(formatCount(data.tabs?.settlement_pending ?? 0), 'Settlement Pending', 'Returns picked up whose refund has not been sent yet.')}
        {card(`${data.approval_rate}%`, 'Request Approval %', 'Of the requests decided in the last 30 days, how many were approved.', data.approval_rate > 90 ? 'Do not accept every request to reduce losses' : null)}
        {card(`${data.impact_rate}% of Sales`, 'Impact of Return on P&L', 'Money refunded for returns in the last 30 days, as a share of the sales delivered in that time.')}
      </div>
    </section>
  );
}

function OrderCell({ request, onDetails }) {
  const first = request.items[0];
  const more = request.items.length - 1;
  return (
    <td className="ap-col-book" data-label="Order details">
      <div className="ap-book-cell">
        {first?.image_url ? <img className="ap-thumb" src={first.image_url} alt="" width="44" height="60" loading="lazy" /> : <span className="ap-thumb ap-thumb-empty" aria-hidden="true" />}
        <span>
          <span className="ap-book-name ap-clamp">{first?.title}</span>
          <span className="ap-book-sku">
            Quantity: <span className="ap-qty">{String(first?.quantity ?? 0).padStart(2, '0')}</span>
          </span>
          {more > 0 && <span className="ap-book-sku">+ {plural(more, 'more book')}</span>}
          <span className="ap-book-sku tnum">{formatRequestNumber(request.request_number)}</span>
          <Link className="ap-text-link" to={`/admin/orders/track?q=${request.order_number}`}>
            {formatOrderNumber(request.order_number)}
          </Link>
          <button type="button" className="ap-text-link" onClick={() => onDetails(request)}>
            More Details
          </button>
        </span>
      </div>
    </td>
  );
}

function CustomerCell({ request, order }) {
  return (
    <td className="ap-col-customer" data-label="Customer info">
      <span className="tnum">{request.phone}</span>
      {order && (
        <>
          <span className="ap-strong">{order.shipping_name}</span>
          <HoverHint className="ap-cell-meta ap-clamp ap-clamp-1 ap-hint-plain" tip={`${order.shipping_address}, ${order.shipping_city}, ${order.shipping_state} - ${order.shipping_pincode}`}>
            {order.shipping_address}, {order.shipping_city}
          </HoverHint>
        </>
      )}
    </td>
  );
}

function ParcelCell({ parcel, label, empty = 'Not booked' }) {
  return (
    <td data-label={label}>
      {parcel ? (
        <>
          <span className="ap-badge ap-badge-caps" data-tone={parcel.status === 'delivered' ? 'ok' : ['cancelled', 'failed', 'exception', 'rto'].includes(parcel.status) ? 'danger' : 'warn'}>
            {ADMIN_SHIPMENT_LABELS[parcel.status] ?? parcel.status}
          </span>
          {parcel.awb_number ? (
            <>
              <span className="ap-cell-meta">
                AWB:{' '}
                <a className="ap-text-link tnum" href={trackingUrl(parcel)} target="_blank" rel="noopener noreferrer">
                  {parcel.awb_number}
                </a>
              </span>
              <span className="ap-cell-meta">
                Track:{' '}
                <a className="ap-text-link" href={trackingUrl(parcel)} target="_blank" rel="noopener noreferrer">
                  Link
                </a>
              </span>
            </>
          ) : (
            <span className="ap-cell-meta">AWB: Not generated</span>
          )}
          <span className="ap-cell-meta">{parcel.courier_name ?? CARRIER_NAMES[carrierOf(parcel)]}</span>
          {parcel.last_error && ['cancelled', 'failed'].includes(parcel.status) && <span className="ap-cell-meta ap-clamp">{parcel.last_error}</span>}
        </>
      ) : (
        <span className="ap-cell-meta">{empty}</span>
      )}
    </td>
  );
}

function NoteLine({ note }) {
  return note ? (
    <span className="ap-note" title={note}>
      <NotePencil size={14} aria-label="Note" />
      <span className="ap-clamp">{note}</span>
    </span>
  ) : null;
}

function RequestRow({ request, tab, data, busy, onDetails, onNotes, onPhotos, onApprove, onReject, onPickup, onClose, onRefund }) {
  const order = data.orders[request.order_id];
  const pickup = pickupOf(request, data.orders);
  const replacement = data.orders[request.replacement_order_id];
  const [settleLabel, settleTone] = settlementOf(request, data.orders, data.payments);
  const exchange = request.kind === 'exchange';
  const mode = order?.payment_method === 'cod' ? 'COD' : 'Prepaid';
  const notesButton = (
    <button type="button" className="btn btn-outline btn-sm" onClick={() => onNotes(request)}>
      <NotePencil size={16} aria-hidden="true" />
      Notes
    </button>
  );
  const detailsButton = (
    <button type="button" className="btn btn-outline btn-sm" onClick={() => onDetails(request)}>
      Details
    </button>
  );
  const type = (
    <td data-label="Request type">
      <span className="ap-badge ap-badge-caps" data-tone="ok">
        {RETURN_KINDS[request.kind]}
      </span>
    </td>
  );
  const requested = (
    <td className="ap-col-order" data-label="Requested on">
      {stamp(request.created_at)}
      {tab !== 'new' && <span className="ap-cell-meta">{SOURCES[request.source]}</span>}
    </td>
  );
  const settlement = (
    <td data-label="Settlement">
      <span className="ap-strong">{exchange ? 'EXCHANGE' : 'REFUND'}</span>
      <span className="ap-badge ap-badge-caps" data-tone={settleTone ?? undefined}>
        {settleLabel}
      </span>
      {request.refund_amount != null && <span className="ap-cell-meta">{formatPrice(request.refund_amount)}</span>}
      {request.refund_mode === 'offline' && request.refund_ref && <span className="ap-cell-meta tnum">UTR: {request.refund_ref}</span>}
      {request.refund_mode === 'gokwik' && <span className="ap-cell-meta">Through GoKwik</span>}
    </td>
  );
  const forward = exchange ? (
    <td data-label="Forward order shipping">
      {replacement ? (
        <>
          <Link className="ap-text-link" to={`/admin/orders/track?q=${replacement.order_number}`}>
            {formatOrderNumber(replacement.order_number)}
          </Link>
          <span className="ap-cell-meta">{ORDER_STATUS_LABELS[replacement.status]}</span>
          {forwardOf(replacement)?.awb_number && (
            <span className="ap-cell-meta">
              AWB:{' '}
              <a className="ap-text-link tnum" href={trackingUrl(forwardOf(replacement))} target="_blank" rel="noopener noreferrer">
                {forwardOf(replacement).awb_number}
              </a>
            </span>
          )}
        </>
      ) : (
        <span className="ap-cell-meta">Not placed</span>
      )}
    </td>
  ) : (
    <td data-label="Forward order shipping">
      <span className="ap-cell-meta">NA</span>
    </td>
  );

  if (tab === 'new') {
    return (
      <tr>
        {requested}
        <OrderCell request={request} onDetails={onDetails} />
        {type}
        <CustomerCell request={request} order={order} />
        <td data-label="Policy">
          <span className="ap-cell-meta">{POLICY}</span>
        </td>
        <td data-label="Reason">
          <span className="ap-strong">{request.reason}</span>
        </td>
        <td data-label="Customer remark">
          <span className="ap-clamp">{request.remark ?? '—'}</span>
        </td>
        <td data-label="Media by customer">
          {request.photos?.length ? (
            <button type="button" className="ap-text-link" onClick={() => onPhotos(request)}>
              View All {plural(request.photos.length, 'File')}
            </button>
          ) : (
            <span className="ap-cell-meta">No files</span>
          )}
        </td>
        <td data-label="Invoice value">
          <span className="ap-cell-meta">Returned Order: {formatPrice(request.amount)}</span>
          <span className="ap-cell-meta">Mode: {mode}</span>
          {exchange && <span className="ap-cell-meta">New Order: {formatPrice(0)} (free replacement)</span>}
        </td>
        <td data-label="Delta amount">
          <span className="ap-strong">{formatPrice(exchange ? 0 : request.amount)}</span>
          <span className="ap-badge ap-badge-caps ap-badge-dark">{exchange ? 'No difference' : 'To be refunded'}</span>
        </td>
        <td className="ap-col-actions">
          <NoteLine note={request.note} />
          <div className="ap-row-actions ap-row-actions-stack">
            {notesButton}
            <button type="button" className="btn btn-dark btn-sm" onClick={() => onApprove(request)}>
              Approve
            </button>
            <button type="button" className="btn-link ap-danger-link" onClick={() => onReject(request)}>
              Reject
            </button>
          </div>
        </td>
      </tr>
    );
  }

  if (tab === 'closed') {
    const decision = request.decision ?? 'approved';
    return (
      <tr>
        {requested}
        <td data-label="Requested action">
          <span className="ap-badge ap-badge-caps" data-tone={decision === 'approved' ? 'ok' : decision === 'rejected' ? 'danger' : undefined}>
            {decision === 'withdrawn' ? 'Withdrawn' : decision}
          </span>
          {stamp(request.decided_at)}
        </td>
        <td data-label="Approved request status">
          {decision === 'approved' ? (
            <>
              <span className="ap-badge ap-badge-caps" data-tone={request.outcome === 'passed' ? 'ok' : 'danger'}>
                {request.outcome === 'passed' ? 'Passed' : 'Failed'}
              </span>
              {request.fail_reason && <span className="ap-cell-meta">{request.fail_reason}</span>}
              {request.fail_remarks && <span className="ap-cell-meta ap-clamp">“{request.fail_remarks}”</span>}
            </>
          ) : (
            <span className="ap-cell-meta">NA</span>
          )}
        </td>
        <OrderCell request={request} onDetails={onDetails} />
        {type}
        <CustomerCell request={request} order={order} />
        <ParcelCell parcel={pickup} label="Return order shipping" empty="NA" />
        {forward}
        {settlement}
        <td data-label="Rejection reason">
          <span className="ap-cell-meta">{request.reject_reason ?? 'NA'}</span>
          {request.reject_remarks && <span className="ap-cell-meta ap-clamp">“{request.reject_remarks}”</span>}
        </td>
        <td className="ap-col-actions">
          <NoteLine note={request.note} />
          <div className="ap-row-actions ap-row-actions-stack">
            {notesButton}
            {detailsButton}
          </div>
        </td>
      </tr>
    );
  }

  const pickupLive = pickup && pickup.status !== 'cancelled';
  return (
    <tr>
      {requested}
      <td data-label="Accepted on">{stamp(request.decided_at)}</td>
      <OrderCell request={request} onDetails={onDetails} />
      {type}
      <CustomerCell request={request} order={order} />
      <ParcelCell parcel={pickup} label="Return order shipping" />
      {forward}
      {settlement}
      <td className="ap-col-actions">
        <NoteLine note={request.note} />
        <div className="ap-row-actions ap-row-actions-stack">
          {notesButton}
          {tab === 'settlement_pending' && canSendRefund(request, data.orders, data.payments) && (
            <button type="button" className="btn btn-dark btn-sm" onClick={() => onRefund({ request, mode: 'gokwik' })}>
              Send Refund
            </button>
          )}
          {tab === 'settlement_pending' && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onRefund({ request, mode: 'offline' })}>
              Paid Offline
            </button>
          )}
          {(tab === 'pickup_failed' || (tab === 'ongoing' && !pickupLive)) && (
            <button type="button" className="btn btn-dark btn-sm" aria-busy={busy === request.id || undefined} onClick={() => onPickup(request)}>
              {busy === request.id && <span className="spinner" aria-hidden="true" />}
              {tab === 'pickup_failed' ? 'Retry Pickup' : 'Book Pickup'}
            </button>
          )}
          {tab === 'pickup_failed' && (
            <button type="button" className="btn-link ap-danger-link" onClick={() => onClose({ ...request, pickupLive: false })}>
              Close Request
            </button>
          )}
          {tab !== 'pickup_failed' && detailsButton}
        </div>
      </td>
    </tr>
  );
}

const COLUMNS = {
  new: ['Request Date', 'Order Details', 'Request Type', 'Customer Info', 'Policy', 'Reason', 'Customer Remark', 'Media by customer', 'Invoice Value', 'Delta Amount', 'Action'],
  ongoing: ['Requested On', 'Accepted On', 'Order Details', 'Request Type', 'Customer Info', 'Return Order Shipping', 'Forward Order Shipping', 'Settlement Method', 'Action'],
  pickup_failed: ['Requested On', 'Accepted On', 'Order Details', 'Request Type', 'Customer Info', 'Return Order Shipping', 'Forward Order Shipping', 'Settlement Method', 'Action'],
  settlement_pending: ['Requested On', 'Accepted On', 'Order Details', 'Request Type', 'Customer Info', 'Return Order Shipping', 'Forward Order Shipping', 'Settlement Method & Status', 'Action'],
  closed: ['Requested On', 'Requested Action', 'Approved Request Status', 'Order Details', 'Request Type', 'Customer Info', 'Return Order Shipping', 'Forward Order Shipping', 'Settlement Method & Status', 'Rejection Reason', 'Action'],
};

// Everything about one request, in the side panel (ShopDeck's More Details / Details).
function RequestSheet({ request, data, onClose, onCloseRequest }) {
  const open = Boolean(request);
  const order = request ? data?.orders[request.order_id] : null;
  const pickup = request && data ? pickupOf(request, data.orders) : null;
  const replacement = request ? data?.orders[request.replacement_order_id] : null;
  const settle = request && data ? settlementOf(request, data.orders, data.payments) : null;
  const closable = request && request.decision === 'approved' && request.stage !== 'closed';
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ap-drawer-overlay" />
        {request && (
          <Dialog.Content className="ap-sheet ap" aria-describedby={undefined}>
            <div className="ap-sheet-head">
              <div>
                <Dialog.Title className="ap-sheet-title">
                  {RETURN_KINDS[request.kind]} {formatRequestNumber(request.request_number)}
                </Dialog.Title>
                <p className="page-meta">
                  {formatOrderNumber(request.order_number)} · {SOURCES[request.source]} · {dateTime.format(new Date(request.created_at))}
                </p>
              </div>
              <Dialog.Close asChild>
                <button type="button" className="ap-icon-button" aria-label="Close details">
                  <X size={22} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <div className="ap-sheet-body">
              <section className="ap-sheet-section" aria-labelledby="rq-books">
                <h3 id="rq-books">Books coming back</h3>
                <ul className="admin-items">
                  {request.items.map((i) => (
                    <li key={i.sku}>
                      <span>
                        {i.title} × {i.quantity}
                        <span className="ap-book-sku">SKU {i.sku}</span>
                      </span>
                      <span className="tnum">{formatPrice(Number(i.unit_price) * i.quantity)}</span>
                    </li>
                  ))}
                </ul>
                <dl className="ap-sums">
                  <div>
                    <dt>Value of the books</dt>
                    <dd>{formatPrice(request.amount)}</dd>
                  </div>
                  {order && (
                    <div>
                      <dt>Order paid by</dt>
                      <dd>{order.payment_method === 'cod' ? 'COD' : 'Prepaid'}</dd>
                    </div>
                  )}
                </dl>
              </section>
              <section className="ap-sheet-section" aria-labelledby="rq-reason">
                <h3 id="rq-reason">Customer&apos;s reason</h3>
                <p className="ap-strong">{request.reason}</p>
                {request.remark && <p>“{request.remark}”</p>}
                {request.refund_upi && (
                  <p>
                    UPI ID for the refund: <strong className="tnum">{request.refund_upi}</strong>
                  </p>
                )}
                <ReturnPhotos paths={request.photos ?? []} />
              </section>
              <section className="ap-sheet-section" aria-labelledby="rq-status">
                <h3 id="rq-status">Status</h3>
                <dl className="ap-sums">
                  <div>
                    <dt>Decision</dt>
                    <dd>{request.decision ? `${request.decision[0].toUpperCase()}${request.decision.slice(1)}${request.decided_at ? ` on ${dateTime.format(new Date(request.decided_at))}` : ''}` : 'Waiting'}</dd>
                  </div>
                  {request.reject_reason && (
                    <div>
                      <dt>Rejection reason</dt>
                      <dd>{request.reject_reason}</dd>
                    </div>
                  )}
                  {pickup && (
                    <div>
                      <dt>Return pickup</dt>
                      <dd>
                        {ADMIN_SHIPMENT_LABELS[pickup.status] ?? pickup.status}
                        {pickup.awb_number && ` · AWB ${pickup.awb_number}`}
                      </dd>
                    </div>
                  )}
                  {replacement && (
                    <div>
                      <dt>Replacement</dt>
                      <dd>
                        <Link className="ap-text-link" to={`/admin/orders/track?q=${replacement.order_number}`}>
                          {formatOrderNumber(replacement.order_number)}
                        </Link>{' '}
                        · {ORDER_STATUS_LABELS[replacement.status]}
                      </dd>
                    </div>
                  )}
                  {settle && request.decision === 'approved' && (
                    <div>
                      <dt>Settlement</dt>
                      <dd>{settle[0]}</dd>
                    </div>
                  )}
                  {request.fail_reason && (
                    <div>
                      <dt>Closed because</dt>
                      <dd>
                        {request.fail_reason}
                        {request.fail_remarks && ` (${request.fail_remarks})`}
                      </dd>
                    </div>
                  )}
                </dl>
                {closable && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => onCloseRequest({ ...request, pickupLive: Boolean(pickup && pickup.status !== 'cancelled' && !['in_transit', 'out_for_delivery', 'delivered'].includes(pickup.status)) })}>
                    Close request
                  </button>
                )}
              </section>
              {request.note && (
                <section className="ap-sheet-section" aria-labelledby="rq-note">
                  <h3 id="rq-note">Note</h3>
                  <p>{request.note}</p>
                </section>
              )}
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function downloadRequests(tab, requests, data) {
  const head = ['Request', 'Requested on', 'Source', 'Type', 'Order', 'Mobile', 'Customer', 'Books', 'Value', 'Reason', 'Customer remark', 'Decision', 'Decided on', 'Return AWB', 'Return pickup', 'Replacement order', 'Settlement', 'Refund amount', 'Refund reference', 'Rejection reason', 'Closed because', 'Note'];
  const rows = requests.map((r) => {
    const order = data.orders[r.order_id];
    const pickup = pickupOf(r, data.orders);
    const replacement = data.orders[r.replacement_order_id];
    return [
      formatRequestNumber(r.request_number),
      dateTime.format(new Date(r.created_at)).replace(',', ''),
      SOURCES[r.source],
      RETURN_KINDS[r.kind],
      formatOrderNumber(r.order_number),
      r.phone,
      order?.shipping_name ?? '',
      r.items.map((i) => `${i.title} x ${i.quantity}`).join('; '),
      Number(r.amount).toFixed(2),
      r.reason,
      r.remark ?? '',
      r.decision ?? 'Waiting',
      r.decided_at ? dateTime.format(new Date(r.decided_at)).replace(',', '') : '',
      pickup?.awb_number ?? '',
      pickup ? (ADMIN_SHIPMENT_LABELS[pickup.status] ?? pickup.status) : '',
      replacement ? formatOrderNumber(replacement.order_number) : '',
      settlementOf(r, data.orders, data.payments)[0],
      r.refund_amount != null ? Number(r.refund_amount).toFixed(2) : '',
      r.refund_ref ?? '',
      r.reject_reason ?? '',
      r.fail_reason ?? '',
      r.note ?? '',
    ];
  });
  downloadCsv(`return-requests-${tab}-${new Date().toISOString().slice(0, 10)}.csv`, [head, ...rows]);
}

// ShopDeck's Orders > Return/Exchange Requests: customers' return and exchange requests,
// from New Request to Closed.
function AdminReturnRequests() {
  useDocumentTitle('Return/Exchange requests');
  const [params, setParams] = useSearchParams();
  const tab = RETURN_TABS.some(([v]) => v === params.get('tab')) ? params.get('tab') : 'new';
  const get = (key) => params.get(key) ?? '';
  const searchBy = get('by') === 'phone' ? 'phone' : 'order';
  const [term, setTerm] = useState(get('q'));
  const [page, setPage] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [noteFor, setNoteFor] = useState(null);
  const [photosFor, setPhotosFor] = useState(null);
  const [approveFor, setApproveFor] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
  const [closeFor, setCloseFor] = useState(null);
  const [refundFor, setRefundFor] = useState(null);
  const [busy, setBusy] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const { show } = useToast();

  function update(changes) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
    setPage(0);
  }

  // The search box waits for a pause in typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (term.trim() !== get('q')) update({ q: term.trim() });
    }, 350);
    return () => clearTimeout(timer);
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = {
    tab,
    page,
    sort: get('sort'),
    searchBy,
    search: get('q'),
    from: get('from'),
    to: get('to'),
    afrom: get('afrom'),
    ato: get('ato'),
    reasons: list(get('reason')),
    kinds: list(get('type')),
    source: get('source'),
    action: tab === 'closed' ? get('action') : '',
  };
  const key = JSON.stringify(filters);
  const overview = useAsync(() => adminReturnOverview(), []);
  const result = useAsync(() => adminListReturnRequests(filters), [key]);
  const data = result.data;
  const settle = tab === 'settlement_pending' ? get('settle') : '';
  const requests = (data?.requests ?? []).filter((r) => !settle || settlementOf(r, data.orders, data.payments)[2] === settle);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const anyFilter = FILTER_KEYS.some((k) => get(k));
  const counts = overview.data?.tabs ?? {};

  function changed() {
    result.retry();
    overview.retry();
  }

  async function bookPickup(request) {
    if (busy) return;
    setBusy(request.id);
    const error = await tryReturnPickup(request.order_id);
    setBusy(null);
    if (error) show({ message: `${formatRequestNumber(request.request_number)}: ${error}`, tone: 'error' });
    else show({ message: `Return pickup booked for ${formatOrderNumber(request.order_number)}` });
    changed();
  }

  async function downloadAll() {
    if (downloading) return;
    setDownloading(true);
    try {
      const all = [];
      let found = null;
      for (let p = 0; p < 12; p += 1) {
        const chunk = await adminListReturnRequests({ ...filters, page: p });
        found = found ? { ...chunk, requests: [...found.requests, ...chunk.requests], orders: { ...found.orders, ...chunk.orders }, payments: { ...found.payments, ...chunk.payments } } : chunk;
        all.push(...chunk.requests);
        if (chunk.requests.length < ADMIN_PAGE_SIZE) break;
      }
      const rows = all.filter((r) => !settle || settlementOf(r, found.orders, found.payments)[2] === settle);
      downloadRequests(tab, rows, found);
      show({ message: `${plural(rows.length, 'request')} downloaded` });
    } catch {
      show({ message: 'The requests could not be downloaded. Try again.', tone: 'error' });
    } finally {
      setDownloading(false);
    }
  }

  const reasonMenu = <CheckMenu label="Return/Exchange Reason" options={RETURN_REASONS.map((r) => [r, r])} value={filters.reasons} onChange={(v) => update({ reason: v.join('|') })} />;
  const typeMenu = <CheckMenu label="Request Type" options={Object.entries(RETURN_KINDS)} value={filters.kinds} onChange={(v) => update({ type: v.join('|') })} />;
  const sourceSelect = (
    <>
      <label className="visually-hidden" htmlFor="returns-source">
        Request source
      </label>
      <select id="returns-source" className="select select-sm" value={filters.source} onChange={(e) => update({ source: e.target.value })}>
        <option value="">Request Source</option>
        {Object.entries(SOURCES).map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </>
  );

  return (
    <div className="stack-sm ap-orders-page ap-returns-page">
      <PageHead title="Return/Exchange Requests" />

      {overview.data && <Summary data={overview.data} />}

      <div className="ap-underline-tabs" role="tablist" aria-label="Show requests">
        {RETURN_TABS.map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => update({ tab: value === 'new' ? '' : value, action: '', settle: '', afrom: '', ato: '' })}>
            {label}
            {counts[value] != null && ` (${formatCount(counts[value])})`}
          </button>
        ))}
      </div>

      <section className="ap-card" aria-label="Requests">
        <div className="ap-tip">
          <Info size={18} aria-hidden="true" />
          <p>{TIPS[tab]}</p>
          <button type="button" className="btn btn-dark btn-sm" aria-busy={downloading || undefined} onClick={downloadAll}>
            {downloading && <span className="spinner" aria-hidden="true" />}
            Download
          </button>
        </div>

        <div className="ap-filters">
          <div className="ap-search-by">
            <label className="visually-hidden" htmlFor="returns-by">
              Search by
            </label>
            <select id="returns-by" className="select select-sm" value={searchBy} onChange={(e) => update({ by: e.target.value === 'order' ? '' : e.target.value })}>
              <option value="order">Order ID</option>
              <option value="phone">Customer Number</option>
            </select>
            <div className="ap-search">
              <label className="visually-hidden" htmlFor="returns-q">
                Search requests
              </label>
              <input id="returns-q" className="input input-sm" type="search" inputMode="numeric" placeholder="Search" value={term} onChange={(e) => setTerm(e.target.value)} />
              <MagnifyingGlass size={18} aria-hidden="true" />
            </div>
          </div>
          <DateRange id="returns-requested" label="Request Date Range" from={filters.from} to={filters.to} onChange={(c) => update(c)} />
          {tab === 'new' && (
            <>
              {reasonMenu}
              {typeMenu}
            </>
          )}
          {['ongoing', 'pickup_failed', 'settlement_pending'].includes(tab) && (
            <>
              <DateRange id="returns-accepted" label="Accepted Date Range" from={filters.afrom} to={filters.ato} onChange={(c) => update({ afrom: c.from ?? filters.afrom, ato: c.to ?? filters.ato })} />
              {sourceSelect}
            </>
          )}
          {tab === 'settlement_pending' && (
            <>
              <label className="visually-hidden" htmlFor="returns-settle">
                Settlement status
              </label>
              <select id="returns-settle" className="select select-sm" value={settle} onChange={(e) => update({ settle: e.target.value })}>
                <option value="">Settlement Status</option>
                {SETTLE_STATES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          )}
          {tab === 'closed' && (
            <>
              <label className="visually-hidden" htmlFor="returns-action">
                Request action
              </label>
              <select id="returns-action" className="select select-sm" value={filters.action} onChange={(e) => update({ action: e.target.value })}>
                <option value="">Request Action</option>
                {ACTIONS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
              <DateRange id="returns-acted" label="Request Action Date" from={filters.afrom} to={filters.ato} onChange={(c) => update({ afrom: c.from ?? filters.afrom, ato: c.to ?? filters.ato })} />
            </>
          )}
          {moreOpen && (
            <>
              {tab === 'new' ? sourceSelect : (
                <>
                  {reasonMenu}
                  {typeMenu}
                  {tab === 'closed' && sourceSelect}
                </>
              )}
            </>
          )}
          <button type="button" className="btn-link" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
            {moreOpen ? 'Less Filters' : 'More Filters'}
          </button>
          {anyFilter && (
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setTerm('');
                update(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])));
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {result.loading && !data && (
          <div className="ap-card-body">
            <LinesSkeleton count={3} label="Loading requests…" />
          </div>
        )}
        {result.error && (
          <div className="ap-card-body">
            <LoadError onRetry={result.retry} what="requests" />
          </div>
        )}
        {data && requests.length === 0 && (
          <div className="ap-card-body">
            <StateBlock title={anyFilter ? 'No requests match these filters.' : 'No requests here.'} />
          </div>
        )}

        {data && requests.length > 0 && (
          <div className="ap-table-wrap">
            <table className="ap-table ap-orders-table ap-returns-table">
              <thead>
                <tr>
                  {COLUMNS[tab].map((name, i) =>
                    i === 0 ? (
                      <th key={name}>
                        <button type="button" className="ap-sort" onClick={() => update({ sort: get('sort') === 'oldest' ? '' : 'oldest' })}>
                          {name}
                          {get('sort') === 'oldest' ? <ArrowUp size={14} aria-label="oldest first" /> : <ArrowDown size={14} aria-label="newest first" />}
                        </button>
                      </th>
                    ) : (
                      <th key={name}>{name}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <RequestRow
                    key={request.id}
                    request={request}
                    tab={tab}
                    data={data}
                    busy={busy}
                    onDetails={setSheet}
                    onNotes={setNoteFor}
                    onPhotos={setPhotosFor}
                    onApprove={setApproveFor}
                    onReject={setRejectFor}
                    onPickup={bookPickup}
                    onClose={setCloseFor}
                    onRefund={setRefundFor}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && total > 0 && (
          <div className="ap-pager">
            <span className="page-meta" aria-live="polite">
              {plural(total, 'request')}
              {pages > 1 && ` · page ${page + 1} of ${pages}`}
            </span>
            {pages > 1 && (
              <div className="ap-pager-buttons">
                <button type="button" className="btn btn-outline btn-sm" aria-disabled={page === 0 || undefined} onClick={() => page > 0 && setPage(page - 1)}>
                  Previous
                </button>
                <button type="button" className="btn btn-outline btn-sm" aria-disabled={page >= pages - 1 || undefined} onClick={() => page < pages - 1 && setPage(page + 1)}>
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <RequestSheet
        request={sheet}
        data={data}
        onClose={() => setSheet(null)}
        onCloseRequest={(r) => {
          setSheet(null);
          setCloseFor(r);
        }}
      />
      <ReturnNoteDialog request={noteFor} onClose={() => setNoteFor(null)} onChanged={changed} />
      <PhotosDialog request={photosFor} onClose={() => setPhotosFor(null)} />
      <ApproveDialog request={approveFor} onClose={() => setApproveFor(null)} onChanged={changed} />
      <RejectDialog request={rejectFor} onClose={() => setRejectFor(null)} onChanged={changed} />
      <CloseRequestDialog request={closeFor} onClose={() => setCloseFor(null)} onChanged={changed} />
      <RefundDialog open={refundFor} onClose={() => setRefundFor(null)} onChanged={changed} />
    </div>
  );
}

export default AdminReturnRequests;
