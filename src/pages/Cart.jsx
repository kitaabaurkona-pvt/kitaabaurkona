import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { useCartLines } from '../hooks/useCartLines';
import CartSummary from '../components/store/CartSummary';
import CartLine from '../components/cart/CartLine';
import { useCart } from '../hooks/useCart';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { plural } from '../utils/format';
import { LoadError, StateBlock } from '../components/store/States';
import { LinesSkeleton } from '../components/store/Skeletons';
import { BagIcon } from '../components/icons';

function Cart() {
  useDocumentTitle('Cart');
  const { ids } = useCart();
  const { lines, totals, blocked, data, loading, error, retry } = useCartLines();

  // Re-read prices and stock whenever the cart page is opened.
  useEffect(() => {
    retry();
  }, [retry]);

  return (
    <div className="container page">
      <div className="page-head">
        <h1 className="page-title">Cart</h1>
        {ids.length > 0 && <p className="page-meta">{plural(totals.count, 'item')}</p>}
      </div>

      {ids.length === 0 && (
        <StateBlock title="Your cart is empty." icon={BagIcon}>
          <Link to="/books" className="btn btn-dark">
            Browse books
          </Link>
        </StateBlock>
      )}
      {ids.length > 0 && loading && !data && <LinesSkeleton count={Math.min(ids.length, 4)} label="Loading your cart…" />}
      {ids.length > 0 && error && <LoadError onRetry={retry} what="your cart" />}
      {ids.length > 0 && data && (
        <div className="two-col">
          <ul className="line-list">
            <AnimatePresence initial={false}>
              {lines.map((line) => (
                <CartLine key={line.id} line={line} />
              ))}
            </AnimatePresence>
          </ul>
          <aside>
            <CartSummary totals={totals}>
              {blocked && (
                <p className="notice" data-tone="error" role="alert">
                  Remove the books that are no longer available to continue.
                </p>
              )}
              {blocked || totals.count === 0 ? (
                <button type="button" className="btn btn-primary btn-block" aria-disabled="true">
                  Proceed to checkout
                </button>
              ) : (
                <Link to="/checkout" className="btn btn-primary btn-block">
                  Proceed to checkout
                </Link>
              )}
              <Link to="/books" className="btn btn-outline btn-block">
                Continue shopping
              </Link>
            </CartSummary>
          </aside>
        </div>
      )}
    </div>
  );
}

export default Cart;
