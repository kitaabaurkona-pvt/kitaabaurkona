import { useState } from 'react';
import { Link } from 'react-router-dom';
import { stockLevel } from '../../utils/format';
import BookCover from './BookCover';
import PriceBlock from './PriceBlock';
import AddToCartButton from './AddToCartButton';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';

const MAX_PHOTOS = 3;

// The book's photos stacked in one frame. On hover the next photo fades in (0.5s) like
// the previous store; small arrows step through them. Extra photos are only loaded
// after the first hover, so a page of cards costs one image each.
function CardPhotos({ book, eager }) {
  const photos = (Array.isArray(book.image_urls) ? book.image_urls : []).filter(Boolean).slice(0, MAX_PHOTOS);
  const [armed, setArmed] = useState(false);
  const [index, setIndex] = useState(0);
  const [stepped, setStepped] = useState(false);
  const [loaded, setLoaded] = useState(() => new Set());
  const many = photos.length > 1;

  const showing = (i) => i === index && (i === 0 || loaded.has(i));

  function step(dir, event) {
    event.preventDefault();
    setArmed(true);
    setStepped(true);
    setIndex((i) => (i + dir + photos.length) % photos.length);
  }

  return (
    <div
      className="card-media"
      onMouseEnter={() => {
        if (!many || !window.matchMedia('(hover: hover)').matches) return;
        setArmed(true);
        if (!stepped) setIndex(1);
      }}
      onMouseLeave={() => {
        setIndex(0);
        setStepped(false);
      }}
    >
      <Link to={`/books/${book.id}`} className="card-media-link" tabIndex={-1} aria-hidden="true">
        <BookCover src={photos[0]} title={book.title} eager={eager} className="cover card-photo" />
        {armed &&
          photos.slice(1).map((src, n) => (
            <img
              key={src}
              src={src}
              alt=""
              className="card-photo-extra"
              data-shown={showing(n + 1) || undefined}
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={() => setLoaded((set) => new Set(set).add(n + 1))}
            />
          ))}
      </Link>
      {book.discount_percent > 0 && <span className="cover-tag">−{book.discount_percent}%</span>}
      {many && (
        <>
          <button type="button" className="card-photo-arrow card-photo-prev" tabIndex={-1} aria-hidden="true" onClick={(e) => step(-1, e)}>
            <ChevronLeftIcon size={16} />
          </button>
          <button type="button" className="card-photo-arrow card-photo-next" tabIndex={-1} aria-hidden="true" onClick={(e) => step(1, e)}>
            <ChevronRightIcon size={16} />
          </button>
        </>
      )}
    </div>
  );
}

function BookCard({ book, eager = false }) {
  const stock = stockLevel(book.stock_quantity);
  return (
    <article className="book-card">
      <CardPhotos book={book} eager={eager} />
      <div className="book-card-body">
        <h3 className="book-card-title">
          <Link to={`/books/${book.id}`} className="book-card-link" title={book.title}>
            {book.title}
          </Link>
        </h3>
        <PriceBlock price={book.price} mrp={book.mrp} discount={book.discount_percent} showOff />
        {stock.level !== 'in' && (
          <p className="stock-line" data-level={stock.level}>
            {stock.label}
          </p>
        )}
        <AddToCartButton book={book} className="btn btn-primary btn-block btn-card" />
      </div>
    </article>
  );
}

export default BookCard;
