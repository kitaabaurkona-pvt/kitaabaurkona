import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminErrorMessage, adminListReturns, adminReceiveReturn, adminSetOrderStatus, fulfilmentOf } from '../../services/adminService';
import { ADMIN_SHIPMENT_LABELS, CARRIER_NAMES, carrierOf } from '../../services/shippingService';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../hooks/useToast';
import { formatDate, formatOrderNumber, plural } from '../../utils/format';
import { LoadError, StateBlock } from '../../components/store/States';
import { LinesSkeleton } from '../../components/store/Skeletons';
import PageHead from '../../components/admin/PageHead';

const parcelOf = (order, kind) => (order.shipments ?? []).find((s) => s.kind === kind && s.status !== 'cancelled') ?? null;

// One parcel coming back, with its "Received back" action (asked twice: it changes stock).
function ReturnRow({ order, kind, onDone }) {
  const [confirm, setConfirm] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const { show } = useToast();
  const parcel = parcelOf(order, kind);
  const copies = order.order_items.reduce((s, i) => s + i.quantity, 0);
  const done = kind === 'forward' ? order.status === 'cancelled' : Boolean(fulfilmentOf(order)?.return_received_at);

  async function receive() {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      if (kind === 'forward') await adminSetOrderStatus(order.id, 'cancelled');
      else await adminReceiveReturn(order.id);
      show({ message: `${formatOrderNumber(order.order_number)}: ${plural(copies, 'book')} back in stock` });
      onDone();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setWorking(false);
      setConfirm(false);
    }
  }

  return (
    <tr>
      <td className="ap-col-order" data-label="Order">
        <Link className="ap-order-link" to={`/admin/orders/track?q=${order.order_number}`}>
          {formatOrderNumber(order.order_number)}
        </Link>
        <span className="ap-cell-meta">Placed {formatDate(order.created_at)}</span>
      </td>
      <td className="ap-col-customer" data-label="Customer">
        <span className="ap-strong">{order.shipping_name}</span>
        <span className="ap-cell-meta">
          {order.shipping_city}, {order.shipping_state}
        </span>
      </td>
      <td data-label="Books">
        <span className="ap-strong">{plural(copies, 'book')}</span>
        <span className="ap-cell-meta ap-clamp">{order.order_items.map((i) => i.title).join(', ')}</span>
      </td>
      <td data-label="Parcel">
        {parcel && (
          <>
            <span className="status" data-status={parcel.status}>
              {ADMIN_SHIPMENT_LABELS[parcel.status] ?? parcel.status}
            </span>
            <span className="ap-cell-meta">
              {CARRIER_NAMES[carrierOf(parcel)]}
              {parcel.awb_number && ` · AWB ${parcel.awb_number}`}
            </span>
          </>
        )}
      </td>
      <td className="ap-col-actions">
        {done ? (
          <span className="ap-badge" data-tone="ok">
            Received back
          </span>
        ) : (
          <div className="ap-row-actions ap-row-actions-stack">
            {!confirm && (
              <button type="button" className="btn btn-dark btn-sm" onClick={() => setConfirm(true)}>
                Received back
              </button>
            )}
            {confirm && (
              <>
                <button type="button" className="btn btn-dark btn-sm" aria-busy={working} onClick={receive}>
                  {working && <span className="spinner" aria-hidden="true" />}
                  Yes, add {plural(copies, 'book')} to stock
                </button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirm(false)}>
                  Not yet
                </button>
              </>
            )}
          </div>
        )}
        {error && (
          <p className="notice" data-tone="error" role="alert">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}

function ReturnTable({ id, title, orders, kind, onDone, empty }) {
  return (
    <section className="ap-card" aria-labelledby={id}>
      <div className="ap-card-head">
        <h2 id={id} className="ap-card-title">
          {title}
        </h2>
      </div>
      {orders.length === 0 ? (
        <div className="ap-card-body">
          <StateBlock title={empty} />
        </div>
      ) : (
        <div className="ap-table-wrap">
          <table className="ap-table ap-orders-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Books</th>
                <th>Parcel</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <ReturnRow key={order.id} order={order} kind={kind} onDone={onDone} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ShopDeck's "RTO & Returns": parcels coming back to the shop. "Received back" puts the
// books into stock: an RTO cancels its order, a customer return keeps its order
// Delivered.
function AdminReturns() {
  useDocumentTitle('Returns');
  const result = useAsync(() => adminListReturns(), []);
  const orders = result.data ?? [];
  const rto = orders.filter((o) => parcelOf(o, 'forward')?.status === 'rto');
  const returns = orders.filter((o) => parcelOf(o, 'reverse'));

  return (
    <div className="stack ap-orders-page">
      <PageHead title="Returns" />
      {result.loading && !result.data && <LinesSkeleton count={3} label="Loading returns…" />}
      {result.error && <LoadError onRetry={result.retry} what="returns" />}
      {result.data && (
        <>
          <ReturnTable id="rto-heading" title="Not delivered, coming back (RTO)" orders={rto} kind="forward" onDone={result.retry} empty="No parcels are coming back." />
          <ReturnTable id="returns-heading" title="Customer returns" orders={returns} kind="reverse" onDone={result.retry} empty="No customer returns." />
        </>
      )}
    </div>
  );
}

export default AdminReturns;
