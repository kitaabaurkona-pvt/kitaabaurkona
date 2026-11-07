import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { listBooks } from '../services/bookService';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { coverOf, formatCount } from '../utils/format';
import BookCard from '../components/store/BookCard';
import { LoadError } from '../components/store/States';
import { BookGridSkeleton, ShelfSkeleton } from '../components/store/Skeletons';
import { Reveal } from '../components/motion/Reveal';
import { EASE, riseContainer, riseItem } from '../components/motion/presets';
import { SearchIcon } from '../components/icons';

const HERO_CANDIDATES = 8;

// Some cover links in the catalogue are dead, so covers are loaded first and only
// ones that actually arrive are stacked in the hero (no empty boxes).
function useLoadedCovers(books) {
  const [status, setStatus] = useState({});
  useEffect(() => {
    let active = true;
    const images = books.map((book) => {
      const image = new Image();
      image.referrerPolicy = 'no-referrer';
      const settle = (ok) => active && setStatus((current) => ({ ...current, [book.id]: ok }));
      image.onload = () => settle(true);
      image.onerror = () => settle(false);
      image.src = coverOf(book);
      return image;
    });
    return () => {
      active = false;
      for (const image of images) {
        image.onload = null;
        image.onerror = null;
      }
    };
  }, [books]);
  return status;
}

function HeroCovers({ books }) {
  const candidates = useMemo(() => books.filter((book) => coverOf(book)).slice(0, HERO_CANDIDATES), [books]);
  const status = useLoadedCovers(candidates);
  // Keep the deals order: wait for earlier covers to settle before showing later ones.
  const picks = [];
  for (const book of candidates) {
    if (status[book.id] === undefined) break;
    if (status[book.id]) picks.push(book);
    if (picks.length === 3) break;
  }
  if (picks.length < 3) return <div className="hero-stack" />;
  return (
    <div className="hero-stack">
      {picks.map((book, index) => (
        <motion.div
          key={book.id}
          className="hero-cover"
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.25 + index * 0.12 }}
        >
          <Link to={`/books/${book.id}`} aria-label={book.title}>
            <img src={coverOf(book)} alt="" loading="eager" decoding="async" referrerPolicy="no-referrer" />
            {book.discount_percent > 0 && <span className="hero-cover-tag">{book.discount_percent}% off</span>}
          </Link>
        </motion.div>
      ))}
    </div>
  );
}

function Home() {
  useDocumentTitle('');
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const deals = useAsync(() => listBooks({ sort: 'discount', inStock: true, pageSize: 10 }), []);
  const catalogue = useAsync(() => listBooks({ sort: 'title', pageSize: 8 }), []);

  function handleSearch(event) {
    event.preventDefault();
    const q = term.trim();
    navigate(q ? `/books?q=${encodeURIComponent(q)}` : '/books', { state: { focusSearch: !q } });
  }

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="container hero-grid">
          <motion.div variants={riseContainer} initial="hidden" animate="show">
            <motion.img variants={riseItem} className="hero-mark" src="/logo-192.png" alt="" width="56" height="56" />
            <motion.h1 variants={riseItem} id="hero-title" className="hero-title">
              Find your next book.
            </motion.h1>
            <motion.form variants={riseItem} className="search-form hero-search" role="search" onSubmit={handleSearch}>
              <label htmlFor="home-search" className="visually-hidden">
                Search books by title
              </label>
              <input
                id="home-search"
                className="input"
                type="search"
                placeholder="Search books by title"
                maxLength={100}
                value={term}
                onChange={(event) => setTerm(event.target.value)}
              />
              <button type="submit" className="btn btn-primary" aria-label="Search">
                <SearchIcon size={20} />
              </button>
            </motion.form>
            <motion.div variants={riseItem} className="hero-links">
              <Link to="/books?sort=discount&stock=1">Biggest discounts</Link>
              <Link to="/books?stock=1">In stock now</Link>
              <Link to="/books">All books</Link>
            </motion.div>
          </motion.div>
          {deals.data ? <HeroCovers books={deals.data.books} /> : <div className="hero-stack" />}
        </div>
      </section>

      <div className="band">
        <div className="container">
          <Reveal as="section" aria-labelledby="deals-heading">
            <div className="section-head">
              <h2 id="deals-heading" className="section-title">
                Biggest discounts
              </h2>
              <Link className="section-link" to="/books?sort=discount&stock=1">
                See all
              </Link>
            </div>
            {deals.loading && <ShelfSkeleton />}
            {deals.error && <LoadError onRetry={deals.retry} what="books" />}
            {deals.data && (
              <ul className="shelf">
                {deals.data.books.map((book, index) => (
                  <li key={book.id} className="rise" style={{ '--i': index }}>
                    <BookCard book={book} eager={index < 2} />
                  </li>
                ))}
              </ul>
            )}
          </Reveal>
        </div>
      </div>

      <div className="container">
        <Reveal as="section" className="section" aria-labelledby="catalogue-heading">
          <div className="section-head">
            <h2 id="catalogue-heading" className="section-title">
              All books
            </h2>
            {catalogue.data && <span className="page-meta">{formatCount(catalogue.data.total)} titles</span>}
          </div>
          {catalogue.loading && <BookGridSkeleton />}
          {catalogue.error && <LoadError onRetry={catalogue.retry} what="books" />}
          {catalogue.data && (
            <>
              <ul className="book-grid">
                {catalogue.data.books.map((book, index) => (
                  <li key={book.id} className="rise" style={{ '--i': index }}>
                    <BookCard book={book} />
                  </li>
                ))}
              </ul>
              <div className="load-more">
                <Link to="/books" className="btn btn-dark">
                  View all {formatCount(catalogue.data.total)} books
                </Link>
              </div>
            </>
          )}
        </Reveal>
      </div>
    </>
  );
}

export default Home;
