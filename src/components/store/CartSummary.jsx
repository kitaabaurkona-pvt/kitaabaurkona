import { formatPrice } from '../../utils/format';

function CartSummary({ totals, title = 'Order summary', children }) {
  const discount = totals.mrp - totals.subtotal;
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
            <dt>Total</dt>
            <dd>{formatPrice(totals.subtotal)}</dd>
          </div>
        </dl>
        {children}
      </div>
    </section>
  );
}

export default CartSummary;
