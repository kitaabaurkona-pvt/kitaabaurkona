import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useAuth } from '../../hooks/useAuth';
import { useCart } from '../../hooks/useCart';
import { useWishlist } from '../../hooks/useWishlist';
import { useToast } from '../../hooks/useToast';
import { coverOf, formatPrice, stockLevel } from '../../utils/format';
import BookCover from '../store/BookCover';
import PriceBlock from '../store/PriceBlock';
import QuantityStepper from '../store/QuantityStepper';

// A removed line folds closed so it is clear what left the cart.
const collapse = {
  initial: false,
  exit: { opacity: 0, height: 0, transition: { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] } },
};

// One book in the cart, used by both the cart panel and the cart page.
function CartLine({ line, compact = false }) {
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
      <motion.li className="line" data-compact={compact || undefined} {...collapse}>
        <div className="line-inner">
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
        </div>
      </motion.li>
    );
  }

  const stock = stockLevel(book.stock_quantity);
  const { quantity } = line;
  const TitleTag = compact ? 'h3' : 'h2';
  return (
    <motion.li className="line" data-compact={compact || undefined} {...collapse}>
      <div className="line-inner">
        <Link to={`/books/${book.id}`} className="line-cover" tabIndex={-1} aria-hidden="true">
          <BookCover src={coverOf(book)} title={book.title} />
        </Link>
        <div className="line-body">
          <div className="line-head">
            <TitleTag className="line-title">
              <Link to={`/books/${book.id}`}>{book.title}</Link>
            </TitleTag>
            {line.available && <span className="line-total">{formatPrice(Number(book.price) * quantity)}</span>}
          </div>
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
          </div>
          {saveFailed && (
            <p className="field-message" role="alert">
              Couldn't save this book. Try again.
            </p>
          )}
        </div>
      </div>
    </motion.li>
  );
}

export default CartLine;
