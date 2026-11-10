import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
import { previousPage } from '../hooks/useScrollMemory';

function Cart() {
  useDocumentTitle('Cart');
  const { ids } = useCart();
  const { lines, totals, blocked, pending, data, loading, error, retry } = useCartLines();
  const navigate = useNavigate();
  const { key } = useLocation();
  // Opened from a page in the store: go back to it, at the same spot, instead of
  // starting the book list again from the top.
  const from = previousPage(key);
  const canGoBack = Boolean(from) && from !== '/checkout';

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
              {blocked || pending || totals.count === 0 ? (
                <button type="button" className="btn btn-primary btn-block" aria-disabled="true">
                  Proceed to checkout
                </button>
              ) : (
                <Link to="/checkout" className="btn btn-primary btn-block">
                  Proceed to checkout
                </Link>
              )}
              {canGoBack ? (
                <button type="button" className="btn btn-outline btn-block" onClick={() => navigate(-1)}>
                  Continue shopping
                </button>
              ) : (
                <Link to="/books" className="btn btn-outline btn-block">
                  Continue shopping
                </Link>
              )}
            </CartSummary>
          </aside>
        </div>
      )}
    </div>
  );
}

export default Cart;
