import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminErrorMessage, adminListOrders, adminSetOrderStatus, ADMIN_PAGE_SIZE, NEXT_STATUSES } from '../../services/adminService';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../hooks/useToast';
import { formatDate, formatOrderNumber, formatPrice, ORDER_STATUS_LABELS, plural } from '../../utils/format';
import OrderStatus from '../../components/store/OrderStatus';
import { LoadError, StateBlock } from '../../components/store/States';
import { LinesSkeleton } from '../../components/store/Skeletons';
import ParcelPanel from '../../components/admin/ParcelPanel';
import { makeManifest } from '../../services/shippingService';

const ACTION_LABELS = {
  paid: 'Mark paid',
  shipped: 'Mark shipped',
  delivered: 'Mark delivered',
  cancelled: 'Cancel order',
};

function OrderActions({ order, onChanged }) {
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
          <button type="button" className="btn btn-danger btn-sm" aria-disabled={Boolean(working) || undefined} onClick={() => !working && setConfirmCancel(true)}>
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

function AdminOrders() {
  useDocumentTitle('Admin orders');
  const [params, setParams] = useSearchParams();
  const status = ORDER_STATUS_LABELS[params.get('status')] ? params.get('status') : 'all';
  const [page, setPage] = useState(0);
  const result = useAsync(() => adminListOrders({ status, page }), [status, page]);
  const orders = result.data?.orders ?? [];
  const total = result.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const [picked, setPicked] = useState(() => new Set());
  const [manifest, setManifest] = useState({ working: false, error: null });
  const bookedForward = (order) => (order.shipments ?? []).some((sh) => sh.kind === 'forward' && ['booked', 'in_transit'].includes(sh.status));

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

  function setStatus(value) {
    setParams(value === 'all' ? {} : { status: value }, { replace: true });
    setPage(0);
  }

  return (
    <div className="stack-sm">
      <div className="chip-scroll" role="group" aria-label="Filter orders">
        <button type="button" className="chip" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>All</button>
        {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
          <button key={value} type="button" className="chip" aria-pressed={status === value} onClick={() => setStatus(value)}>
            {label}
          </button>
        ))}
      </div>

      {result.data && <p className="page-meta" aria-live="polite">{plural(total, 'order')}</p>}
      {picked.size > 0 && (
        <div className="inline-actions">
          <button type="button" className="btn btn-dark btn-sm" aria-busy={manifest.working} onClick={openManifest}>
            {manifest.working && <span className="spinner" aria-hidden="true" />}
            Pickup manifest for {plural(picked.size, 'order')}
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setPicked(new Set())}>
            Clear selection
          </button>
        </div>
      )}
      {manifest.error && (
        <p className="notice" data-tone="error" role="alert">
          {manifest.error}
        </p>
      )}
      {result.loading && !result.data && <LinesSkeleton count={3} label="Loading orders…" />}
      {result.error && <LoadError onRetry={result.retry} what="orders" />}
      {result.data && orders.length === 0 && <StateBlock title="No orders here yet." />}

      {orders.map((order) => (
        <article key={order.id} className="order-card">
          <div className="order-card-head">
            <div>
              <h2 className="order-number">{formatOrderNumber(order.order_number)}</h2>
              <p className="page-meta">Placed {formatDate(order.created_at)}</p>
            </div>
            <div className="inline-actions">
              {bookedForward(order) && (
                <label className="pick">
                  <input type="checkbox" checked={picked.has(order.id)} onChange={() => togglePick(order.id)} />
                  <span>Add to manifest</span>
                </label>
              )}
              <OrderStatus status={order.status} />
            </div>
          </div>
          <div className="order-card-body">
            <ul className="admin-items">
              {order.order_items.map((item) => (
                <li key={item.sku}>
                  <span>{item.title} × {item.quantity}</span>
                  <span className="tnum">{formatPrice(Number(item.unit_price) * item.quantity)}</span>
                </li>
              ))}
            </ul>
            <div className="order-total-row">
              <span className="page-meta">{plural(order.item_count, 'item')}</span>
              <span className="price">{formatPrice(order.subtotal)}</span>
            </div>
            <address className="address">
              {order.shipping_name}, {order.shipping_phone}
              <br />
              {order.shipping_address}, {order.shipping_city}, {order.shipping_state} {order.shipping_pincode}
            </address>
            <ParcelPanel order={order} onChanged={result.retry} />
            <OrderActions order={order} onChanged={result.retry} />
          </div>
        </article>
      ))}

      {pages > 1 && (
        <div className="inline-actions pager">
          <button type="button" className="btn btn-outline btn-sm" aria-disabled={page === 0 || undefined} onClick={() => page > 0 && setPage(page - 1)}>Previous</button>
          <span className="page-meta">Page {page + 1} of {pages}</span>
          <button type="button" className="btn btn-outline btn-sm" aria-disabled={page >= pages - 1 || undefined} onClick={() => page < pages - 1 && setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

export default AdminOrders;
