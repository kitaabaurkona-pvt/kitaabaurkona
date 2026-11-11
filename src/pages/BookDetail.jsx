import { bookDisplay } from '../utils/bookDisplay';
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getBook } from '../services/bookService';
import { useAsync } from '../hooks/useAsync';
import { useCart } from '../hooks/useCart';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatPrice, stockLevel } from '../utils/format';
import { MAX_QUANTITY } from '../utils/storeForm';
import BookCover from '../components/store/BookCover';
import PriceBlock from '../components/store/PriceBlock';
import AddToCartButton from '../components/store/AddToCartButton';
import SaveButton from '../components/store/SaveButton';
import { LoadError, StateBlock } from '../components/store/States';
import { DetailSkeleton } from '../components/store/Skeletons';

const ATTRIBUTE_LABELS = [
  ['genre', 'Genre'],
  ['brand', 'Brand'],
  ['country_of_origin', 'Country of origin'],
  ['ideal_for', 'Ideal for'],
  ['pack_of', 'Pack of'],
];

// Only details that help a shopper choose. Marketplace and shipping data (SKU, package
// size, shipping weight) stay in the database for the admin side.
function specRows(book) {
  const rows = [];
  if (book.category) rows.push(['Category', book.category]);
  for (const [key, label] of ATTRIBUTE_LABELS) {
    if (book.attributes?.[key]) rows.push([label, book.attributes[key]]);
  }
  return rows;
}

function BookView({ book }) {
  useDocumentTitle(book.title);
  const navigate = useNavigate();
  const { add, quantityOf } = useCart();
  const images = book.image_urls ?? [];
  const [active, setActive] = useState(0);
  const limit = Math.min(book.stock_quantity, MAX_QUANTITY);
  const stock = stockLevel(book.stock_quantity);
  const saving = Number(book.mrp) - Number(book.price);
  const specs = specRows(book);
  const display = bookDisplay(book);

  // If the book is already in the cart, go straight there instead of adding it twice.
  function buyNow() {
    if (book.stock_quantity <= 0) return;
    if (quantityOf(book.id) === 0) add(book.id, 1, limit);
    navigate('/cart');
  }

  return (
    <div className="container page product-page">
      <nav aria-label="Breadcrumb">
        <ol className="breadcrumb">
          <li>
            <Link to="/">Store</Link>
          </li>
          <li>
            <Link to="/books">Books</Link>
          </li>
          <li aria-current="page">{book.title}</li>
        </ol>
      </nav>

      {stock.level !== 'out' && <div className="mobile-purchase-bar" role="region" aria-label="Quick purchase"><div><span className="mobile-price">{formatPrice(book.price)}</span><small>{book.category === 'Box Sets & Combos' ? 'per set' : 'per book'}</small></div><AddToCartButton book={book}/></div>}
      <div className="detail">
        <div className="detail-media">
          <div className="gallery-main">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.div
                key={images[active] ?? 'none'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: 'linear' }}
              >
                <BookCover src={images[active]} title={book.title} eager />
              </motion.div>
            </AnimatePresence>
            {book.discount_percent > 0 && <span className="cover-tag">−{book.discount_percent}%</span>}
          </div>
          {images.length > 1 && (
            <ul className="gallery-thumbs" aria-label="Book images">
              {images.map((src, index) => (
                <li key={src}>
                  <button
                    type="button"
                    className="thumb"
                    aria-pressed={index === active}
                    aria-label={`Show image ${index + 1} of ${images.length}`}
                    onClick={() => setActive(index)}
                  >
                    <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="eyebrow">{book.category}</p><h1 className="detail-title">{display.title}</h1>{display.author && <p className="detail-author">{display.author}</p>}
          <div className="detail-buy">
            <div>
              <PriceBlock price={book.price} mrp={book.mrp} large />
              {saving > 0 && <p className="detail-saving">You save {formatPrice(saving)}</p>}
              <p className="stock-line" data-level={stock.level}>
                {stock.label}
              </p>
            </div>
            {/* One control: Add to cart, which becomes − count + once the book is in the cart. */}
            <div className="buy-row buy-row-single">
              <AddToCartButton book={book} className="btn btn-primary btn-block" />
            </div>
            <div className="buy-secondary">
              {stock.level !== 'out' && (
                <button type="button" className="btn btn-outline" onClick={buyNow}>
                  Go to cart
                </button>
              )}
              <SaveButton bookId={book.id} title={book.title} className="btn btn-outline" withLabel />
            </div>
          </div>

          <div className="purchase-help"><Link to="/shipping">Delivery information</Link><Link to="/returns">Returns policy</Link></div>
          {book.description && (
            <section className="detail-section" aria-labelledby="about-heading">
              <h2 id="about-heading">About this book</h2>
              <p className="description">{book.description}</p>
            </section>
          )}

          {specs.length > 0 && (
            <section className="detail-section" aria-labelledby="details-heading">
              <h2 id="details-heading">Details</h2>
              <dl className="spec-list">
                {specs.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {book.video_url && (
            <section className="detail-section" aria-labelledby="video-heading">
              <h2 id="video-heading">Video</h2>
              <video className="detail-video" src={book.video_url} controls preload="none" playsInline />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function BookDetail() {
  const { id } = useParams();
  const { data: book, loading, error, retry } = useAsync(() => getBook(id), [id], { key: `book:${id}` });

  if (loading) return <DetailSkeleton />;
  if (error) {
    return (
      <div className="container page">
        <LoadError onRetry={retry} what="this book" />
      </div>
    );
  }
  if (!book) {
    return (
      <div className="container page">
        <StateBlock title="This book isn't available.">
          <Link to="/books" className="btn btn-dark">
            Browse books
          </Link>
        </StateBlock>
      </div>
    );
  }
  return <BookView key={book.id} book={book} />;
}

export default BookDetail;
