import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, MagnifyingGlass } from '@phosphor-icons/react';
import {
  ADMIN_PAGE_SIZE,
  adminListOrders,
  adminOrderSummary,
  ORDER_TABS,
  shipByOf,
} from '../../services/adminService';
import { ADMIN_SHIPMENT_LABELS, CARRIER_NAMES, carrierOf, hasLabel, makeManifest } from '../../services/shippingService';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { formatCount, formatOrderNumber, formatPrice, plural } from '../../utils/format';
import OrderStatus from '../../components/store/OrderStatus';
import { LoadError, StateBlock } from '../../components/store/States';
import { LinesSkeleton } from '../../components/store/Skeletons';
import PageHead from '../../components/admin/PageHead';
import OrderDrawer from '../../components/admin/OrderDrawer';
import LabelButton from '../../components/admin/LabelButton';

const SEARCH_BY = [
  ['order', 'Order no.'],
  ['phone', 'Phone'],
  ['name', 'Name'],
  ['awb', 'AWB'],
];
const FILTER_KEYS = ['q', 'from', 'to', 'carrier', 'pay', 'parcel', 'delayed', 'items'];

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
      {card('total', data.total, 'Orders to ship', {})}
      {card('unbooked', data.unbooked, 'Parcels not booked yet', { parcel: 'unbooked' })}
      {card('booked', data.booked, 'Booked, waiting for pickup', { parcel: 'booked' })}
      {card('delayed', data.delayed, 'Delayed (not shipped in 2 days)', { delayed: '1' }, 'warn')}
      <Link to="/admin/shipping" className="ap-stat" data-tone={data.problems > 0 ? 'warn' : undefined}>
        <span className="ap-stat-value">{formatCount(data.problems)}</span>
        <span className="ap-stat-label">Parcels needing attention</span>
      </Link>
    </div>
  );
}

function OrderRow({ order, view, tab, now, picked, onPick, onOpen }) {
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
        {manifestable(order) && (
          <label className="pick">
            <input type="checkbox" checked={picked} onChange={() => onPick(order.id)} />
            <span className="visually-hidden">Add {formatOrderNumber(order.order_number)} to the manifest</span>
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
        <span className="ap-cell-meta tnum">{order.shipping_phone}</span>
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
          {hasLabel(parcel) && <LabelButton order={order} shipment={parcel} />}
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
  const filters = {
    view,
    tab,
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
  const [manifest, setManifest] = useState({ working: false, error: null });
  const [openId, setOpenId] = useState(null);
  // "Now" for ages and late badges: when the list arrived.
  const now = result.data?.at ?? 0;
  const openOrder = orders.find((o) => o.id === openId) ?? null;
  const pickable = orders.filter(manifestable);

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

  async function openManifest() {
    if (manifest.working || picked.size === 0) return;
    setManifest({ working: true, error: null });
    try {
      const { url } = await makeManifest([...picked]);
      window.open(url, '_blank', 'noopener,noreferrer');
      setManifest({ working: false, error: null });
    } catch (err) {
      setManifest({ working: false, error: err.message });
    }
  }

  function changed() {
    result.retry();
    summary.retry();
  }

  const anyFilter = FILTER_KEYS.some((name) => params.get(name));
  const allPicked = pickable.length > 0 && pickable.every((o) => picked.has(o.id));

  return (
    <div className="stack-sm ap-orders-page">
      <PageHead title={title} />

      {view === 'process' && summary.data && <Summary data={summary.data} onPick={pickSummary} />}

      <div className="ap-underline-tabs" role="tablist" aria-label="Show orders">
        {tabs.map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => update({ tab: value, parcel: '', delayed: '' })}>
            {label}
          </button>
        ))}
      </div>

      <section className="ap-card" aria-label="Orders">
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

        {picked.size > 0 && (
          <div className="ap-bulkbar">
            <p>{plural(picked.size, 'order')} selected</p>
            <div className="inline-actions">
              <button type="button" className="btn btn-dark btn-sm" aria-busy={manifest.working} onClick={openManifest}>
                {manifest.working && <span className="spinner" aria-hidden="true" />}
                Xpressbees manifest for {plural(picked.size, 'order')}
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setPicked(new Set())}>
                Clear selection
              </button>
            </div>
          </div>
        )}
        {manifest.error && (
          <p className="notice ap-card-notice" data-tone="error" role="alert">
            {manifest.error}
          </p>
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
                        <span className="visually-hidden">Select every order on this page that can go on the manifest</span>
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
                  <OrderRow key={order.id} order={order} view={view} tab={tab} now={now} picked={picked.has(order.id)} onPick={togglePick} onOpen={setOpenId} />
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

      <OrderDrawer order={openOrder} onClose={() => setOpenId(null)} onChanged={changed} />
    </div>
  );
}

export default AdminOrders;
