import { formatPrice } from '../../utils/format';

// totals: { count, mrp, subtotal } and, for a placed order whose total differs from the
// books subtotal (a discount or charge added at checkout), { offer, charges, total }.
function CartSummary({ totals, title = 'Order summary', children }) {
  const discount = totals.mrp - totals.subtotal;
  const adjusted = totals.total !== undefined && Number(totals.total) !== Number(totals.subtotal);
  return (
    <section className="summary" aria-labelledby="summary-heading">
      <h2 id="summary-heading" className="summary-head">
        {title}
      </h2>
      <div className="summary-body">
        <dl className="summary-rows">
          <div>
            <dt>Items</dt>
            <dd>{totals.count}</dd>
          </div>
          <div>
            <dt>Total MRP</dt>
            <dd>{formatPrice(totals.mrp)}</dd>
          </div>
          {discount > 0 && (
            <div>
              <dt>Discount</dt>
              <dd className="saving">−{formatPrice(discount)}</dd>
            </div>
          )}
          <div className="summary-total">
            <dt>Books subtotal</dt>
            <dd>{formatPrice(totals.subtotal)}</dd>
          </div>
          {adjusted && totals.offer > 0 && (
            <div>
              <dt>Offer discount</dt>
              <dd className="saving">−{formatPrice(totals.offer)}</dd>
            </div>
          )}
          {adjusted && totals.charges > 0 && (
            <div>
              <dt>Other charges</dt>
              <dd>{formatPrice(totals.charges)}</dd>
            </div>
          )}
          {adjusted && (
            <div className="summary-total">
              <dt>Order total</dt>
              <dd>{formatPrice(totals.total)}</dd>
            </div>
          )}
        </dl>
        {children}
      </div>
    </section>
  );
}

export default CartSummary;
