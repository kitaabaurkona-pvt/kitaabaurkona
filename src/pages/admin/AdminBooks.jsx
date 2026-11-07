import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminErrorMessage, adminListBooks, adminListCategories, adminUpdateBook, ADMIN_PAGE_SIZE } from '../../services/adminService';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../hooks/useToast';
import { coverOf, formatPrice, plural } from '../../utils/format';
import { cleanText, parseAmount } from '../../utils/catalogueSanitizer';
import BookCover from '../../components/store/BookCover';
import { LoadError, StateBlock } from '../../components/store/States';
import { LinesSkeleton } from '../../components/store/Skeletons';

const FILTERS = [
  ['all', 'All'],
  ['hidden', 'Hidden'],
  ['out', 'Out of stock'],
  ['low', 'Low stock'],
];

function validate(form) {
  const price = parseAmount(form.price);
  const mrp = parseAmount(form.mrp);
  const stock = parseAmount(form.stock_quantity);
  if (price.empty || price.invalid) return 'Enter a valid selling price.';
  if (mrp.empty || mrp.invalid) return 'Enter a valid MRP.';
  if (price.value > mrp.value) return 'The selling price cannot be higher than the MRP.';
  if (stock.empty || stock.invalid || !Number.isInteger(stock.value)) return 'Stock must be a whole number.';
  const category = cleanText(form.category).slice(0, 100);
  return {
    price: Math.round(price.value * 100) / 100,
    mrp: Math.round(mrp.value * 100) / 100,
    stock_quantity: stock.value,
    is_visible: form.is_visible,
    category: category || null,
  };
}

function EditBook({ book, categories, onSaved, onCancel }) {
  const [form, setForm] = useState({
    price: String(book.price),
    mrp: String(book.mrp),
    stock_quantity: String(book.stock_quantity),
    is_visible: book.is_visible,
    category: book.category ?? '',
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const set = (key) => (event) => setForm((c) => ({ ...c, [key]: event.target.value }));
  const base = `edit-${book.id}`;

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy.current) return;
    const patch = validate(form);
    if (typeof patch === 'string') {
      setError(patch);
      return;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      onSaved(await adminUpdateBook(book.id, patch));
    } catch (err) {
      busy.current = false;
      setSaving(false);
      setError(adminErrorMessage(err));
    }
  }

  return (
    <form className="admin-edit" onSubmit={handleSubmit} noValidate aria-label={`Edit ${book.title}`}>
      <div className="form-grid admin-edit-fields">
        <div>
          <label className="label" htmlFor={`${base}-price`}>Selling price (₹)</label>
          <input id={`${base}-price`} className="input" inputMode="decimal" value={form.price} onChange={set('price')} />
        </div>
        <div>
          <label className="label" htmlFor={`${base}-mrp`}>MRP (₹)</label>
          <input id={`${base}-mrp`} className="input" inputMode="decimal" value={form.mrp} onChange={set('mrp')} />
        </div>
        <div>
          <label className="label" htmlFor={`${base}-stock`}>Stock</label>
          <input id={`${base}-stock`} className="input" inputMode="numeric" value={form.stock_quantity} onChange={set('stock_quantity')} />
        </div>
        <div className="span-2">
          <label className="label" htmlFor={`${base}-category`}>Category</label>
          <input id={`${base}-category`} className="input" list="admin-categories" maxLength={100} placeholder="For example Fiction" value={form.category} onChange={set('category')} />
          <datalist id="admin-categories">
            {categories.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <label className="check-row" htmlFor={`${base}-visible`}>
          <input id={`${base}-visible`} type="checkbox" checked={form.is_visible} onChange={(e) => setForm((c) => ({ ...c, is_visible: e.target.checked }))} />
          Visible in the store
        </label>
      </div>
      {error && <p className="notice" data-tone="error" role="alert">{error}</p>}
      <div className="inline-actions">
        <button type="submit" className="btn btn-primary btn-sm" aria-busy={saving} aria-disabled={saving || undefined}>
          {saving && <span className="spinner" aria-hidden="true" />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AdminBooks() {
  useDocumentTitle('Admin books');
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.some(([v]) => v === params.get('filter')) ? params.get('filter') : 'all';
  const q = params.get('q') ?? '';
  const [term, setTerm] = useState(q);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const result = useAsync(() => adminListBooks({ search: q, filter, page }), [q, filter, page]);
  const categories = useAsync(() => adminListCategories(), []);
  const { show } = useToast();

  useEffect(() => {
    const wanted = term.trim();
    if (wanted === q) return undefined;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(window.location.search);
      if (wanted) next.set('q', wanted);
      else next.delete('q');
      setParams(next, { replace: true });
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [term, q, setParams]);

  function setFilter(value) {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete('filter');
    else next.set('filter', value);
    setParams(next, { replace: true });
    setPage(0);
    setEditing(null);
  }

  const books = result.data?.books ?? [];
  const total = result.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));

  return (
    <div className="stack-sm">
      <div className="toolbar">
        <div>
          <label htmlFor="admin-book-search" className="visually-hidden">Search by title or SKU</label>
          <input id="admin-book-search" className="input" type="search" placeholder="Search by title or SKU" maxLength={100} value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <div className="toolbar-row" role="group" aria-label="Filter books">
          {FILTERS.map(([value, label]) => (
            <button key={value} type="button" className="chip" aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {result.data && <p className="page-meta" aria-live="polite">{plural(total, 'book')}</p>}
      {result.loading && !result.data && <LinesSkeleton count={5} label="Loading books…" />}
      {result.error && <LoadError onRetry={result.retry} what="books" />}
      {result.data && books.length === 0 && (
        <StateBlock title={q || filter !== 'all' ? 'No books match.' : 'There are no books yet.'}>
          <Link to="/admin/bulk-upload" className="btn btn-dark">Bulk upload books</Link>
        </StateBlock>
      )}

      {books.length > 0 && (
        <ul className="line-list">
          {books.map((book) => (
            <li key={book.id} className="admin-row">
              <BookCover src={coverOf(book)} title={book.title} />
              <div className="admin-row-main">
                <p className="line-title">
                  <Link to={`/books/${book.id}`}>{book.title}</Link>
                </p>
                <div className="admin-row-meta">
                  <span>SKU {book.sku}</span>
                  <span>{formatPrice(book.price)} of {formatPrice(book.mrp)} MRP</span>
                  <span>Stock {book.stock_quantity}</span>
                  <span>{book.category ?? 'No category'}</span>
                </div>
                <div className="inline-actions">
                  {!book.is_visible && <span className="tag tag-dark">Hidden</span>}
                  {book.stock_quantity === 0 && <span className="tag">Out of stock</span>}
                  {savedId === book.id && editing !== book.id && <span className="tag tag-accent" role="status">Saved</span>}
                  {editing !== book.id && (
                    <button type="button" className="btn-link" onClick={() => { setSavedId(null); setEditing(book.id); }}>
                      Edit
                    </button>
                  )}
                </div>
                {editing === book.id && (
                  <EditBook
                    book={book}
                    categories={categories.data ?? []}
                    onCancel={() => setEditing(null)}
                    onSaved={(updated) => {
                      result.setData({ ...result.data, books: books.map((b) => (b.id === updated.id ? updated : b)) });
                      setEditing(null);
                      setSavedId(updated.id);
                      show({ message: `Saved “${updated.title}”` });
                      categories.retry();
                    }}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <div className="inline-actions pager">
          <button type="button" className="btn btn-outline btn-sm" aria-disabled={page === 0 || undefined} onClick={() => page > 0 && setPage(page - 1)}>
            Previous
          </button>
          <span className="page-meta">Page {page + 1} of {pages}</span>
          <button type="button" className="btn btn-outline btn-sm" aria-disabled={page >= pages - 1 || undefined} onClick={() => page < pages - 1 && setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}

export default AdminBooks;
