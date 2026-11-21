import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import { adminErrorMessage, adminSetOrderStatus, NEXT_STATUSES } from '../../services/adminService';
import { useToast } from '../../hooks/useToast';
import { formatDate, formatOrderNumber, formatPrice, ORDER_STATUS_LABELS, plural } from '../../utils/format';
import OrderStatus from '../store/OrderStatus';
import ParcelPanel from './ParcelPanel';

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

// Everything about one order, in a panel that slides in from the right: the books, the
// money, the address, the parcel (carrier, courier, booking, label) and status changes.
function OrderDrawer({ order, onClose, onChanged }) {
  const total = Number(order?.total ?? order?.subtotal ?? 0);
  const toCollect = order?.payment_method === 'cod' ? Math.max(0, total - Number(order.amount_paid ?? 0)) : 0;

  return (
    <Dialog.Root open={Boolean(order)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ap-drawer-overlay" />
        {order && (
          <Dialog.Content className="ap-sheet ap" aria-describedby={undefined}>
            <div className="ap-sheet-head">
              <div>
                <Dialog.Title className="ap-sheet-title">{formatOrderNumber(order.order_number)}</Dialog.Title>
                <p className="page-meta">
                  Placed {formatDate(order.created_at)}
                  {order.is_test && ' · GoKwik sandbox test order (not shipped)'}
                </p>
              </div>
              <div className="inline-actions">
                <OrderStatus status={order.status} />
                <Dialog.Close asChild>
                  <button type="button" className="ap-icon-button" aria-label="Close order">
                    <X size={22} aria-hidden="true" />
                  </button>
                </Dialog.Close>
              </div>
            </div>

            <div className="ap-sheet-body">
              <section className="ap-sheet-section" aria-labelledby="sheet-books">
                <h3 id="sheet-books">{plural(order.item_count, 'book')}</h3>
                <ul className="admin-items">
                  {order.order_items.map((item) => (
                    <li key={item.sku}>
                      <span>
                        {item.title} × {item.quantity}
                        <span className="ap-book-sku">SKU {item.sku}</span>
                      </span>
                      <span className="tnum">{formatPrice(Number(item.unit_price) * item.quantity)}</span>
                    </li>
                  ))}
                </ul>
                <dl className="ap-sums">
                  {Number(order.discount_total) > 0 && (
                    <div>
                      <dt>Discount</dt>
                      <dd>−{formatPrice(order.discount_total)}</dd>
                    </div>
                  )}
                  {Number(order.other_charges) > 0 && (
                    <div>
                      <dt>Other charges</dt>
                      <dd>{formatPrice(order.other_charges)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Order total</dt>
                    <dd>{formatPrice(total)}</dd>
                  </div>
                  <div>
                    <dt>{order.payment_method === 'cod' ? 'Cash to collect' : 'Paid online'}</dt>
                    <dd>{formatPrice(order.payment_method === 'cod' ? toCollect : total)}</dd>
                  </div>
                </dl>
              </section>

              <section className="ap-sheet-section" aria-labelledby="sheet-address">
                <h3 id="sheet-address">Customer</h3>
                <address className="address">
                  {order.shipping_name}, {order.shipping_phone}
                  <br />
                  {order.shipping_address}, {order.shipping_city}, {order.shipping_state} {order.shipping_pincode}
                </address>
              </section>

              <section className="ap-sheet-section" aria-labelledby="sheet-parcel">
                <h3 id="sheet-parcel">Parcel</h3>
                <ParcelPanel order={order} onChanged={onChanged} />
                {!(order.shipments ?? []).length && <p className="page-meta">No parcel yet.</p>}
              </section>

              <section className="ap-sheet-section" aria-labelledby="sheet-status">
                <h3 id="sheet-status">Order status</h3>
                <OrderActions order={order} onChanged={onChanged} />
                {(NEXT_STATUSES[order.status] ?? []).length === 0 && <p className="page-meta">Nothing left to change.</p>}
              </section>
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default OrderDrawer;
