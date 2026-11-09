import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import BookCard from '../store/BookCard';
import { ShelfSkeleton } from '../store/Skeletons';
import { LoadError } from '../store/States';
import { FadeIn } from '../motion/FadeIn';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';

// A titled row of books. Phones swipe it; on larger screens arrow buttons move it one
// screenful at a time and disappear at either end.
function Shelf({ id, title, href, tint = 'sand', state }) {
  const listRef = useRef(null);
  const [ends, setEnds] = useState({ start: true, end: true });
  const reduce = useReduceMotion();
  const books = state.data?.books ?? [];

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const max = list.scrollWidth - list.clientWidth;
    setEnds({ start: list.scrollLeft <= 4, end: list.scrollLeft >= max - 4 });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, books.length]);

  function scroll(direction) {
    const list = listRef.current;
    if (!list) return;
    list.scrollBy({ left: direction * list.clientWidth * 0.9, behavior: reduce ? 'auto' : 'smooth' });
  }

  if (state.data && books.length === 0) return null;

  return (
    <section className="section shelf-section" aria-labelledby={`${id}-heading`} data-tint={tint}>
      <div className="section-head">
        <h2 id={`${id}-heading`} className="section-title">
          {title}
        </h2>
        <div className="shelf-head-actions">
          {books.length > 0 && (
            <>
              <button
                type="button"
                className="shelf-arrow"
                aria-label={`Scroll ${title} back`}
                hidden={ends.start}
                onClick={() => scroll(-1)}
              >
                <ChevronLeftIcon size={18} />
              </button>
              <button
                type="button"
                className="shelf-arrow"
                aria-label={`Scroll ${title} forward`}
                hidden={ends.end}
                onClick={() => scroll(1)}
              >
                <ChevronRightIcon size={18} />
              </button>
            </>
          )}
          <Link className="section-link" to={href}>
            View all
          </Link>
        </div>
      </div>
      {state.loading && !state.data && <ShelfSkeleton />}
      {state.error && <LoadError onRetry={state.retry} what="books" />}
      {books.length > 0 && (
        <FadeIn as="ul" className="shelf" ref={listRef} onScroll={measure}>
          {books.map((book) => (
            <li key={book.id}>
              <BookCard book={book} />
            </li>
          ))}
        </FadeIn>
      )}
    </section>
  );
}

export default Shelf;
