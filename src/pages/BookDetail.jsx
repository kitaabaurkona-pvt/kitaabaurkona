import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getBook } from '../services/bookService';
import { useAsync } from '../hooks/useAsync';
import { useCart } from '../hooks/useCart';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatPrice, stockLevel } from '../utils/format';
import { MAX_QUANTITY } from '../utils/storeForm';
import BookCover from '../components/store/BookCover';
import PriceBlock from '../components/store/PriceBlock';
import QuantityStepper from '../components/store/QuantityStepper';
import AddToCartButton from '../components/store/AddToCartButton';
import SaveButton from '../components/store/SaveButton';
import { LoadError, Loading, StateBlock } from '../components/store/States';

const ATTRIBUTE_LABELS = [
  ['genre', 'Genre'],
  ['brand', 'Brand'],
  ['country_of_origin', 'Country of origin'],
  ['ideal_for', 'Ideal for'],
  ['pack_of', 'Pack of'],
];

function specRows(book) {
  const rows = [['SKU', book.sku]];
  if (book.category) rows.push(['Category', book.category]);
  for (const [key, label] of ATTRIBUTE_LABELS) {
    if (book.attributes?.[key]) rows.push([label, book.attributes[key]]);
  }
  if (book.weight_kg) rows.push(['Shipping weight', `${Number(book.weight_kg)} kg`]);
  if (book.length_cm && book.breadth_cm && book.height_cm) {
    rows.push(['Package size', `${Number(book.length_cm)} × ${Number(book.breadth_cm)} × ${Number(book.height_cm)} cm`]);
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
  const room = Math.max(0, limit - quantityOf(book.id));
  const [quantity, setQuantity] = useState(1);
  const qty = Math.max(1, Math.min(quantity, room || 1));
  const stock = stockLevel(book.stock_quantity);
  const saving = Number(book.mrp) - Number(book.price);

  // If the book is already in the cart, go straight there instead of adding it twice.
  function buyNow() {
    if (book.stock_quantity <= 0) return;
    if (quantityOf(book.id) === 0) add(book.id, qty, limit);
    navigate('/cart');
  }

  return (
    <div className="container page">
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

      <div className="detail">
        <div>
          <div className="gallery-main">
            <BookCover src={images[active]} title={book.title} eager />
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
          <h1 className="detail-title">{book.title}</h1>
          <div className="detail-buy">
            <div>
              <PriceBlock price={book.price} mrp={book.mrp} large />
              {saving > 0 && (
                <p className="stock-line saving">
                  You save {formatPrice(saving)} ({book.discount_percent}%)
                </p>
              )}
              <p className="stock-line" data-level={stock.level}>
                {stock.label}
              </p>
            </div>
            {stock.level !== 'out' && room > 0 && (
              <div className="buy-row">
                <QuantityStepper value={qty} max={room} onChange={setQuantity} label="Quantity" />
                <AddToCartButton book={book} quantity={qty} />
                <SaveButton bookId={book.id} title={book.title} className="save-button save-button-lg" />
              </div>
            )}
            {(stock.level === 'out' || room === 0) && (
              <div className="buy-row buy-row-single">
                <AddToCartButton book={book} />
                <SaveButton bookId={book.id} title={book.title} className="save-button save-button-lg" />
              </div>
            )}
            {stock.level !== 'out' && (
              <button type="button" className="btn btn-dark btn-block" onClick={buyNow}>
                Buy now
              </button>
            )}
          </div>

          {book.description && (
            <section className="detail-section" aria-labelledby="about-heading">
              <h2 id="about-heading">About this book</h2>
              <p className="description">{book.description}</p>
            </section>
          )}

          <section className="detail-section" aria-labelledby="details-heading">
            <h2 id="details-heading">Details</h2>
            <dl className="spec-list">
              {specRows(book).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>

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
  const { data: book, loading, error, retry } = useAsync(() => getBook(id), [id]);

  if (loading) {
    return (
      <div className="container page">
        <Loading label="Loading book…" />
      </div>
    );
  }
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
