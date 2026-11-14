import { bookDisplay } from '../utils/bookDisplay';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getBook } from '../services/bookService';
import { useAsync } from '../hooks/useAsync';
import { useCart } from '../hooks/useCart';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatPrice, stockLevel } from '../utils/format';
import { MAX_QUANTITY } from '../utils/storeForm';
import BookGallery from '../components/store/BookGallery';
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
  const limit = Math.min(book.stock_quantity, MAX_QUANTITY);
  const stock = stockLevel(book.stock_quantity);
  const saving = Number(book.mrp) - Number(book.price);
  const specs = specRows(book);
  const display = bookDisplay(book);

  const inStock = book.stock_quantity > 0;

  // Order now: the book goes into the cart (once; never a second copy if it is already
  // there) and the shopper goes straight to a checkout for this book alone; the rest of
  // the cart can be added there. Signed-out shoppers sign in first and come back to it.
  function orderNow() {
    if (!inStock) return;
    if (quantityOf(book.id) === 0) add(book.id, 1, limit);
    navigate(`/checkout?buy=${book.id}`);
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

      {inStock && (
        <div className="mobile-purchase-bar" role="region" aria-label="Quick purchase">
          <AddToCartButton book={book} className="btn btn-outline btn-block" />
          <button type="button" className="btn btn-primary btn-block order-now" onClick={orderNow}>
            Order now
          </button>
        </div>
      )}
      <div className="detail">
        <div className="detail-media">
          <BookGallery images={images} title={book.title} discount={book.discount_percent} />
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
            {/* Order now goes straight to checkout; Add to cart becomes − count + once added. */}
            <div className="buy-stack">
              {inStock && (
                <button type="button" className="btn btn-primary btn-block order-now" onClick={orderNow}>
                  Order now
                </button>
              )}
              <AddToCartButton book={book} className={inStock ? 'btn btn-outline btn-block' : 'btn btn-primary btn-block'} />
            </div>
            <div className="buy-secondary">
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
