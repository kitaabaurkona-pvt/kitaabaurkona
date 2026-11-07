import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCartLines } from '../hooks/useCartLines';
import CartSummary from '../components/store/CartSummary';
import { useAuth } from '../hooks/useAuth';
import { useCart } from '../hooks/useCart';
import { useWishlist } from '../hooks/useWishlist';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import { coverOf, formatPrice, plural, stockLevel } from '../utils/format';
import BookCover from '../components/store/BookCover';
import PriceBlock from '../components/store/PriceBlock';
import QuantityStepper from '../components/store/QuantityStepper';
import { LoadError, StateBlock } from '../components/store/States';
import { LinesSkeleton } from '../components/store/Skeletons';
import { BagIcon } from '../components/icons';

function CartLine({ line }) {
  const { setQuantity, remove } = useCart();
  const { isAuthenticated } = useAuth();
  const { has, toggle } = useWishlist();
  const navigate = useNavigate();
  const location = useLocation();
  const [saveFailed, setSaveFailed] = useState(false);
  const { show } = useToast();
  const { book } = line;

  async function saveForLater() {
    if (!isAuthenticated) {
      navigate('/sign-in', { state: { from: location.pathname } });
      return;
    }
    try {
      if (!has(book.id)) await toggle(book.id);
      remove(book.id);
      show({ message: `Moved “${book.title}” to your wishlist`, action: { label: 'View', to: '/wishlist' } });
    } catch {
      setSaveFailed(true);
    }
  }

  if (!book) {
    return (
      <li className="line">
        <div className="line-cover">
          <BookCover src={null} title="Unavailable" />
        </div>
        <div className="line-body">
          <p className="line-title">This book is no longer available.</p>
          <div className="line-actions">
            <button type="button" className="btn-link" onClick={() => remove(line.id)}>
              Remove
            </button>
          </div>
        </div>
      </li>
    );
  }

  const stock = stockLevel(book.stock_quantity);
  const { quantity } = line;
  return (
    <li className="line">
      <Link to={`/books/${book.id}`} className="line-cover" tabIndex={-1} aria-hidden="true">
        <BookCover src={coverOf(book)} title={book.title} />
      </Link>
      <div className="line-body">
        <h2 className="line-title">
          <Link to={`/books/${book.id}`}>{book.title}</Link>
        </h2>
        <PriceBlock price={book.price} mrp={book.mrp} />
        {stock.level !== 'in' && (
          <p className="stock-line" data-level={stock.level}>
            {stock.label}
          </p>
        )}
        <div className="line-actions">
          {line.available && (
            <QuantityStepper
              small
              value={quantity}
              max={line.limit}
              label={`Quantity of ${book.title}`}
              onChange={(value) => setQuantity(book.id, value)}
            />
          )}
          <button type="button" className="btn-link" onClick={() => remove(book.id)}>
            Remove
          </button>
          <button type="button" className="btn-link" onClick={saveForLater}>
            Save for later
          </button>
          {line.available && <span className="line-total">{formatPrice(Number(book.price) * quantity)}</span>}
        </div>
        {saveFailed && (
          <p className="field-message" role="alert">
            Couldn't save this book. Try again.
          </p>
        )}
      </div>
    </li>
  );
}

function Cart() {
  useDocumentTitle('Cart');
  const { ids, items, setQuantity } = useCart();
  const { lines, totals, blocked, data, loading, error, retry } = useCartLines();

  // If stock dropped since the book was added, bring the quantity down to what exists.
  useEffect(() => {
    for (const line of lines) {
      if (line.available && items[line.id] > line.limit) setQuantity(line.id, line.limit);
    }
  }, [lines, items, setQuantity]);

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
            {lines.map((line) => (
              <CartLine key={line.id} line={line} />
            ))}
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
