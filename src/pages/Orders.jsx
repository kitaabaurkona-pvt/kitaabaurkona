import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listOrders } from '../services/orderService';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatDate, formatOrderNumber, formatPrice, ORDER_STATUS_LABELS, plural } from '../utils/format';
import BookCover from '../components/store/BookCover';
import { LoadError, StateBlock } from '../components/store/States';
import { LinesSkeleton } from '../components/store/Skeletons';
import OrderStatus from '../components/store/OrderStatus';
import { ReceiptIcon } from '../components/icons';

function Orders() {
  useDocumentTitle('Orders');
  const { data: orders, loading, error, retry } = useAsync(() => listOrders(), []);
  const [filter, setFilter] = useState('all');

  const present = orders ? Object.keys(ORDER_STATUS_LABELS).filter((s) => orders.some((o) => o.status === s)) : [];
  const shown = orders ? orders.filter((o) => filter === 'all' || o.status === filter) : [];

  return (
    <div className="container page">
      <div className="page-head">
        <h1 className="page-title">Orders</h1>
        {orders && orders.length > 0 && <p className="page-meta">{plural(orders.length, 'order')}</p>}
      </div>

      {loading && <LinesSkeleton label="Loading your orders…" />}
      {error && <LoadError onRetry={retry} what="your orders" />}
      {orders && orders.length === 0 && (
        <StateBlock title="You haven't placed any orders yet." icon={ReceiptIcon}>
          <Link to="/books" className="btn btn-dark">
            Browse books
          </Link>
        </StateBlock>
      )}

      {orders && orders.length > 0 && (
        <>
          {present.length > 1 && (
            <div className="chip-scroll filter-row" role="group" aria-label="Filter orders">
              <button type="button" className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                All
              </button>
              {present.map((status) => (
                <button key={status} type="button" className="chip" aria-pressed={filter === status} onClick={() => setFilter(status)}>
                  {ORDER_STATUS_LABELS[status]}
                </button>
              ))}
            </div>
          )}
          {shown.map((order) => (
            <article key={order.id} className="order-card">
              <div className="order-card-head">
                <div>
                  <h2 className="order-number">{formatOrderNumber(order.order_number)}</h2>
                  <p className="page-meta">Placed {formatDate(order.created_at)}</p>
                </div>
                <OrderStatus status={order.status} />
              </div>
              <div className="order-card-body">
                <ul className="order-thumbs" aria-hidden="true">
                  {order.order_items.slice(0, 5).map((item) => (
                    <li key={item.sku}>
                      <BookCover src={item.image_url} title={item.title} />
                    </li>
                  ))}
                </ul>
                <div className="order-total-row">
                  <span className="page-meta">{plural(order.item_count, 'item')}</span>
                  <span className="price">{formatPrice(order.subtotal)}</span>
                </div>
                <div className="inline-actions">
                  <Link to={`/orders/${order.id}`} className="btn btn-outline btn-sm">
                    View order
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </>
      )}
    </div>
  );
}

export default Orders;
