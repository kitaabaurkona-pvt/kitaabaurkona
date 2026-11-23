import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, CalendarBlank, CaretDown, Copy, Info, MagnifyingGlass, NotePencil, X } from '@phosphor-icons/react';
import {
  ADMIN_ALL_LIMIT,
  ADMIN_PAGE_SIZE,
  adminErrorMessage,
  adminListOrders,
  adminOrderSummary,
  adminSetStage,
  adminStageOrderIds,
  CANCELLED_FROM,
  deliverByOf,
  fulfilmentOf,
  NEXT_STATUSES,
  ORDER_TABS,
  PROCESS_STAGES,
  SEARCH_BY,
  shipByOf,
  stageOf,
} from '../../services/adminService';
import { ADMIN_SHIPMENT_LABELS, bookNow, CARRIER_NAMES, carrierOf, makeManifest } from '../../services/shippingService';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../hooks/useToast';
import { formatCount, formatOrderNumber, formatPrice, plural } from '../../utils/format';
import OrderStatus from '../../components/store/OrderStatus';
import { LoadError, StateBlock } from '../../components/store/States';
import { LinesSkeleton } from '../../components/store/Skeletons';
import PageHead from '../../components/admin/PageHead';
import OrderDrawer from '../../components/admin/OrderDrawer';
import { CancelDialog, NoteDialog } from '../../components/admin/OrderDialogs';
import DelhiveryPickup from '../../components/admin/DelhiveryPickup';

const NUMERIC_SEARCH = ['order', 'phone', 'min_qty', 'max_qty'];
const MORE_KEYS = ['pay', 'customer', 'remarks', 'coupon'];
const FILTER_KEYS = ['q', 'from', 'to', 'carrier', 'delayed', 'dup', 'was', ...MORE_KEYS];
const PRINT_KINDS = [
  ['labels', 'Label'],
  ['invoices', 'Invoice'],
  ['slips', 'Packing slip'],
];
// Steps whose banner says what to do there (ShopDeck shows the same reminders).
const STAGE_TIPS = {
  pack: 'Move the packed orders to Handover before giving them to the shipping partner.',
  handover: 'Use Print & lock manifest just before giving the parcels to the shipping partner, so that an order cancelled in the meantime is not sent.',
};

const ago = (value, now) => {
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60000));
  if (minutes < 60) return minutes <= 1 ? 'Just now' : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hrs ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
};
const dateTime = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const dayMonth = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' });
const pad2 = (n) => String(n).padStart(2, '0');
const forwardOf = (order) => (order.shipments ?? []).find((s) => s.kind === 'forward' && s.status !== 'cancelled') ?? null;
// A label can be printed once the parcel is booked (it has an AWB).
const labelReady = (order) => Boolean(forwardOf(order)?.awb_number);
// Only Xpressbees parcels go on its pickup manifest; Delhivery collects through a pickup
// request (Admin > Shipping).
const manifestable = (order) => (order.shipments ?? []).some((s) => s.kind === 'forward' && s.carrier !== 'delhivery' && ['booked', 'in_transit'].includes(s.status));
// A failed booking that may have gone through anyway: an admin must check the courier's
// panel first (in the side panel), so it is never booked again from the list.
const held = (order) => Boolean(forwardOf(order)?.needs_check);
const canCancel = (order) => (NEXT_STATUSES[order.status] ?? []).includes('cancelled');
// The courier's public tracking page for an AWB.
const trackingUrl = (parcel) =>
  carrierOf(parcel) === 'delhivery'
    ? `https://www.delhivery.com/track-v2/package/${parcel.awb_number}`
    : `https://www.xpressbees.com/shipment/tracking?awbNo=${parcel.awb_number}`;
// Orders grouped by the books in them (Group By SKU ID).
const skuKey = (order) =>
  order.order_items
    .map((i) => i.sku)
    .sort()
    .join(' + ');

// ---------- Cancelled tab ----------

const REFUND_STATES = {
  requested: ['Requested', 'warn'],
  initiated: ['Initiated', 'warn'],
  pending: ['Pending', 'warn'],
  successful: ['Refunded', 'ok'],
  failed: ['Failed', 'danger'],
  auto_refund: ['Auto refund', 'warn'],
};
const CANCELLED_BY = { seller: 'By seller', customer: 'By customer', system: 'Automatic' };
const wasLabel = (value) => CANCELLED_FROM.find(([v]) => v === value)?.[1] ?? 'Not recorded';
// The order's last forward parcel, cancelled or not (a cancelled order's parcel usually is).
const lastForward = (order) =>
  (order.shipments ?? []).filter((s) => s.kind === 'forward').sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] ?? null;

// What a cancelled order's customer gets back. GoKwik orders refund through GoKwik (its
// state comes from order_payments); money paid any other way is refunded by hand.
function refundOf(order, pay) {
  const paid = Number(order.amount_paid ?? 0);
  const due = paid > 0 ? paid : order.payment_method === 'online' && order.cancelled_from && order.cancelled_from !== 'payment_pending' ? Number(order.total ?? order.subtotal ?? 0) : 0;
  if (pay?.refund_status) {
    const [state, tone] = REFUND_STATES[pay.refund_status] ?? [pay.refund_status, 'warn'];
    return { amount: Number(pay.refunded_amount) > 0 ? Number(pay.refunded_amount) : due, state, tone, at: pay.refunded_at };
  }
  if (due > 0) return { amount: due, state: 'Refund by hand', tone: 'warn', at: null };
  return { amount: 0, state: 'Not applicable', tone: null, at: null };
}

// One spreadsheet cell: quoted, and text a spreadsheet would run as a formula is defused.
const csvCell = (value) => {
  const text = String(value ?? '');
  return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
};

function downloadCancelled(orders, refunds) {
  const head = ['Cancelled on', 'Cancelled by', 'Order', 'Placed on', 'Earlier state', 'AWB', 'Courier', 'Payment', 'Order value', 'Refund amount', 'Refund state', 'Customer', 'Mobile', 'Note'];
  const rows = orders.map((o) => {
    const parcel = lastForward(o);
    const refund = refundOf(o, refunds[o.id]);
    return [
      o.cancelled_at ? dateTime.format(new Date(o.cancelled_at)).replace(',', '') : '',
      CANCELLED_BY[o.cancelled_by] ?? '',
      formatOrderNumber(o.order_number),
      dateTime.format(new Date(o.created_at)).replace(',', ''),
      wasLabel(o.cancelled_from),
      parcel?.awb_number ?? '',
      parcel ? (parcel.courier_name ?? CARRIER_NAMES[carrierOf(parcel)]) : '',
      o.payment_method === 'cod' ? 'COD' : 'Prepaid',
      Number(o.total ?? o.subtotal ?? 0).toFixed(2),
      refund.amount.toFixed(2),
      refund.state,
      o.shipping_name,
      o.shipping_phone,
      fulfilmentOf(o)?.note ?? '',
    ];
  });
  const csv = [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `cancelled-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CancelledRow({ order, refund, onOpen, onNotes }) {
  const parcel = lastForward(order);
  const note = fulfilmentOf(order)?.note;
  return (
    <tr>
      <td className="ap-col-order" data-label="Cancelled">
        <span className="ap-strong tnum">{order.cancelled_at ? dateTime.format(new Date(order.cancelled_at)).replace(',', '') : 'Date not recorded'}</span>
        {CANCELLED_BY[order.cancelled_by] && <span className="ap-badge ap-badge-sm">{CANCELLED_BY[order.cancelled_by]}</span>}
      </td>
      <td data-label="Order">
        <button type="button" className="ap-order-link" onClick={() => onOpen(order.id)}>
          {formatOrderNumber(order.order_number)}
        </button>
        <span className="ap-cell-meta">Order placed:</span>
        <span className="ap-cell-meta tnum">{dateTime.format(new Date(order.created_at)).replace(',', '')}</span>
        {order.is_test && <span className="ap-badge">Test order</span>}
      </td>
      <td data-label="Shipping details">
        {parcel?.awb_number ? (
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
            <span className="ap-cell-meta">{parcel.courier_name ?? CARRIER_NAMES[carrierOf(parcel)]}</span>
          </>
        ) : (
          <span className="ap-cell-meta">Not booked</span>
        )}
      </td>
      <td data-label="Payment">
        <dl className="ap-kv">
          <div>
            <dt>Mode</dt>
            <dd>{order.payment_method === 'cod' ? 'COD' : 'Prepaid'}</dd>
          </div>
          <div>
            <dt>Order value</dt>
            <dd>{formatPrice(order.total ?? order.subtotal ?? 0)}</dd>
          </div>
        </dl>
      </td>
      <td data-label="Refund amount">
        <span className="ap-strong">{formatPrice(refund.amount)}</span>
      </td>
      <td data-label="Refund state">
        <span className="ap-badge ap-badge-caps" data-tone={refund.tone ?? undefined}>
          {refund.state}
        </span>
        {refund.at && <span className="ap-cell-meta">Refunded {dayMonth.format(new Date(refund.at))}</span>}
      </td>
      <td className="ap-col-actions" data-label="Status & details">
        <span className="ap-cell-meta">Earlier state:</span>
        <span className="ap-strong">{wasLabel(order.cancelled_from)}</span>
        {note && (
          <span className="ap-note" title={note}>
            <NotePencil size={14} aria-label="Note" />
            <span className="ap-clamp">{note}</span>
          </span>
        )}
        <div className="ap-row-actions ap-row-actions-stack">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onNotes(order)}>
            <NotePencil size={16} aria-hidden="true" />
            Notes
          </button>
        </div>
      </td>
    </tr>
  );
}

function Summary({ data, onPick }) {
  const stage = (value, label) => (
    <button type="button" className="ap-sum-part" onClick={() => onPick({ stage: value === 'print' ? '' : value })}>
      <span className="ap-stat-value">{formatCount(data.stages[value] ?? 0)}</span>
      <span className="ap-stat-label">{label}</span>
    </button>
  );
  return (
    <div className="ap-summary">
      <button type="button" className="ap-stat" onClick={() => onPick({})}>
        <span className="ap-stat-value">{formatCount(data.total)}</span>
        <span className="ap-stat-label">Total non-dispatched orders</span>
      </button>
      <div className="ap-stat ap-sum-stages">
        {stage('print', 'Non-dispatched orders in Print')}
        {stage('pack', 'In Pack')}
        {stage('handover', 'In Handover')}
      </div>
      <button type="button" className="ap-stat" data-tone={data.delayed > 0 ? 'danger' : undefined} onClick={() => onPick({ delayed: '1' })}>
        <span className="ap-stat-value">
          {formatCount(data.delayed)}
          {data.delayed > 0 && <span className="ap-pill">Dispatch to avoid RTO</span>}
        </span>
        <span className="ap-stat-label">Delayed non-dispatched orders</span>
      </button>
    </div>
  );
}

// One date range control: the chosen days, with the two dates in a small pop-up.
function DateRange({ from, to, onChange }) {
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
  const show = (day) => dayMonth.format(new Date(`${day}T00:00:00+05:30`));
  const text = from || to ? `${from ? show(from) : '…'} – ${to ? show(to) : '…'}` : 'Date Range';
  return (
    <div className="ap-range" ref={box}>
      <button type="button" className="ap-range-button" data-empty={!(from || to) || undefined} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{text}</span>
        <CalendarBlank size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="ap-range-pop" role="group" aria-label="Order date range">
          <label className="label" htmlFor="orders-from">
            From
          </label>
          <input id="orders-from" className="input input-sm" type="date" value={from} max={to || undefined} onChange={(e) => onChange({ from: e.target.value })} />
          <label className="label" htmlFor="orders-to">
            To
          </label>
          <input id="orders-to" className="input input-sm" type="date" value={to} min={from || undefined} onChange={(e) => onChange({ to: e.target.value })} />
          {(from || to) && (
            <button type="button" className="btn-link" onClick={() => onChange({ from: '', to: '' })}>
              Clear dates
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// A small drop-down of print buttons (Print All, a row's Print).
function PrintMenu({ label, kinds, busy, disabled, primary, onPick }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!box.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="ap-menu" ref={box}>
      <button
        type="button"
        className={`btn ${primary ? 'btn-dark' : 'btn-outline'} btn-sm`}
        aria-expanded={open}
        aria-busy={busy || undefined}
        aria-disabled={disabled || undefined}
        onClick={() => !disabled && !busy && setOpen((o) => !o)}
      >
        {busy && <span className="spinner" aria-hidden="true" />}
        {label}
        <CaretDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="ap-menu-list" role="group" aria-label={label}>
          {kinds.map(([kind, text]) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(kind);
              }}
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Whether a step's banner was closed (remembered on this computer).
function useTip(stage) {
  const key = `ap-tip-${stage}`;
  const [closed, setClosed] = useState(() => new Set());
  let stored = false;
  try {
    stored = localStorage.getItem(key) === '1';
  } catch {
    stored = false;
  }
  const hidden = stored || closed.has(key);
  const hide = () => {
    setClosed((current) => new Set(current).add(key));
    try {
      localStorage.setItem(key, '1');
    } catch {
      // Private browsing: the banner simply comes back next time.
    }
  };
  return [hidden, hide];
}

function OrderRow({ order, mode, now, selectable, picked, customerOrders, productCodes, working, onPick, onOpen, onNotes, onCancel, onStage, onPrint, onRegenerate, onPhone }) {
  const note = fulfilmentOf(order)?.note;
  const first = order.order_items[0];
  const more = order.order_items.length - 1;
  const total = Number(order.total ?? order.subtotal ?? 0);
  const cod = order.payment_method === 'cod';
  const toCollect = cod ? Math.max(0, total - Number(order.amount_paid ?? 0)) : 0;
  const parcel = forwardOf(order);
  const shipBy = shipByOf(order.created_at);
  const waiting = ['print', 'pack', 'handover', 'awb_failed', 'pending'].includes(mode);
  const late = waiting && mode !== 'pending' && shipBy.getTime() < now;
  const printable = !['pending_payment', 'cancelled'].includes(order.status);
  const parcelState = parcel && (parcel.needs_check && parcel.status === 'failed' ? ADMIN_SHIPMENT_LABELS.needs_check : (ADMIN_SHIPMENT_LABELS[parcel.status] ?? parcel.status));
  const { show } = useToast();
  const created = new Date(order.created_at);

  async function copyTracking() {
    try {
      await navigator.clipboard.writeText(trackingUrl(parcel));
      show({ message: 'Tracking link copied' });
    } catch {
      show({ message: 'Could not copy. Open the link and copy it from the address bar.', tone: 'error' });
    }
  }

  const button = (text, onClick, { dark = false, busy = false } = {}) => (
    <button type="button" className={`btn ${dark ? 'btn-dark' : 'btn-outline'} btn-sm`} aria-busy={busy || undefined} onClick={onClick}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {text}
    </button>
  );
  const notes = (
    <button type="button" className="btn btn-outline btn-sm" onClick={() => onNotes(order)}>
      <NotePencil size={16} aria-hidden="true" />
      Notes
    </button>
  );
  const logistic = button('Logistic', () => onOpen(order.id, 'parcel'));
  const cancel = canCancel(order) && (
    <button type="button" className="ap-cancel-link" onClick={() => onCancel(order)}>
      Cancel
    </button>
  );
  const printMenu = printable && <PrintMenu label="Print" kinds={labelReady(order) ? PRINT_KINDS : PRINT_KINDS.slice(1)} busy={working} onPick={(kind) => onPrint(kind, order)} />;

  let actions;
  if (mode === 'print') {
    actions = (
      <>
        {notes}
        {labelReady(order) ? button('Label', () => onPrint('labels', order), { dark: true, busy: working }) : button('Book parcel', () => onOpen(order.id, 'parcel'), { dark: true })}
        {button('Invoice', () => onPrint('invoices', order), { busy: false })}
        {logistic}
        {cancel}
      </>
    );
  } else if (mode === 'pack') {
    actions = (
      <>
        {notes}
        {button('Handover', () => onStage([order.id], 'handover', 'Packed'), { dark: true, busy: working })}
        {printMenu}
        {logistic}
        {cancel}
      </>
    );
  } else if (mode === 'handover') {
    actions = (
      <>
        {notes}
        {printMenu}
        {logistic}
        {cancel}
      </>
    );
  } else if (mode === 'awb_failed') {
    actions = (
      <>
        {held(order) ? button('Check booking', () => onOpen(order.id, 'parcel'), { dark: true }) : button('Regenerate', () => onRegenerate(order), { dark: true, busy: working })}
        {notes}
        {logistic}
        {cancel}
      </>
    );
  } else if (mode === 'track') {
    actions = (
      <>
        {notes}
        {printMenu}
        {logistic}
      </>
    );
  } else {
    actions = (
      <>
        {notes}
        {button('Details', () => onOpen(order.id))}
        {cancel}
      </>
    );
  }

  return (
    <tr data-picked={picked || undefined}>
      <td className="ap-col-pick">
        {selectable && (
          <label className="pick">
            <input type="checkbox" checked={picked} onChange={() => onPick(order.id)} />
            <span className="visually-hidden">Select {formatOrderNumber(order.order_number)}</span>
          </label>
        )}
      </td>
      <td className="ap-col-order" data-label="Order">
        {waiting && mode !== 'pending' && (
          <span className="ap-badge ap-badge-caps" data-tone={late ? 'danger' : 'ok'}>
            {late ? 'Delayed' : 'On time'}
          </span>
        )}
        {(mode === 'track' || mode === 'pending' || mode === 'cancelled') && <OrderStatus status={order.status} />}
        <span className="ap-cell-meta">{ago(order.created_at, now)}</span>
        <span className="ap-cell-meta tnum">{dateTime.format(created).replace(',', '')}</span>
        <span className="ap-cell-meta">Website</span>
        <button type="button" className="ap-order-link" onClick={() => onOpen(order.id)}>
          {formatOrderNumber(order.order_number)}
        </button>
        {order.is_test && <span className="ap-badge">Test order</span>}
        {note && (
          <span className="ap-note" title={note}>
            <NotePencil size={14} aria-label="Note" />
            <span className="ap-clamp">{note}</span>
          </span>
        )}
      </td>
      <td className="ap-col-book" data-label="Product">
        {first && (
          <div className="ap-book-cell">
            {first.image_url ? <img className="ap-thumb" src={first.image_url} alt="" width="44" height="60" loading="lazy" /> : <span className="ap-thumb ap-thumb-empty" aria-hidden="true" />}
            <span>
              <span className="ap-book-name ap-clamp">{first.title}</span>
              <span className="ap-book-sku">
                Quantity: <span className="ap-qty">{pad2(first.quantity)}</span>
              </span>
              <span className="ap-book-sku">SKU ID: {first.sku}</span>
              {first.book_id && productCodes[first.book_id] && <span className="ap-book-sku">Product ID: {productCodes[first.book_id]}</span>}
              {more > 0 && <span className="ap-book-sku">+ {plural(more, 'more book')}</span>}
            </span>
          </div>
        )}
      </td>
      <td data-label="Payment">
        <dl className="ap-kv">
          <div>
            <dt>Mode</dt>
            <dd>{cod ? 'COD' : 'Prepaid'}</dd>
          </div>
          <div>
            <dt>FSP</dt>
            <dd>{formatPrice(total)}</dd>
          </div>
          <div>
            <dt>Total discount</dt>
            <dd>{formatPrice(order.discount_total ?? 0)}</dd>
          </div>
          <div>
            <dt>Amt. to collect</dt>
            <dd>{formatPrice(toCollect)}</dd>
          </div>
        </dl>
      </td>
      <td className="ap-col-customer" data-label="Customer">
        <span className="tnum">
          <button type="button" className="ap-text-link" title="Show this customer's orders" onClick={() => onPhone(order.shipping_phone)}>
            {order.shipping_phone}
          </button>{' '}
          {customerOrders != null &&
            (customerOrders >= 2 ? (
              <span className="ap-badge ap-badge-sm" data-tone="ok" title={`${customerOrders} orders from this number`}>
                Repeat · {customerOrders}
              </span>
            ) : (
              <span className="ap-badge ap-badge-sm">New</span>
            ))}
        </span>
        <span className="ap-strong">{order.shipping_name}</span>
        <span className="ap-cell-meta ap-clamp ap-clamp-1" title={`${order.shipping_address}, ${order.shipping_city}, ${order.shipping_state} ${order.shipping_pincode}`}>
          {order.shipping_address}, {order.shipping_city}, {order.shipping_state} {order.shipping_pincode}
        </span>
        {['pending_payment', 'confirmed', 'paid'].includes(order.status) && (
          <button type="button" className="ap-text-link ap-edit-link" onClick={() => onOpen(order.id, 'address')}>
            Edit
          </button>
        )}
      </td>
      <td data-label="Shipping">
        {parcel ? (
          <>
            {parcel.awb_number ? (
              <>
                <span className="ap-cell-meta">
                  AWB:{' '}
                  <a className="ap-text-link tnum" href={trackingUrl(parcel)} target="_blank" rel="noopener noreferrer">
                    {parcel.awb_number}
                  </a>
                </span>
                <span className="ap-cell-meta ap-track">
                  Track:{' '}
                  <a className="ap-text-link" href={trackingUrl(parcel)} target="_blank" rel="noopener noreferrer">
                    Link
                  </a>
                  <button type="button" className="ap-icon-button ap-copy" aria-label={`Copy the tracking link of ${formatOrderNumber(order.order_number)}`} onClick={copyTracking}>
                    <Copy size={14} aria-hidden="true" />
                  </button>
                </span>
              </>
            ) : (
              <span className="status" data-status={parcel.needs_check && parcel.status === 'failed' ? 'exception' : parcel.status}>
                {parcelState}
              </span>
            )}
            {parcel.total_charges != null && <span className="ap-cell-meta">Charge: {formatPrice(parcel.total_charges)}</span>}
            <span className="ap-cell-meta">Partner: {parcel.courier_name ?? CARRIER_NAMES[carrierOf(parcel)]}</span>
          </>
        ) : (
          <span className="ap-cell-meta">No parcel yet</span>
        )}
      </td>
      {waiting && (
        <td data-label="Dispatch & Delivery">
          <span className="ap-cell-meta">Est. dispatch date:</span>
          <span className={late ? 'ap-strong ap-late' : 'ap-strong'}>{dayMonth.format(shipBy)}</span>
          <span className="ap-cell-meta">Est. delivery date:</span>
          <span className="ap-strong">{dayMonth.format(deliverByOf(order.created_at))}</span>
        </td>
      )}
      <td className="ap-col-actions">
        <div className="ap-row-actions ap-row-actions-stack">{actions}</div>
      </td>
    </tr>
  );
}

// Process orders (orders still to ship) and Track orders (every order), laid out like
// ShopDeck's Process Orders: numbers at the top, tabs, the Print -> Pack -> Handover
// steps, filters, then one row per order with its buttons. Each order also opens in a
// side panel with its parcel and status actions.
function AdminOrders({ view = 'process' }) {
  const tabs = ORDER_TABS[view];
  const title = view === 'process' ? 'Process orders' : 'Track orders';
  useDocumentTitle(title);
  const [params, setParams] = useSearchParams();
  const tab = tabs.some(([value]) => value === params.get('tab')) ? params.get('tab') : tabs[0][0];
  const searchBy = SEARCH_BY.some(([value]) => value === params.get('by')) ? params.get('by') : 'order';
  const q = params.get('q') ?? '';
  const [term, setTerm] = useState(q);
  const [page, setPage] = useState(0);
  const process = view === 'process';
  // Process orders > Non-dispatched is split into the packing steps.
  const stage = process && tab === 'to_ship' ? (PROCESS_STAGES.some(([value]) => value === params.get('stage')) ? params.get('stage') : 'print') : '';
  // Process orders lists single-book orders or clubbed ones (no "all", as on ShopDeck).
  const splitItems = process && ['to_ship', 'awb_failed'].includes(tab);
  const waitingTab = process && ['to_ship', 'awb_failed'].includes(tab);
  const items = splitItems ? (params.get('items') === 'clubbed' ? 'clubbed' : 'single') : ['single', 'clubbed'].includes(params.get('items')) ? params.get('items') : '';
  const grouped = splitItems && params.get('group') === 'sku';
  const filters = {
    view,
    tab,
    stage,
    searchBy,
    search: q,
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    carrier: CARRIER_NAMES[params.get('carrier')] ? params.get('carrier') : '',
    dup: waitingTab && ['yes', 'no'].includes(params.get('dup')) ? params.get('dup') : '',
    payment: ['cod', 'online'].includes(params.get('pay')) ? params.get('pay') : '',
    customer: ['new', 'repeat'].includes(params.get('customer')) ? params.get('customer') : '',
    remarks: ['yes', 'no'].includes(params.get('remarks')) ? params.get('remarks') : '',
    coupon: ['yes', 'no'].includes(params.get('coupon')) ? params.get('coupon') : '',
    was: process && tab === 'cancelled' && CANCELLED_FROM.some(([value]) => value === params.get('was')) ? params.get('was') : '',
    delayed: waitingTab && params.get('delayed') === '1',
    items,
    all: grouped,
    sort: params.get('sort') === 'oldest' ? 'oldest' : 'newest',
    page: grouped ? 0 : page,
  };
  const key = JSON.stringify(filters);
  const result = useAsync(() => adminListOrders(filters), [key]);
  const summary = useAsync(() => (process ? adminOrderSummary() : Promise.resolve(null)), [view]);
  const orders = result.data?.orders ?? [];
  const total = result.data?.total ?? 0;
  const pages = grouped ? 1 : Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const [picked, setPicked] = useState(() => new Set());
  const [bulk, setBulk] = useState({ working: null, error: null });
  const [rowWorking, setRowWorking] = useState(null);
  const [moreOpen, setMoreOpen] = useState(() => MORE_KEYS.some((name) => params.get(name)));
  // Delhivery parcels just handed over: Delhivery collects only when asked.
  const [pickupFor, setPickupFor] = useState(0);
  const [open, setOpen] = useState({ id: null, focus: null });
  const [noteFor, setNoteFor] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const [tipHidden, hideTip] = useTip(stage || tab);
  const { show } = useToast();
  // "Now" for ages and late badges: when the list arrived.
  const now = result.data?.at ?? 0;
  const openOrder = orders.find((o) => o.id === open.id) ?? null;
  const mode = view === 'track' ? 'track' : tab === 'to_ship' ? stage : tab;

  // Orders can be selected to print their documents; at Handover only booked parcels
  // (they go on the manifest). Unpaid and cancelled orders have nothing to print.
  function selectable(order) {
    const parcel = forwardOf(order);
    if (mode === 'handover') return parcel?.status === 'booked' && Boolean(parcel.awb_number);
    if (mode === 'awb_failed') return !held(order);
    return !['pending_payment', 'cancelled'].includes(order.status);
  }
  const pickable = orders.filter(selectable);

  // The search box waits for a pause in typing before it searches.
  useEffect(() => {
    const wanted = term.trim();
    if (wanted === q) return undefined;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(window.location.search);
      if (wanted) next.set('q', wanted);
      else next.delete('q');
      setParams(next, { replace: true });
      setPage(0);
      setPicked(new Set());
    }, 350);
    return () => clearTimeout(timer);
  }, [term, q, setParams]);

  // Changes some filters (an empty value removes one) and goes back to page 1.
  function update(changes, { reset = false } = {}) {
    const next = new URLSearchParams(reset ? '' : window.location.search);
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    setParams(next, { replace: true });
    setPage(0);
    setPicked(new Set());
  }

  function pickSummary(filter) {
    setTerm('');
    update({ tab: '', ...filter }, { reset: true });
  }

  function searchPhone(phone) {
    setTerm(phone);
    update({ by: 'phone', q: phone });
  }

  function togglePick(id) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function changed() {
    result.retry();
    summary.retry();
  }

  const openSheet = (id, focus = null) => setOpen({ id, focus });

  // One order moved by its own row button (Handover at Pack).
  async function moveRow(ids, to, done) {
    if (rowWorking) return;
    setRowWorking(ids[0]);
    try {
      await adminSetStage(ids, to);
      show({ message: `${done}: ${formatOrderNumber(orders.find((o) => o.id === ids[0])?.order_number)}` });
      changed();
    } catch (err) {
      show({ message: adminErrorMessage(err), tone: 'error' });
    } finally {
      setRowWorking(null);
    }
  }

  // The selected orders, only those that can take the current action.
  const chosen = () => orders.filter((o) => picked.has(o.id) && selectable(o));
  // Every order matching the filters (not only this page), for the "all" buttons.
  const everyMatch = async () => (grouped ? orders : (await adminListOrders({ ...filters, all: true, page: 0 })).orders).filter(selectable);

  async function runBulk(name, fn) {
    if (bulk.working) return;
    setBulk({ working: name, error: null });
    try {
      await fn();
      setBulk({ working: null, error: null });
      setPicked(new Set());
      changed();
    } catch (err) {
      setBulk({ working: null, error: err.code || err.hint ? adminErrorMessage(err) : err.message });
    }
  }

  // Labels, invoices, packing slips or a picking list for some orders, as one PDF.
  // Printing labels at the Print step moves those orders to Pack (as on ShopDeck).
  async function printFor(kind, list) {
    if (list.length === 0) throw new Error('There are no orders to print here.');
    const { printDocuments } = await import('../../admin/documents/print');
    const { printed, skipped } = await printDocuments(kind, list);
    const what = { labels: 'label', invoices: 'invoice', slips: 'packing slip', picklist: 'picking list' }[kind];
    if (printed.length && kind !== 'picklist') show({ message: `${plural(printed.length, what)} downloaded` });
    if (kind === 'picklist') show({ message: `Picking list for ${plural(printed.length, 'order')} downloaded` });
    if (skipped.length) {
      const why = kind === 'labels' ? 'no booked parcel yet' : 'not paid or cancelled';
      show({ message: `${plural(skipped.length, 'order')} left out (${why}): ${skipped.map((o) => formatOrderNumber(o.order_number)).join(', ')}`, tone: 'error' });
    }
    const toPack = kind === 'labels' ? printed.filter((o) => stageOf(o) === 'print' && ['confirmed', 'paid'].includes(o.status)).map((o) => o.id) : [];
    if (toPack.length) await adminSetStage(toPack, 'pack');
    return printed.length;
  }

  const printSelected = (kind) => runBulk(`print-${kind}`, () => printFor(kind, chosen()));
  const printAll = (kind) => runBulk(`all-${kind}`, async () => printFor(kind, await everyMatch()));

  // One order's document: the row's buttons, or the side panel's.
  async function printOne(kind, order) {
    if (rowWorking) return;
    setRowWorking(order.id);
    try {
      await printFor(kind, [order]);
      changed();
    } catch (err) {
      show({ message: err.code || err.hint ? adminErrorMessage(err) : err.message, tone: 'error' });
    } finally {
      setRowWorking(null);
    }
  }

  const moveSelected = (to, done) =>
    runBulk(`move-${to}`, async () => {
      let list = chosen();
      if (to === 'pack') list = list.filter(labelReady);
      if (list.length === 0) throw new Error('None of the selected orders has a booked parcel yet.');
      const n = await adminSetStage(list.map((o) => o.id), to);
      show({ message: `${plural(n ?? 0, 'order')} ${done}` });
    });

  // ShopDeck's "Move All to Handover": every order at Pack, not only this page.
  const moveAllToHandover = () =>
    runBulk('all-handover', async () => {
      const ids = await adminStageOrderIds('pack');
      if (ids.length === 0) return;
      const n = await adminSetStage(ids, 'handover');
      show({ message: `${plural(n ?? 0, 'order')} moved to Handover` });
    });

  // Print & lock manifest: the Xpressbees parcels go on one manifest (opened in a new tab,
  // printed and given to the courier with the parcels) and the orders leave Process
  // orders; Delhivery collects when asked, so its pickup form opens for those parcels.
  function handOver(getList) {
    if (bulk.working) return;
    // The new tab is opened straight away: browsers block tabs opened after a wait.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    runBulk('handover', async () => {
      try {
        const list = await getList();
        if (list.length === 0) throw new Error('No booked parcel is waiting at Handover.');
        const xb = list.filter((o) => carrierOf(forwardOf(o)) !== 'delhivery').map((o) => o.id);
        const dl = list.length - xb.length;
        if (xb.length) {
          const { url } = await makeManifest(xb);
          if (tab) tab.location.href = url;
          else window.open(url, '_blank', 'noopener,noreferrer');
        } else {
          tab?.close();
        }
        const n = await adminSetStage(list.map((o) => o.id), 'handed_over');
        show({ message: `${plural(n ?? 0, 'order')} handed over` });
        if (dl > 0) setPickupFor(dl);
      } catch (err) {
        tab?.close();
        throw err;
      }
    });
  }

  const openManifest = () =>
    runBulk('manifest', async () => {
      const { url } = await makeManifest(chosen().filter(manifestable).map((o) => o.id));
      window.open(url, '_blank', 'noopener,noreferrer');
    });

  // Regenerate AWB: books the failed parcels again with their courier, one at a time.
  async function rebook(list) {
    let done = 0;
    const failed = [];
    for (const order of list) {
      try {
        await bookNow(order.id);
        done += 1;
      } catch {
        failed.push(formatOrderNumber(order.order_number));
      }
    }
    if (done) show({ message: `${plural(done, 'parcel')} booked again` });
    if (failed.length) show({ message: `Booking failed again for ${failed.join(', ')}. Open Logistic to see why.`, tone: 'error' });
  }
  const regenerateAll = () => runBulk('regenerate', async () => rebook(await everyMatch()));
  const regenerateSelected = () => runBulk('regenerate', async () => rebook(chosen()));
  async function regenerateOne(order) {
    if (rowWorking) return;
    setRowWorking(order.id);
    try {
      await rebook([order]);
      changed();
    } finally {
      setRowWorking(null);
    }
  }

  // Download: every cancelled order matching the filters, as a spreadsheet (CSV).
  const downloadAll = () =>
    runBulk('download', async () => {
      const all = await adminListOrders({ ...filters, all: true, page: 0 });
      if (all.orders.length === 0) throw new Error('There are no cancelled orders to download.');
      downloadCancelled(all.orders, all.refunds ?? {});
      show({ message: `${plural(all.orders.length, 'cancelled order')} downloaded` });
    });

  const anyFilter = FILTER_KEYS.some((name) => params.get(name));
  const allPicked = pickable.length > 0 && pickable.every((o) => picked.has(o.id));
  const pickedCount = chosen().length;
  const manifestCount = chosen().filter(manifestable).length;
  const stageCounts = summary.data?.stages ?? {};
  const tabCounts = summary.data?.tabs ?? {};
  const busyAll = (name) => bulk.working === name;

  // Group By SKU ID: the orders (all of them, up to ADMIN_ALL_LIMIT) in groups of the same books.
  const groups = grouped
    ? Object.values(
        orders.reduce((acc, order) => {
          const k = skuKey(order);
          (acc[k] ??= { key: k, title: order.order_items[0]?.title ?? '', orders: [], copies: 0 }).orders.push(order);
          acc[k].copies += order.item_count;
          return acc;
        }, {}),
      ).sort((a, b) => b.orders.length - a.orders.length || a.key.localeCompare(b.key))
    : null;
  const columns = 7 + (waitingTab || mode === 'pending' ? 1 : 0);

  const rowOf = (order) => (
    <OrderRow
      key={order.id}
      order={order}
      mode={mode}
      now={now}
      selectable={selectable(order)}
      picked={picked.has(order.id)}
      customerOrders={result.data.customerOrders?.[order.shipping_phone]}
      productCodes={result.data.productCodes ?? {}}
      working={rowWorking === order.id}
      onPick={togglePick}
      onOpen={openSheet}
      onNotes={setNoteFor}
      onCancel={setCancelFor}
      onStage={moveRow}
      onPrint={printOne}
      onRegenerate={regenerateOne}
      onPhone={searchPhone}
    />
  );

  return (
    <div className="stack-sm ap-orders-page">
      <PageHead title={title} />

      {process && summary.data && <Summary data={summary.data} onPick={pickSummary} />}

      <div className="ap-underline-tabs" role="tablist" aria-label="Show orders">
        {tabs.map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => update({ tab: value === tabs[0][0] ? '' : value, delayed: '', dup: '', stage: '', items: '', group: '' })}>
            {label}
            {tabCounts[value] != null && ` (${formatCount(tabCounts[value])})`}
          </button>
        ))}
      </div>

      <section className="ap-card" aria-label="Orders">
        {(stage || splitItems || view === 'track') && (
          <div className="ap-stage-bar">
            {stage ? (
              <div className="ap-segment ap-segment-stage" role="group" aria-label="Packing step">
                {PROCESS_STAGES.map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={stage === value} onClick={() => update({ stage: value === 'print' ? '' : value, group: '' })}>
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <span />
            )}
            <div className="ap-stage-tools">
              {mode !== 'handover' && (
                <div className="ap-segment" role="group" aria-label="Books in the order">
                  {!splitItems && (
                    <button type="button" aria-pressed={!items} onClick={() => update({ items: '' })}>
                      All
                    </button>
                  )}
                  <button type="button" aria-pressed={items === 'single'} onClick={() => update({ items: splitItems ? '' : 'single', group: '' })}>
                    Single{result.data ? ` (${formatCount(result.data.single)})` : ''}
                  </button>
                  <button type="button" aria-pressed={items === 'clubbed'} onClick={() => update({ items: 'clubbed', group: '' })}>
                    Clubbed{result.data ? ` (${formatCount(result.data.clubbed)})` : ''}
                  </button>
                </div>
              )}
              {stage && (
                <button type="button" className="chip" aria-pressed={filters.delayed} onClick={() => update({ delayed: filters.delayed ? '' : '1' })}>
                  Delayed Order{result.data ? ` (${formatCount(result.data.delayed)})` : ''}
                </button>
              )}
              {splitItems && mode !== 'handover' && (
                <button type="button" className="chip" aria-pressed={grouped} onClick={() => update({ group: grouped ? '' : 'sku' })}>
                  Group By SKU ID
                </button>
              )}
              {mode === 'print' && (
                <button type="button" className="btn btn-outline btn-sm" aria-busy={busyAll('all-slips') || undefined} onClick={() => printAll('slips')}>
                  {busyAll('all-slips') && <span className="spinner" aria-hidden="true" />}
                  Packing Slip
                </button>
              )}
              {(mode === 'print' || mode === 'pack') && (
                <PrintMenu
                  label="Print All"
                  primary={mode === 'print'}
                  kinds={[
                    ['labels', 'Label'],
                    ['invoices', 'Invoice'],
                    ['picklist', 'Picking list'],
                  ]}
                  busy={['all-labels', 'all-invoices', 'all-picklist'].includes(bulk.working)}
                  disabled={total === 0}
                  onPick={printAll}
                />
              )}
              {mode === 'pack' && (
                <button type="button" className="btn btn-dark btn-sm" aria-busy={busyAll('all-handover') || undefined} aria-disabled={(stageCounts.pack ?? 0) === 0 || undefined} onClick={() => (stageCounts.pack ?? 0) > 0 && moveAllToHandover()}>
                  {busyAll('all-handover') && <span className="spinner" aria-hidden="true" />}
                  Move All to Handover
                </button>
              )}
              {mode === 'handover' && (
                <button type="button" className="btn btn-dark btn-sm" aria-busy={busyAll('handover') || undefined} aria-disabled={total === 0 || undefined} onClick={() => total > 0 && handOver(everyMatch)}>
                  {busyAll('handover') && <span className="spinner" aria-hidden="true" />}
                  Print &amp; lock manifest
                </button>
              )}
              {mode === 'awb_failed' && (
                <button type="button" className="btn btn-dark btn-sm" aria-busy={busyAll('regenerate') || undefined} aria-disabled={total === 0 || undefined} onClick={() => total > 0 && regenerateAll()}>
                  {busyAll('regenerate') && <span className="spinner" aria-hidden="true" />}
                  Regenerate All AWB
                </button>
              )}
            </div>
          </div>
        )}

        <div className="ap-filters">
          <div className="ap-search-by">
            <label className="visually-hidden" htmlFor="orders-by">
              Search by
            </label>
            <select id="orders-by" className="select select-sm" value={searchBy} onChange={(e) => update({ by: e.target.value === 'order' ? '' : e.target.value })}>
              {SEARCH_BY.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <div className="ap-search">
              <label className="visually-hidden" htmlFor="orders-q">
                Search orders
              </label>
              <input
                id="orders-q"
                className="input input-sm"
                type="search"
                inputMode={NUMERIC_SEARCH.includes(searchBy) ? 'numeric' : undefined}
                placeholder="Enter Value"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
              <MagnifyingGlass size={18} aria-hidden="true" />
            </div>
          </div>
          <DateRange from={filters.from} to={filters.to} onChange={(changes) => update(changes)} />
          <label className="visually-hidden" htmlFor="orders-carrier">
            Shipping partner
          </label>
          <select id="orders-carrier" className="select select-sm" value={filters.carrier} onChange={(e) => update({ carrier: e.target.value })}>
            <option value="">Shipping Partner</option>
            {Object.entries(CARRIER_NAMES).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
          {waitingTab && mode !== 'handover' && (
            <>
              <label className="visually-hidden" htmlFor="orders-dup">
                Duplicate orders
              </label>
              <select id="orders-dup" className="select select-sm" value={filters.dup} onChange={(e) => update({ dup: e.target.value })}>
                <option value="">Duplicate</option>
                <option value="yes">Possible duplicates</option>
                <option value="no">Not duplicates</option>
              </select>
            </>
          )}
          {mode === 'cancelled' && (
            <>
              <label className="visually-hidden" htmlFor="orders-was">
                Earlier state
              </label>
              <select id="orders-was" className="select select-sm" value={filters.was} onChange={(e) => update({ was: e.target.value })}>
                <option value="">Earlier State</option>
                {CANCELLED_FROM.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          )}
          {moreOpen && (
            <>
              <label className="visually-hidden" htmlFor="orders-pay">
                Payment method
              </label>
              <select id="orders-pay" className="select select-sm" value={filters.payment} onChange={(e) => update({ pay: e.target.value })}>
                <option value="">Payment Method</option>
                <option value="cod">COD</option>
                <option value="online">Prepaid</option>
              </select>
              <label className="visually-hidden" htmlFor="orders-customer">
                Customer type
              </label>
              <select id="orders-customer" className="select select-sm" value={filters.customer} onChange={(e) => update({ customer: e.target.value })}>
                <option value="">Customer Type</option>
                <option value="new">New</option>
                <option value="repeat">Repeat</option>
              </select>
              <label className="visually-hidden" htmlFor="orders-remarks">
                Notes
              </label>
              <select id="orders-remarks" className="select select-sm" value={filters.remarks} onChange={(e) => update({ remarks: e.target.value })}>
                <option value="">Have Remarks</option>
                <option value="yes">With a note</option>
                <option value="no">Without a note</option>
              </select>
              <label className="visually-hidden" htmlFor="orders-coupon">
                Coupon
              </label>
              <select id="orders-coupon" className="select select-sm" value={filters.coupon} onChange={(e) => update({ coupon: e.target.value })}>
                <option value="">Coupon</option>
                <option value="yes">Discount used</option>
                <option value="no">No discount</option>
              </select>
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
                update(Object.fromEntries(FILTER_KEYS.map((name) => [name, ''])));
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {STAGE_TIPS[mode] && !tipHidden && (
          <div className="ap-tip">
            <Info size={18} aria-hidden="true" />
            <p>{STAGE_TIPS[mode]}</p>
            <button type="button" className="ap-icon-button" aria-label="Hide this tip" onClick={hideTip}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}

        {mode === 'cancelled' && (
          <div className="ap-tip">
            <Info size={18} aria-hidden="true" />
            <p>Before handing over any parcel to the shipping partner, check the cancelled orders so that none of them is sent.</p>
            <button type="button" className="btn btn-dark btn-sm" aria-busy={busyAll('download') || undefined} onClick={downloadAll}>
              {busyAll('download') && <span className="spinner" aria-hidden="true" />}
              Download
            </button>
          </div>
        )}

        {pickedCount > 0 && (
          <div className="ap-bulkbar">
            <p>{plural(pickedCount, 'order')} selected</p>
            <div className="inline-actions">
              <PrintMenu
                label="Print"
                primary
                kinds={[
                  ['labels', 'Labels'],
                  ['invoices', 'Invoices'],
                  ['slips', 'Packing slips'],
                  ['picklist', 'Picking list'],
                ]}
                busy={String(bulk.working).startsWith('print-')}
                onPick={printSelected}
              />
              {mode === 'print' && (
                <button type="button" className="btn btn-outline btn-sm" aria-busy={busyAll('move-pack') || undefined} onClick={() => moveSelected('pack', 'moved to Pack')}>
                  {busyAll('move-pack') && <span className="spinner" aria-hidden="true" />}
                  Move to Pack
                </button>
              )}
              {mode === 'pack' && (
                <button type="button" className="btn btn-dark btn-sm" aria-busy={busyAll('move-handover') || undefined} onClick={() => moveSelected('handover', 'moved to Handover')}>
                  {busyAll('move-handover') && <span className="spinner" aria-hidden="true" />}
                  Move to Handover
                </button>
              )}
              {mode === 'handover' && (
                <button type="button" className="btn btn-dark btn-sm" aria-busy={busyAll('handover') || undefined} onClick={() => handOver(async () => chosen())}>
                  {busyAll('handover') && <span className="spinner" aria-hidden="true" />}
                  Print &amp; lock manifest for {plural(pickedCount, 'parcel')}
                </button>
              )}
              {mode === 'awb_failed' && (
                <button type="button" className="btn btn-dark btn-sm" aria-busy={busyAll('regenerate') || undefined} onClick={regenerateSelected}>
                  {busyAll('regenerate') && <span className="spinner" aria-hidden="true" />}
                  Regenerate AWB
                </button>
              )}
              {mode === 'track' && manifestCount > 0 && (
                <button type="button" className="btn btn-outline btn-sm" aria-busy={busyAll('manifest') || undefined} onClick={openManifest}>
                  {busyAll('manifest') && <span className="spinner" aria-hidden="true" />}
                  Xpressbees manifest for {plural(manifestCount, 'order')}
                </button>
              )}
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setPicked(new Set())}>
                Clear selection
              </button>
            </div>
          </div>
        )}
        {bulk.error && (
          <p className="notice ap-card-notice" data-tone="error" role="alert">
            {bulk.error}
          </p>
        )}
        {pickupFor > 0 && (
          <div className="ap-card-notice ap-pickup">
            <button type="button" className="ap-icon-button ap-pickup-close" aria-label="Close the Delhivery pickup form" onClick={() => setPickupFor(0)}>
              <X size={20} aria-hidden="true" />
            </button>
            <DelhiveryPickup key={pickupFor} waiting={pickupFor} onDone={() => setPickupFor(0)} />
          </div>
        )}

        {result.loading && !result.data && (
          <div className="ap-card-body">
            <LinesSkeleton count={3} label="Loading orders…" />
          </div>
        )}
        {result.error && (
          <div className="ap-card-body">
            <LoadError onRetry={result.retry} what="orders" />
          </div>
        )}
        {result.data && orders.length === 0 && (
          <div className="ap-card-body">
            <StateBlock title={anyFilter ? 'No orders match these filters.' : 'No orders here.'} />
          </div>
        )}

        {orders.length > 0 && mode === 'cancelled' && (
          <div className="ap-table-wrap">
            <table className="ap-table ap-orders-table ap-cancelled-table">
              <thead>
                <tr>
                  <th>
                    <button type="button" className="ap-sort" onClick={() => update({ sort: filters.sort === 'oldest' ? '' : 'oldest' })}>
                      Cancelled date
                      {filters.sort === 'oldest' ? <ArrowUp size={14} aria-label="oldest first" /> : <ArrowDown size={14} aria-label="newest first" />}
                    </button>
                  </th>
                  <th>
                    Orders <span className="ap-count">{formatCount(total)}</span>
                  </th>
                  <th>Shipping details</th>
                  <th>Payment</th>
                  <th>Refund amount</th>
                  <th>Refund state</th>
                  <th>Status &amp; details</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <CancelledRow key={order.id} order={order} refund={refundOf(order, result.data.refunds?.[order.id])} onOpen={openSheet} onNotes={setNoteFor} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {orders.length > 0 && mode !== 'cancelled' && (
          <div className="ap-table-wrap">
            <table className="ap-table ap-orders-table">
              <thead>
                <tr>
                  <th className="ap-col-pick">
                    {pickable.length > 0 && (
                      <label className="pick">
                        <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(pickable.map((o) => o.id)))} />
                        <span className="visually-hidden">Select every order {grouped ? 'listed' : 'on this page'}</span>
                      </label>
                    )}
                  </th>
                  <th>
                    <button type="button" className="ap-sort" onClick={() => update({ sort: filters.sort === 'oldest' ? '' : 'oldest' })}>
                      Orders <span className="ap-count">{formatCount(total)}</span>
                      {filters.sort === 'oldest' ? <ArrowUp size={14} aria-label="oldest first" /> : <ArrowDown size={14} aria-label="newest first" />}
                    </button>
                  </th>
                  <th>Product</th>
                  <th>Payment</th>
                  <th>Customer</th>
                  <th>Shipping</th>
                  {(waitingTab || mode === 'pending') && <th>Dispatch &amp; Delivery</th>}
                  <th>Action</th>
                </tr>
              </thead>
              {groups ? (
                groups.map((group) => {
                  const inGroup = group.orders.filter(selectable);
                  const groupPicked = inGroup.length > 0 && inGroup.every((o) => picked.has(o.id));
                  return (
                    <tbody key={group.key} className="ap-group">
                      <tr className="ap-group-row">
                        <td className="ap-col-pick">
                          {inGroup.length > 0 && (
                            <label className="pick">
                              <input
                                type="checkbox"
                                checked={groupPicked}
                                onChange={() =>
                                  setPicked((current) => {
                                    const next = new Set(current);
                                    for (const o of inGroup) {
                                      if (groupPicked) next.delete(o.id);
                                      else next.add(o.id);
                                    }
                                    return next;
                                  })
                                }
                              />
                              <span className="visually-hidden">Select every order of SKU {group.key}</span>
                            </label>
                          )}
                        </td>
                        <td colSpan={columns - 1}>
                          <strong>SKU ID: {group.key}</strong>
                          <span className="ap-cell-meta">
                            {group.title} · {plural(group.orders.length, 'order')} · {plural(group.copies, 'copy', 'copies')}
                          </span>
                        </td>
                      </tr>
                      {group.orders.map(rowOf)}
                    </tbody>
                  );
                })
              ) : (
                <tbody>{orders.map(rowOf)}</tbody>
              )}
            </table>
          </div>
        )}

        {result.data && total > 0 && (
          <div className="ap-pager">
            <span className="page-meta" aria-live="polite">
              {plural(total, 'order')}
              {grouped && total > ADMIN_ALL_LIMIT && ` · grouping the newest ${formatCount(ADMIN_ALL_LIMIT)}`}
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

      <OrderDrawer order={openOrder} focus={open.focus} onClose={() => setOpen({ id: null, focus: null })} onChanged={changed} onPrint={printOne} printing={rowWorking === open.id} />
      <NoteDialog order={noteFor} onClose={() => setNoteFor(null)} onChanged={changed} />
      <CancelDialog order={cancelFor} onClose={() => setCancelFor(null)} onChanged={changed} />
    </div>
  );
}

export default AdminOrders;
