import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { listBooks, listCategories, RELEVANCE, searchBooks, SORTS } from '../services/bookService';
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

// Names the languages a shopper asked for that the store has no edition in yet.
const LANGUAGE_NAMES = {
  hindi: 'Hindi', bengali: 'Bengali', tamil: 'Tamil', malayalam: 'Malayalam', marathi: 'Marathi', gujarati: 'Gujarati',
  telugu: 'Telugu', kannada: 'Kannada', punjabi: 'Punjabi', urdu: 'Urdu', odia: 'Odia', english: 'English',
};
function listNames(names) {
  const shown = names.map((name) => LANGUAGE_NAMES[name] ?? name);
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} or ${shown.at(-1)}` : shown[0];
}

// What to say above the results when they are not plain matches.
function searchNote(data, q, describe) {
  if (!data || !q) return null;
  const parts = [];
  if (data.missing?.length) parts.push(`We don't have ${listNames(data.missing)} editions yet.`);
  if (data.note === 'none') parts.push(`Nothing in the store matches “${q}”. Here are some books in stock.`);
  else if (data.note === 'close') parts.push(`No exact match for “${q}”. These are the closest.`);
  if (data.relaxed) parts.push(`None of the matches are in ${describe.join(' · ') || 'these filters'}, so here are matches from all books.`);
  return parts.length ? parts.join(' ') : null;
}

// The filters, in one dropdown so the toolbar stays calm: search, sort, Filters.
function FilterMenu({ options, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const count = options.filter((option) => option.checked).length;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      ref.current?.querySelector('.filter-toggle')?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="filter-menu" ref={ref}>
      <button
        type="button"
        className="select filter-toggle"
        aria-expanded={open}
        aria-controls="books-filters"
        onClick={() => setOpen((value) => !value)}
      >
        Filters{count > 0 ? ` (${count})` : ''}
      </button>
      {open && (
        <div id="books-filters" className="filter-panel" role="group" aria-label="Filters">
          {options.map((option) => (
            <label key={option.key} className="filter-option">
              <input type="checkbox" checked={option.checked} onChange={() => onToggle(option)} />
              <span>{option.label}</span>
            </label>
          ))}
          {count > 0 && (
            <button type="button" className="btn-link filter-clear" onClick={onClear}>
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Books() {
  useDocumentTitle('Books');
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').slice(0, 100);
  // While searching, the best matches come first unless another order is picked.
  const defaultSort = q ? RELEVANCE : 'title';
  const sortParam = params.get('sort');
  const sort = SORTS[sortParam] || (q && sortParam === RELEVANCE) ? sortParam : defaultSort;
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

  const find = q ? searchBooks : listBooks;
  const first = useAsync(() => find({ search: q, sort, inStock, category, maxPrice, collection }), [filterKey], { key: `books:${filterKey}` });
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
      const next = await find({ search: q, sort, inStock, category, maxPrice, collection, page: extra.page + 1 });
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
  const note = searchNote(first.data, q, describe);
  const suggestions = first.data?.note === 'none';

  return (
    <div className="container page">
      <div className="page-head">
        <h1 className="page-title">Books</h1>
        {first.data && !suggestions && (
          <p className="page-meta" aria-live="polite">
            {plural(total, 'book')}
            {describe.length > 0 && !first.data.relaxed ? ` · ${describe.join(' · ')}` : ''}
            {q ? ` for “${q}”` : ''}
          </p>
        )}
      </div>

      <div className="toolbar">
        <form className="search-form" role="search" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="books-search" className="visually-hidden">
            Search books
          </label>
          <input
            id="books-search"
            ref={inputRef}
            className="input"
            type="search"
            placeholder="Search by title, author or language"
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
            onChange={(event) => update({ sort: event.target.value === defaultSort ? null : event.target.value })}
          >
            {q && <option value={RELEVANCE}>Best match</option>}
            {Object.entries(SORTS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <FilterMenu
            options={[
              { key: 'stock', on: '1', label: 'In stock only', checked: inStock },
              { key: 'max', on: String(UNDER_PRICE), label: `Up to ${formatPrice(UNDER_PRICE)}`, checked: Boolean(maxPrice) },
              { key: 'collection', on: 'regional', label: COLLECTIONS.regional.label, checked: Boolean(collection) },
            ]}
            onToggle={(option) => update({ [option.key]: option.checked ? null : option.on })}
            onClear={() => update({ stock: null, max: null, collection: null })}
          />
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
        {note && !first.loading && (
          <p className="notice search-note" role="status">
            {note}
            {first.data.relaxed && (
              <>
                {' '}
                <button type="button" className="btn-link" onClick={() => update({ stock: null, max: null, collection: null, category: null })}>
                  Clear filters
                </button>
              </>
            )}
          </p>
        )}
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
