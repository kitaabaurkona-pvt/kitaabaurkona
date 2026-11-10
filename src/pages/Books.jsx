import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { listBooks, listCategories, SORTS } from '../services/bookService';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatPrice, plural } from '../utils/format';
import { COLLECTIONS, UNDER_PRICE, orderCategories } from '../utils/categories';
import BookCard from '../components/store/BookCard';
import { LoadError, StateBlock } from '../components/store/States';
import { BookGridSkeleton } from '../components/store/Skeletons';
import { SearchIcon } from '../components/icons';
import { FadeIn } from '../components/motion/FadeIn';

// Pages added with Show more, per filter, for this visit: coming back to the list shows
// the same books, so the scroll position can be restored.
const morePages = new Map();
function keepMore(entry) {
  morePages.delete(entry.key);
  morePages.set(entry.key, entry);
  while (morePages.size > 20) morePages.delete(morePages.keys().next().value);
}

function Books() {
  useDocumentTitle('Books');
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').slice(0, 100);
  const sort = SORTS[params.get('sort')] ? params.get('sort') : 'title';
  const inStock = params.get('stock') === '1';
  const category = params.get('category') ?? '';
  // Only known values are honoured, so a hand-edited URL cannot build other filters.
  const maxPrice = Number(params.get('max')) === UNDER_PRICE ? UNDER_PRICE : null;
  const collection = COLLECTIONS[params.get('collection')] ? params.get('collection') : '';
  const filterKey = `${q}|${sort}|${inStock}|${category}|${maxPrice}|${collection}`;

  const [term, setTerm] = useState(q);
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    if (q !== term.trim()) setTerm(q);
  }

  const inputRef = useRef(null);
  useEffect(() => {
    if (location.state?.focusSearch) inputRef.current?.focus();
  }, [location.state]);

  function update(changes) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  }

  // Search as you type, after a short pause.
  useEffect(() => {
    const wanted = term.trim();
    if (wanted === q) return undefined;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(window.location.search);
      if (wanted) next.set('q', wanted);
      else next.delete('q');
      setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [term, q, setParams]);

  const first = useAsync(() => listBooks({ search: q, sort, inStock, category, maxPrice, collection }), [filterKey], { key: `books:${filterKey}` });
  const categories = useAsync(() => listCategories(), [], { key: 'categories', staleMs: 30 * 60 * 1000 });

  const [more, setMore] = useState(() => morePages.get(filterKey) ?? { key: '', books: [], page: 0 });
  const [moreState, setMoreState] = useState({ loading: false, error: false });
  const keyRef = useRef(filterKey);
  useEffect(() => {
    keyRef.current = filterKey;
  }, [filterKey]);
  const extra = more.key === filterKey ? more : (morePages.get(filterKey) ?? { key: filterKey, books: [], page: 0 });

  async function loadMore() {
    if (moreState.loading) return;
    const key = filterKey;
    setMoreState({ loading: true, error: false });
    try {
      const next = await listBooks({ search: q, sort, inStock, category, maxPrice, collection, page: extra.page + 1 });
      if (keyRef.current !== key) return;
      const grown = { key, books: [...extra.books, ...next.books], page: extra.page + 1 };
      keepMore(grown);
      setMore(grown);
      setMoreState({ loading: false, error: false });
    } catch {
      if (keyRef.current === key) setMoreState({ loading: false, error: true });
    }
  }

  const books = first.data ? [...first.data.books, ...extra.books] : [];
  const total = first.data?.total ?? 0;
  const filtered = Boolean(q || inStock || category || maxPrice || collection);
  const describe = [
    category,
    maxPrice ? `up to ${formatPrice(maxPrice)}` : '',
    collection ? COLLECTIONS[collection].label.toLowerCase() : '',
  ].filter(Boolean);

  return (
    <div className="container page">
      <div className="page-head">
        <h1 className="page-title">Books</h1>
        {first.data && (
          <p className="page-meta" aria-live="polite">
            {plural(total, 'book')}
            {describe.length > 0 ? ` · ${describe.join(' · ')}` : ''}
            {q ? ` matching “${q}”` : ''}
          </p>
        )}
      </div>

      <div className="toolbar">
        <form className="search-form" role="search" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="books-search" className="visually-hidden">
            Search books by title
          </label>
          <input
            id="books-search"
            ref={inputRef}
            className="input"
            type="search"
            placeholder="Search books by title"
            maxLength={100}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </form>
        <div className="toolbar-row">
          <label htmlFor="books-sort" className="visually-hidden">
            Sort books
          </label>
          <select
            id="books-sort"
            className="select"
            value={sort}
            onChange={(event) => update({ sort: event.target.value === 'title' ? null : event.target.value })}
          >
            {Object.entries(SORTS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="chip"
            aria-pressed={inStock}
            onClick={() => update({ stock: inStock ? null : '1' })}
          >
            In stock only
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={Boolean(maxPrice)}
            onClick={() => update({ max: maxPrice ? null : String(UNDER_PRICE) })}
          >
            Up to {formatPrice(UNDER_PRICE)}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={Boolean(collection)}
            onClick={() => update({ collection: collection ? null : 'regional' })}
          >
            {COLLECTIONS.regional.label}
          </button>
        </div>
      </div>

      {categories.data?.length > 0 && (
        <div className="chip-scroll" role="group" aria-label="Categories">
          <button type="button" className="chip" aria-pressed={!category} onClick={() => update({ category: null })}>
            All categories
          </button>
          {orderCategories(categories.data).map((name) => (
            <button
              key={name}
              type="button"
              className="chip"
              aria-pressed={category === name}
              onClick={() => update({ category: category === name ? null : name })}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="results">
        {first.loading && <BookGridSkeleton />}
        {first.error && <LoadError onRetry={first.retry} what="books" />}
        {first.data && books.length === 0 && (
          <StateBlock title={filtered ? 'No books match these filters.' : 'There are no books in the store yet.'} icon={filtered ? SearchIcon : undefined}>
            {filtered && (
              <button type="button" className="btn btn-dark" onClick={() => setParams({}, { replace: true })}>
                Clear filters
              </button>
            )}
          </StateBlock>
        )}
        {books.length > 0 && !first.loading && (
          <FadeIn as="ul" className="book-grid">
            {books.map((book, index) => (
              <li key={book.id}>
                <BookCard book={book} eager={index < 4} />
              </li>
            ))}
          </FadeIn>
        )}
        {first.data && books.length < total && (
          <div className="load-more">
            <button
              type="button"
              className="btn btn-outline"
              aria-busy={moreState.loading}
              onClick={loadMore}
            >
              {moreState.loading && <span className="spinner" aria-hidden="true" />}
              {moreState.loading ? 'Loading…' : `Load more books (${total - books.length} more)`}
            </button>
          </div>
        )}
        {moreState.error && (
          <p className="notice notice-spaced" data-tone="error" role="alert">
            Couldn't load more books. Try again.
          </p>
        )}
      </div>
    </div>
  );
}

export default Books;
