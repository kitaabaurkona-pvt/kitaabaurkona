import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { coverOf, formatPrice, stockLevel } from '../../utils/format';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import BookCover from '../store/BookCover';
import PriceBlock from '../store/PriceBlock';
import AddToCartButton from '../store/AddToCartButton';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';

const INTERVAL = 6000;
const TINTS = ['sand', 'sage', 'rose', 'sky', 'lilac'];
const EASE = [0.2, 0.8, 0.2, 1];

function Slide({ book, index, count, active }) {
  const stock = stockLevel(book.stock_quantity);
  const saving = Number(book.mrp) - Number(book.price);
  return (
    <motion.div
      className="slide"
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${count}`}
      aria-hidden={!active}
      inert={!active}
      initial={false}
      animate={{ opacity: active ? 1 : 0, x: active ? 0 : 16 }}
      transition={{ duration: 0.25, ease: EASE }}
    >
      <Link
        to={`/books/${book.id}`}
        className="slide-media"
        data-tint={TINTS[index % TINTS.length]}
        tabIndex={-1}
        aria-hidden="true"
      >
        <span className="slide-cover">
          <BookCover src={coverOf(book)} title={book.title} eager={index === 0} />
          {book.discount_percent > 0 && <span className="cover-tag">−{book.discount_percent}%</span>}
        </span>
      </Link>
      <div className="slide-body">
        <p className="eyebrow">Biggest discounts in stock</p>
        <h2 className="slide-title">
          <Link to={`/books/${book.id}`}>{book.title}</Link>
        </h2>
        <PriceBlock price={book.price} mrp={book.mrp} large />
        {saving > 0 && <p className="featured-saving">You save {formatPrice(saving)}</p>}
        {stock.level !== 'in' && (
          <p className="stock-line" data-level={stock.level}>
            {stock.label}
          </p>
        )}
        <div className="featured-actions">
          <AddToCartButton book={book} />
          <Link to={`/books/${book.id}`} className="btn btn-outline">
            View book
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

// Real books only: the biggest in-stock discounts, straight from the catalogue.
// It advances by itself every few seconds, pauses while it is hovered, focused or the
// tab is hidden, stops for good once someone uses the arrows, dots or a swipe, and
// never moves on its own when reduced motion is on.
function HeroSlider({ books }) {
  const count = books.length;
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  const [stopped, setStopped] = useState(false);
  const reduce = useReduceMotion();
  const touchStart = useRef(null);
  const auto = count > 1 && !stopped && !reduce;
  const running = auto && !hovered && !focused && !hidden;

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setActive((i) => (i + 1) % count), INTERVAL);
    return () => clearInterval(timer);
  }, [running, count]);

  function go(index) {
    setStopped(true);
    setActive(((index % count) + count) % count);
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse') return;
    touchStart.current = event.clientX;
  }

  function onPointerUp(event) {
    if (touchStart.current === null) return;
    const dx = event.clientX - touchStart.current;
    touchStart.current = null;
    if (Math.abs(dx) > 48) go(active + (dx < 0 ? 1 : -1));
  }

  if (count === 0) return null;

  return (
    <section
      className="slider"
      aria-roledescription="carousel"
      aria-label="Biggest discounts in stock"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        touchStart.current = null;
      }}
    >
      <div className="slides" aria-live={auto ? 'off' : 'polite'}>
        {books.map((book, index) => (
          <Slide key={book.id} book={book} index={index} count={count} active={index === active} />
        ))}
      </div>

      {count > 1 && (
        <div className="slider-controls">
          <button type="button" className="slider-arrow" aria-label="Previous book" onClick={() => go(active - 1)}>
            <ChevronLeftIcon size={20} />
          </button>
          <div className="slider-dots">
            {books.map((book, index) => (
              <button
                key={book.id}
                type="button"
                className="slider-dot"
                aria-label={`Show book ${index + 1} of ${count}`}
                aria-current={index === active ? 'true' : undefined}
                onClick={() => go(index)}
              />
            ))}
          </div>
          <button type="button" className="slider-arrow" aria-label="Next book" onClick={() => go(active + 1)}>
            <ChevronRightIcon size={20} />
          </button>
        </div>
      )}
    </section>
  );
}

export default HeroSlider;
