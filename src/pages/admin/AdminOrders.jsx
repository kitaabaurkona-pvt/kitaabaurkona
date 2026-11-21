import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, CaretDown, MagnifyingGlass, NotePencil, Printer, X } from '@phosphor-icons/react';
import {
  ADMIN_PAGE_SIZE,
  adminErrorMessage,
  adminListOrders,
  adminOrderSummary,
  adminSetStage,
  adminStageOrderIds,
  fulfilmentOf,
  ORDER_TABS,
  shipByOf,
  stageOf,
  STAGES,
} from '../../services/adminService';
import { ADMIN_SHIPMENT_LABELS, CARRIER_NAMES, carrierOf, makeManifest } from '../../services/shippingService';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../hooks/useToast';
import { formatCount, formatOrderNumber, formatPrice, plural } from '../../utils/format';
import OrderStatus from '../../components/store/OrderStatus';
import { LoadError, StateBlock } from '../../components/store/States';
import { LinesSkeleton } from '../../components/store/Skeletons';
import PageHead from '../../components/admin/PageHead';
import OrderDrawer from '../../components/admin/OrderDrawer';
import DelhiveryPickup from '../../components/admin/DelhiveryPickup';

const SEARCH_BY = [
  ['order', 'Order no.'],
  ['phone', 'Phone'],
  ['name', 'Name'],
  ['awb', 'AWB'],
];
const FILTER_KEYS = ['q', 'from', 'to', 'carrier', 'pay', 'parcel', 'delayed', 'items', 'dup'];

const ago = (value, now) => {
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60000));
  if (minutes < 60) return minutes <= 1 ? 'Just now' : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
};
const timeFormat = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });
const shortDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const forwardOf = (order) => (order.shipments ?? []).find((s) => s.kind === 'forward' && s.status !== 'cancelled') ?? null;
// Only Xpressbees parcels go on its pickup manifest; Delhivery parcels are collected
// through a pickup request (Admin > Shipping).
// A label can be printed once the parcel is booked (it has an AWB).
const labelReady = (order) => Boolean(forwardOf(order)?.awb_number);
const manifestable = (order) => (order.shipments ?? []).some((s) => s.kind === 'forward' && s.carrier !== 'delhivery' && ['booked', 'in_transit'].includes(s.status));

function Summary({ data, onPick }) {
  const card = (key, value, label, filter, tone) => (
    <button key={key} type="button" className="ap-stat" data-tone={tone && value > 0 ? tone : undefined} onClick={() => onPick(filter)}>
      <span className="ap-stat-value">{formatCount(value)}</span>
      <span className="ap-stat-label">{label}</span>
    </button>
  );
  return (
    <div className="ap-stats ap-stats-flush">
      {card('total', data.total, 'Orders to ship', { stage: 'all' })}
      {card('print', data.stages.print ?? 0, 'To print', { stage: 'print' })}
      {card('pack', data.stages.pack ?? 0, 'To pack', { stage: 'pack' })}
      {card('handover', data.stages.handover ?? 0, 'To hand over', { stage: 'handover' })}
      {card('delayed', data.delayed, 'Delayed (not shipped in 2 days)', { stage: 'all', delayed: '1' }, 'warn')}
      <Link to="/admin/shipping" className="ap-stat" data-tone={data.problems > 0 ? 'warn' : undefined}>
        <span className="ap-stat-value">{formatCount(data.problems)}</span>
        <span className="ap-stat-label">Parcels needing attention</span>
      </Link>
    </div>
  );
}

function OrderRow({ order, view, tab, now, selectable, picked, customerOrders, working, onPick, onOpen, onStage, onLabel }) {
  const note = fulfilmentOf(order)?.note;
  const stage = tab === 'to_ship' ? stageOf(order) : null;
  const first = order.order_items[0];
  const more = order.order_items.length - 1;
  const total = Number(order.total ?? order.subtotal ?? 0);
  const cod = order.payment_method === 'cod';
  const toCollect = cod ? Math.max(0, total - Number(order.amount_paid ?? 0)) : 0;
  const parcel = forwardOf(order);
  const shipBy = shipByOf(order.created_at);
  const late = tab === 'to_ship' && shipBy.getTime() < now;
  const label = parcel && (parcel.needs_check && parcel.status === 'failed' ? ADMIN_SHIPMENT_LABELS.needs_check : (ADMIN_SHIPMENT_LABELS[parcel.status] ?? parcel.status));

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
        {tab === 'to_ship' && (
          <span className="ap-badge" data-tone={late ? 'danger' : 'ok'}>
            {late ? 'Delayed' : 'On time'}
          </span>
        )}
        {view === 'track' && <OrderStatus status={order.status} />}
        <button type="button" className="ap-order-link" onClick={() => onOpen(order.id)}>
          {formatOrderNumber(order.order_number)}
        </button>
        <span className="ap-cell-meta">
          {ago(order.created_at, now)} · {shortDate.format(new Date(order.created_at))}, {timeFormat.format(new Date(order.created_at))}
        </span>
        {order.is_test && <span className="ap-badge">Test order</span>}
        {note && (
          <span className="ap-note" title={note}>
            <NotePencil size={14} aria-label="Note" />
            <span className="ap-clamp">{note}</span>
          </span>
        )}
      </td>
      <td className="ap-col-book" data-label="Books">
        {first && (
          <div className="ap-book-cell">
            {first.image_url ? <img className="ap-thumb" src={first.image_url} alt="" width="44" height="60" loading="lazy" /> : <span className="ap-thumb ap-thumb-empty" aria-hidden="true" />}
            <span>
              <span className="ap-book-name ap-clamp">{first.title}</span>
              <span className="ap-book-sku">
                SKU {first.sku} · Qty {first.quantity}
              </span>
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
            <dt>Total</dt>
            <dd>{formatPrice(total)}</dd>
          </div>
          {Number(order.discount_total) > 0 && (
            <div>
              <dt>Discount</dt>
              <dd>{formatPrice(order.discount_total)}</dd>
            </div>
          )}
          {cod && (
            <div>
              <dt>To collect</dt>
              <dd>{formatPrice(toCollect)}</dd>
            </div>
          )}
        </dl>
      </td>
      <td className="ap-col-customer" data-label="Customer">
        <span className="ap-strong">{order.shipping_name}</span>
        <span className="ap-cell-meta tnum">
          {order.shipping_phone}{' '}
          {customerOrders != null &&
            (customerOrders >= 2 ? (
              <span className="ap-badge ap-badge-sm" data-tone="ok" title={`${customerOrders} orders from this number`}>
                Repeat · {customerOrders}
              </span>
            ) : (
              <span className="ap-badge ap-badge-sm">New</span>
            ))}
        </span>
        <span className="ap-cell-meta ap-clamp" title={`${order.shipping_address}, ${order.shipping_city}`}>
          {order.shipping_address}, {order.shipping_city}
        </span>
        <span className="ap-cell-meta">
          {order.shipping_state} {order.shipping_pincode}
        </span>
      </td>
      <td data-label="Parcel">
        {parcel ? (
          <>
            <span className="status" data-status={parcel.needs_check && parcel.status === 'failed' ? 'exception' : parcel.status}>
              {label}
            </span>
            <span className="ap-cell-meta">{parcel.courier_name ?? CARRIER_NAMES[carrierOf(parcel)]}</span>
            {parcel.awb_number && <span className="ap-cell-meta tnum">AWB {parcel.awb_number}</span>}
            {parcel.total_charges != null && <span className="ap-cell-meta">Charge {formatPrice(parcel.total_charges)}</span>}
          </>
        ) : (
          <span className="ap-cell-meta">No parcel yet</span>
        )}
      </td>
      {tab === 'to_ship' && (
        <td data-label="Ship by">
          <span className={late ? 'ap-strong ap-late' : 'ap-strong'}>{shortDate.format(shipBy)}</span>
        </td>
      )}
      <td className="ap-col-actions">
        <div className="ap-row-actions ap-row-actions-stack">
          {labelReady(order) && (
            <button type="button" className={`btn ${stage === 'print' || stage === null ? 'btn-dark' : 'btn-outline'} btn-sm`} aria-busy={working} onClick={() => onLabel(order)}>
              {working ? <span className="spinner" aria-hidden="true" /> : <Printer size={16} aria-hidden="true" />}
              Label
            </button>
          )}
          {stage === 'pack' && (
            <button type="button" className="btn btn-dark btn-sm" aria-busy={working} onClick={() => onStage([order.id], 'handover', 'Packed')}>
              {working && <span className="spinner" aria-hidden="true" />}
              Packed
            </button>
          )}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onOpen(order.id)}>
            Manage
          </button>
        </div>
      </td>
    </tr>
  );
}

// Process orders (orders still to ship) and Track orders (every order), ShopDeck-style:
// numbers at the top, tabs, filters, then one row per order. Each order opens in a side
// panel with its parcel and status actions.
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
  // Process orders > To ship is split into the packing steps; "all" shows every step.
  const stageParam = params.get('stage');
  const stage = tab === 'to_ship' && view === 'process' ? (STAGES.some(([value]) => value === stageParam) || stageParam === 'all' ? stageParam : 'print') : '';
  const filters = {
    view,
    tab,
    stage: stage === 'all' ? '' : stage,
    dup: tab === 'to_ship' && params.get('dup') === '1',
    searchBy,
    search: q,
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    carrier: CARRIER_NAMES[params.get('carrier')] ? params.get('carrier') : '',
    payment: ['cod', 'online'].includes(params.get('pay')) ? params.get('pay') : '',
    parcel: tab === 'to_ship' && ['unbooked', 'booked'].includes(params.get('parcel')) ? params.get('parcel') : '',
    delayed: tab === 'to_ship' && params.get('delayed') === '1',
    items: ['single', 'clubbed'].includes(params.get('items')) ? params.get('items') : '',
    sort: params.get('sort') === 'oldest' ? 'oldest' : 'newest',
    page,
  };
  const key = JSON.stringify(filters);
  const result = useAsync(() => adminListOrders(filters), [key]);
  const summary = useAsync(() => (view === 'process' ? adminOrderSummary() : Promise.resolve(null)), [view]);
  const orders = result.data?.orders ?? [];
  const total = result.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const [picked, setPicked] = useState(() => new Set());
  const [bulk, setBulk] = useState({ working: null, error: null });
  const [printOpen, setPrintOpen] = useState(false);
  const [rowWorking, setRowWorking] = useState(null);
  // Delhivery parcels just handed over: Delhivery collects only when asked.
  const [pickupFor, setPickupFor] = useState(0);
  const [openId, setOpenId] = useState(null);
  const { show } = useToast();
  // "Now" for ages and late badges: when the list arrived.
  const now = result.data?.at ?? 0;
  const openOrder = orders.find((o) => o.id === openId) ?? null;

  // Orders can be selected to print their documents; at Handover only booked parcels
  // (they go on the manifest). Unpaid and cancelled orders have nothing to print.
  const bulkStage = stage && stage !== 'all' ? stage : null;
  function selectable(order) {
    const parcel = forwardOf(order);
    if (bulkStage === 'handover') return parcel?.status === 'booked' && Boolean(parcel.awb_number);
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
    update({ tab: 'to_ship', ...filter }, { reset: true });
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

  // One order moved by its own row button (Label printed, Packed).
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

  const markPrinted = () =>
    runBulk('printed', async () => {
      const ids = chosen().filter(labelReady).map((o) => o.id);
      if (ids.length === 0) throw new Error('None of the selected orders has a booked parcel yet.');
      const n = await adminSetStage(ids, 'pack');
      show({ message: `${plural(n ?? 0, 'order')} moved to Pack` });
    });

  // Labels, invoices, packing slips or a picking list for some orders, as one PDF.
  // Printing labels at the Print step moves those orders to Pack (as on ShopDeck).
  async function printFor(kind, list) {
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

  // One order's document: the row's Label button, or the side panel's buttons.
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
  const printRowLabel = (order) => printOne('labels', order);

  // ShopDeck's "Move All to Handover": every order at Pack, not only this page.
  const moveAllToHandover = () =>
    runBulk('all-handover', async () => {
      const ids = await adminStageOrderIds('pack');
      if (ids.length === 0) return;
      const n = await adminSetStage(ids, 'handover');
      show({ message: `${plural(n ?? 0, 'order')} moved to Handover` });
    });

  const markPacked = () =>
    runBulk('packed', async () => {
      const n = await adminSetStage(chosen().map((o) => o.id), 'handover');
      show({ message: `${plural(n ?? 0, 'order')} moved to Handover` });
    });

  // Hand-over: the Xpressbees parcels go on one manifest (opened in a new tab, printed
  // and given to the courier with the parcels); Delhivery collects when asked, so its
  // pickup form opens for the Delhivery parcels.
  function handOver() {
    if (bulk.working) return;
    const list = chosen();
    const xb = list.filter((o) => carrierOf(forwardOf(o)) !== 'delhivery').map((o) => o.id);
    const dl = list.length - xb.length;
    const tab = xb.length ? window.open('about:blank', '_blank') : null;
    if (tab) tab.opener = null;
    return runBulk('handover', async () => {
      try {
        if (xb.length) {
          const { url } = await makeManifest(xb);
          if (tab) tab.location.href = url;
          else window.open(url, '_blank', 'noopener,noreferrer');
        }
      } catch (err) {
        tab?.close();
        throw err;
      }
      const n = await adminSetStage(list.map((o) => o.id), 'handed_over');
      show({ message: `${plural(n ?? 0, 'order')} handed over` });
      if (dl > 0) setPickupFor(dl);
    });
  }

  const openManifest = () =>
    runBulk('manifest', async () => {
      const { url } = await makeManifest(chosen().filter(manifestable).map((o) => o.id));
      window.open(url, '_blank', 'noopener,noreferrer');
    });

  const anyFilter = FILTER_KEYS.some((name) => params.get(name));
  const allPicked = pickable.length > 0 && pickable.every((o) => picked.has(o.id));
  const pickedCount = chosen().length;
  const manifestCount = chosen().filter(manifestable).length;
  const stageCounts = summary.data?.stages ?? {};

  return (
    <div className="stack-sm ap-orders-page">
      <PageHead title={title} />

      {view === 'process' && summary.data && <Summary data={summary.data} onPick={pickSummary} />}

      <div className="ap-underline-tabs" role="tablist" aria-label="Show orders">
        {tabs.map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => update({ tab: value, parcel: '', delayed: '', dup: '', stage: '' })}>
            {label}
          </button>
        ))}
      </div>

      <section className="ap-card" aria-label="Orders">
        {stage && (
          <div className="ap-stage-bar">
            <div className="ap-segment ap-segment-stage" role="group" aria-label="Packing step">
              {STAGES.map(([value, label]) => (
                <button key={value} type="button" aria-pressed={stage === value} onClick={() => update({ stage: value === 'print' ? '' : value })}>
                  {label}
                  {stageCounts[value] != null && <span className="ap-count">{formatCount(stageCounts[value])}</span>}
                </button>
              ))}
              <button type="button" aria-pressed={stage === 'all'} onClick={() => update({ stage: 'all' })}>
                All steps
              </button>
            </div>
            {stage === 'pack' && (stageCounts.pack ?? 0) > 0 && (
              <button type="button" className="btn btn-dark btn-sm" aria-busy={bulk.working === 'all-handover'} onClick={moveAllToHandover}>
                {bulk.working === 'all-handover' && <span className="spinner" aria-hidden="true" />}
                Move all to Handover
              </button>
            )}
          </div>
        )}
        <div className="ap-toolbar ap-toolbar-orders">
          <div className="ap-segment" role="group" aria-label="Books in the order">
            <button type="button" aria-pressed={!filters.items} onClick={() => update({ items: '' })}>
              All
            </button>
            <button type="button" aria-pressed={filters.items === 'single'} onClick={() => update({ items: 'single' })}>
              Single{result.data ? ` (${formatCount(result.data.single)})` : ''}
            </button>
            <button type="button" aria-pressed={filters.items === 'clubbed'} onClick={() => update({ items: 'clubbed' })}>
              Clubbed{result.data ? ` (${formatCount(result.data.clubbed)})` : ''}
            </button>
          </div>
          {tab === 'to_ship' && (
            <button type="button" className="chip" aria-pressed={filters.delayed} onClick={() => update({ delayed: filters.delayed ? '' : '1' })}>
              Delayed only
            </button>
          )}
          {tab === 'to_ship' && (
            <button type="button" className="chip" aria-pressed={filters.dup} onClick={() => update({ dup: filters.dup ? '' : '1' })}>
              Possible duplicates
            </button>
          )}
        </div>

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
              <MagnifyingGlass size={18} aria-hidden="true" />
              <label className="visually-hidden" htmlFor="orders-q">
                Search orders
              </label>
              <input
                id="orders-q"
                className="input input-sm"
                type="search"
                inputMode={searchBy === 'phone' || searchBy === 'order' ? 'numeric' : undefined}
                placeholder={{ order: 'Order number', phone: 'Mobile number', name: 'Customer name', awb: 'AWB number' }[searchBy]}
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="ap-date-range">
            <label className="visually-hidden" htmlFor="orders-from">
              Placed from
            </label>
            <input id="orders-from" className="input input-sm" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => update({ from: e.target.value })} />
            <span aria-hidden="true">to</span>
            <label className="visually-hidden" htmlFor="orders-to">
              Placed until
            </label>
            <input id="orders-to" className="input input-sm" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => update({ to: e.target.value })} />
          </div>
          <label className="visually-hidden" htmlFor="orders-carrier">
            Shipping partner
          </label>
          <select id="orders-carrier" className="select select-sm" value={filters.carrier} onChange={(e) => update({ carrier: e.target.value })}>
            <option value="">Any shipping partner</option>
            {Object.entries(CARRIER_NAMES).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
          <label className="visually-hidden" htmlFor="orders-pay">
            Payment
          </label>
          <select id="orders-pay" className="select select-sm" value={filters.payment} onChange={(e) => update({ pay: e.target.value })}>
            <option value="">Any payment</option>
            <option value="cod">Cash on delivery</option>
            <option value="online">Prepaid</option>
          </select>
          {tab === 'to_ship' && (
            <>
              <label className="visually-hidden" htmlFor="orders-parcel">
                Parcel
              </label>
              <select id="orders-parcel" className="select select-sm" value={filters.parcel} onChange={(e) => update({ parcel: e.target.value })}>
                <option value="">Any parcel state</option>
                <option value="unbooked">Not booked yet</option>
                <option value="booked">Booked, waiting for pickup</option>
              </select>
            </>
          )}
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

        {pickedCount > 0 && (
          <div className="ap-bulkbar">
            <p>{plural(pickedCount, 'order')} selected</p>
            <div className="inline-actions">
              <div className="ap-menu">
                <button
                  type="button"
                  className="btn btn-dark btn-sm"
                  aria-expanded={printOpen}
                  aria-busy={String(bulk.working).startsWith('print-')}
                  onClick={() => setPrintOpen((open) => !open)}
                >
                  {String(bulk.working).startsWith('print-') ? <span className="spinner" aria-hidden="true" /> : <Printer size={16} aria-hidden="true" />}
                  Print
                  <CaretDown size={14} aria-hidden="true" />
                </button>
                {printOpen && (
                  <div className="ap-menu-list" role="group" aria-label="Print for the selected orders">
                    {[
                      ['labels', 'Labels'],
                      ['invoices', 'Invoices'],
                      ['slips', 'Packing slips'],
                      ['picklist', 'Picking list'],
                    ].map(([kind, label]) => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => {
                          setPrintOpen(false);
                          printSelected(kind);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {bulkStage === 'print' && (
                <button type="button" className="btn btn-outline btn-sm" aria-busy={bulk.working === 'printed'} onClick={markPrinted}>
                  {bulk.working === 'printed' && <span className="spinner" aria-hidden="true" />}
                  Labels printed: move to Pack
                </button>
              )}
              {bulkStage === 'pack' && (
                <button type="button" className="btn btn-dark btn-sm" aria-busy={bulk.working === 'packed'} onClick={markPacked}>
                  {bulk.working === 'packed' && <span className="spinner" aria-hidden="true" />}
                  Packed: move to Handover
                </button>
              )}
              {bulkStage === 'handover' && (
                <button type="button" className="btn btn-dark btn-sm" aria-busy={bulk.working === 'handover'} onClick={handOver}>
                  {bulk.working === 'handover' && <span className="spinner" aria-hidden="true" />}
                  Hand over {plural(pickedCount, 'parcel')}
                </button>
              )}
              {(!bulkStage || bulkStage === 'handed_over') && manifestCount > 0 && (
                <button type="button" className="btn btn-outline btn-sm" aria-busy={bulk.working === 'manifest'} onClick={openManifest}>
                  {bulk.working === 'manifest' && <span className="spinner" aria-hidden="true" />}
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

        {orders.length > 0 && (
          <div className="ap-table-wrap">
            <table className="ap-table ap-orders-table">
              <thead>
                <tr>
                  <th className="ap-col-pick">
                    {pickable.length > 0 && (
                      <label className="pick">
                        <input
                          type="checkbox"
                          checked={allPicked}
                          onChange={() => setPicked(allPicked ? new Set() : new Set(pickable.map((o) => o.id)))}
                        />
                        <span className="visually-hidden">Select every order on this page</span>
                      </label>
                    )}
                  </th>
                  <th>
                    <button type="button" className="ap-sort" onClick={() => update({ sort: filters.sort === 'oldest' ? '' : 'oldest' })}>
                      Orders <span className="ap-count">{formatCount(total)}</span>
                      {filters.sort === 'oldest' ? <ArrowUp size={14} aria-label="oldest first" /> : <ArrowDown size={14} aria-label="newest first" />}
                    </button>
                  </th>
                  <th>Books</th>
                  <th>Payment</th>
                  <th>Customer</th>
                  <th>Parcel</th>
                  {tab === 'to_ship' && <th>Ship by</th>}
                  <th>
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    view={view}
                    tab={tab}
                    now={now}
                    selectable={selectable(order)}
                    picked={picked.has(order.id)}
                    customerOrders={result.data.customerOrders?.[order.shipping_phone]}
                    working={rowWorking === order.id}
                    onPick={togglePick}
                    onOpen={setOpenId}
                    onStage={moveRow}
                    onLabel={printRowLabel}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {result.data && total > 0 && (
          <div className="ap-pager">
            <span className="page-meta" aria-live="polite">
              {plural(total, 'order')}
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

      <OrderDrawer order={openOrder} onClose={() => setOpenId(null)} onChanged={changed} onPrint={printOne} printing={rowWorking === openId} />
    </div>
  );
}

export default AdminOrders;
