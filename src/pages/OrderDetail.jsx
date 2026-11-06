import { useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { cancelOrder, getOrder } from '../services/orderService';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatDate, formatOrderNumber, formatPrice } from '../utils/format';
import BookCover from '../components/store/BookCover';
import CartSummary from '../components/store/CartSummary';
import OrderStatus from '../components/store/OrderStatus';
import { LoadError, Loading, StateBlock } from '../components/store/States';

function CancelOrder({ orderId, onCancelled }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  async function confirm() {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setFailed(false);
    try {
      await cancelOrder(orderId);
      onCancelled();
    } catch {
      setFailed(true);
      setConfirming(false);
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  return (
    <div className="stack-sm">
      {!confirming ? (
        <button type="button" className="btn btn-danger btn-block" onClick={() => setConfirming(true)}>
          Cancel order
        </button>
      ) : (
        <div className="stack-sm" role="group" aria-label="Confirm cancellation">
          <p className="notice">Cancel this order? This can't be undone.</p>
          <div className="inline-actions">
            <button type="button" className="btn btn-danger" aria-busy={working} aria-disabled={working || undefined} onClick={confirm}>
              {working && <span className="spinner" aria-hidden="true" />}
              {working ? 'Cancelling…' : 'Yes, cancel order'}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setConfirming(false)}>
              Keep order
            </button>
          </div>
        </div>
      )}
      {failed && (
        <p className="notice" data-tone="error" role="alert">
          This order could not be cancelled. Refresh the page to see its current status.
        </p>
      )}
    </div>
  );
}

function OrderDetail() {
  const { id } = useParams();
  const location = useLocation();
  const { data: order, loading, error, retry } = useAsync(() => getOrder(id), [id]);
  useDocumentTitle(order ? formatOrderNumber(order.order_number) : 'Order');

  if (loading && !order) {
    return (
      <div className="container page">
        <Loading label="Loading order…" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="container page">
        <LoadError onRetry={retry} what="this order" />
      </div>
    );
  }
  if (!order) {
    return (
      <div className="container page">
        <StateBlock title="This order could not be found.">
          <Link to="/orders" className="btn btn-dark">
            View your orders
          </Link>
        </StateBlock>
      </div>
    );
  }

  const totals = { count: order.item_count, subtotal: Number(order.subtotal), mrp: Number(order.mrp_total) };
  const pending = order.status === 'pending_payment';

  return (
    <div className="container page">
      <nav aria-label="Breadcrumb">
        <ol className="breadcrumb">
          <li>
            <Link to="/orders">Orders</Link>
          </li>
          <li aria-current="page">{formatOrderNumber(order.order_number)}</li>
        </ol>
      </nav>
      <div className="page-head">
        <div>
          <h1 className="page-title">{formatOrderNumber(order.order_number)}</h1>
          <p className="page-meta">Placed {formatDate(order.created_at)}</p>
        </div>
        <OrderStatus status={order.status} />
      </div>

      {location.state?.placed && pending && (
        <p className="notice notice-gap" data-tone="ok" role="status">
          Order placed. It is saved and awaiting payment.
        </p>
      )}

      <div className="two-col">
        <div className="stack">
          <ul className="line-list">
            {order.order_items.map((item) => (
              <li key={item.sku} className="line">
                <div className="line-cover">
                  <BookCover src={item.image_url} title={item.title} />
                </div>
                <div className="line-body">
                  <h2 className="line-title">
                    {item.book_id ? <Link to={`/books/${item.book_id}`}>{item.title}</Link> : item.title}
                  </h2>
                  <div className="order-total-row">
                    <span className="page-meta">
                      {formatPrice(item.unit_price)} × {item.quantity}
                    </span>
                    <span className="line-total">{formatPrice(Number(item.unit_price) * item.quantity)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <section className="panel" aria-labelledby="address-heading">
            <h2 id="address-heading" className="panel-title">
              Delivery address
            </h2>
            <address className="address">
              {order.shipping_name}
              <br />
              {order.shipping_address}
              <br />
              {order.shipping_city}, {order.shipping_state} {order.shipping_pincode}
              <br />
              Mobile {order.shipping_phone}
            </address>
          </section>
        </div>

        <aside className="stack-sm">
          <CartSummary totals={totals} title="Payment summary">
            {pending && (
              <div className="payment-placeholder">
                <p>Online payment is not connected yet.</p>
                <p>This order is waiting for payment.</p>
              </div>
            )}
            {pending && <CancelOrder orderId={order.id} onCancelled={retry} />}
          </CartSummary>
          <Link to="/orders" className="btn btn-outline btn-block">
            All orders
          </Link>
        </aside>
      </div>
    </div>
  );
}

export default OrderDetail;
