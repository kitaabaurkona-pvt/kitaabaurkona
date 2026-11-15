import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Books, MagnifyingGlass, Plus, UploadSimple } from '@phosphor-icons/react';
import { adminErrorMessage, adminListBooks, adminUpdateBook, ADMIN_PAGE_SIZE } from '../../services/adminService';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../hooks/useToast';
import { coverOf, plural } from '../../utils/format';
import { parseAmount } from '../../utils/catalogueSanitizer';
import { LoadError, StateBlock } from '../../components/store/States';
import { LinesSkeleton } from '../../components/store/Skeletons';
import PageHead from '../../components/admin/PageHead';

const FILTERS = [
  ['all', 'All'],
  ['visible', 'In the store'],
  ['hidden', 'Hidden'],
  ['out', 'Out of stock'],
  ['low', 'Low stock'],
  ['nophoto', 'No photo'],
];

const QUICK_FIELDS = ['price', 'mrp', 'stock_quantity', 'is_visible'];
const draftOf = (book) => ({ price: String(book.price), mrp: String(book.mrp), stock_quantity: String(book.stock_quantity), is_visible: book.is_visible });

// Checks one row's quick edit. Returns the changes to save, or a message.
function checkDraft(draft, title) {
  const price = parseAmount(draft.price);
  const mrp = parseAmount(draft.mrp);
  const stock = parseAmount(draft.stock_quantity);
  if (price.empty || price.invalid) return `${title}: enter a valid selling price.`;
  if (mrp.empty || mrp.invalid) return `${title}: enter a valid MRP.`;
  if (price.value > mrp.value) return `${title}: the selling price cannot be more than the MRP.`;
  if (stock.empty || stock.invalid || !Number.isInteger(stock.value)) return `${title}: stock must be a whole number.`;
  return {
    price: Math.round(price.value * 100) / 100,
    mrp: Math.round(mrp.value * 100) / 100,
    stock_quantity: stock.value,
    is_visible: draft.is_visible,
  };
}

function StockBadge({ quantity }) {
  if (quantity === 0) return <span className="ap-badge" data-tone="danger">Out of stock</span>;
  if (quantity <= 5) return <span className="ap-badge" data-tone="warn">Low stock</span>;
  return null;
}

function AdminBooks() {
  useDocumentTitle('Books');
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.some(([v]) => v === params.get('filter')) ? params.get('filter') : 'all';
  const q = params.get('q') ?? '';
  const [term, setTerm] = useState(q);
  const [page, setPage] = useState(0);
  // Quick edits not saved yet, by book id: { book, draft }.
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const busy = useRef(false);
  const result = useAsync(() => adminListBooks({ search: q, filter, page }), [q, filter, page]);
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

  const changed = Object.values(drafts);
  useEffect(() => {
    if (changed.length === 0) return undefined;
    const warn = (event) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed.length]);

  function setFilter(value) {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete('filter');
    else next.set('filter', value);
    setParams(next, { replace: true });
    setPage(0);
  }

  function edit(book, key, value) {
    setSaveError(null);
    setDrafts((current) => {
      const draft = { ...(current[book.id]?.draft ?? draftOf(book)), [key]: value };
      const original = draftOf(book);
      const next = { ...current };
      if (QUICK_FIELDS.every((field) => String(draft[field]) === String(original[field]))) delete next[book.id];
      else next[book.id] = { book, draft };
      return next;
    });
  }

  async function saveAll() {
    if (busy.current || changed.length === 0) return;
    const patches = [];
    for (const { book, draft } of changed) {
      const patch = checkDraft(draft, book.title);
      if (typeof patch === 'string') {
        setSaveError(patch);
        return;
      }
      patches.push([book.id, patch]);
    }
    busy.current = true;
    setSaving(true);
    setSaveError(null);
    const outcomes = await Promise.allSettled(patches.map(([id, patch]) => adminUpdateBook(id, patch)));
    const saved = outcomes.filter((o) => o.status === 'fulfilled').map((o) => o.value);
    const failed = outcomes.find((o) => o.status === 'rejected');
    const byId = Object.fromEntries(saved.map((book) => [book.id, book]));
    if (result.data) result.setData({ ...result.data, books: result.data.books.map((b) => byId[b.id] ?? b) });
    setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !byId[id])));
    if (saved.length > 0) show({ message: `Saved ${plural(saved.length, 'book')}` });
    if (failed) setSaveError(adminErrorMessage(failed.reason));
    busy.current = false;
    setSaving(false);
  }

  const books = result.data?.books ?? [];
  const total = result.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const valueOf = (book, key) => drafts[book.id]?.draft[key] ?? draftOf(book)[key];

  return (
    <>
      <PageHead title="Books">
        <Link to="/admin/bulk-upload" className="btn btn-outline">
          <UploadSimple size={18} aria-hidden="true" />
          Bulk upload
        </Link>
        <Link to="/admin/books/new" className="btn btn-primary">
          <Plus size={18} weight="bold" aria-hidden="true" />
          Add book
        </Link>
      </PageHead>

      <section className="ap-card" aria-label="Books">
        <div className="ap-toolbar">
          <div className="ap-search">
            <MagnifyingGlass size={18} aria-hidden="true" />
            <label htmlFor="admin-book-search" className="visually-hidden">
              Search by book name or SKU
            </label>
            <input id="admin-book-search" className="input" type="search" placeholder="Search by book name or SKU" maxLength={100} value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
          <div className="ap-tabs" role="group" aria-label="Show">
            {FILTERS.map(([value, label]) => (
              <button key={value} type="button" className="chip" aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {result.loading && !result.data && (
          <div className="ap-card-body">
            <LinesSkeleton count={5} label="Loading books…" />
          </div>
        )}
        {result.error && (
          <div className="ap-card-body">
            <LoadError onRetry={result.retry} what="books" />
          </div>
        )}
        {result.data && books.length === 0 && (
          <div className="ap-card-body">
            <StateBlock title={q || filter !== 'all' ? 'No books match.' : 'There are no books yet.'}>
              <Link to="/admin/books/new" className="btn btn-primary">
                Add book
              </Link>
            </StateBlock>
          </div>
        )}

        {books.length > 0 && (
          <div className="ap-table-wrap">
            <table className="ap-table">
              <thead>
                <tr>
                  <th scope="col">Book</th>
                  <th scope="col" className="num">Selling price (₹)</th>
                  <th scope="col" className="num">MRP (₹)</th>
                  <th scope="col" className="num">Stock</th>
                  <th scope="col">In the store</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {books.map((book) => {
                  const cover = coverOf(book);
                  const base = `quick-${book.id}`;
                  return (
                    <tr key={book.id} className="ap-book-row" data-dirty={drafts[book.id] ? true : undefined}>
                      <td className="ap-col-book">
                        <div className="ap-book-cell">
                          {cover ? (
                            <img className="ap-thumb" src={cover} alt="" width="44" height="60" loading="lazy" referrerPolicy="no-referrer" />
                          ) : (
                            <span className="ap-thumb ap-thumb-empty" aria-hidden="true">
                              <Books size={20} />
                            </span>
                          )}
                          <div>
                            <Link to={`/admin/books/${book.id}`} className="ap-book-name">
                              {book.title}
                            </Link>
                            <span className="ap-book-sku">
                              SKU {book.sku}
                              {book.category ? ` · ${book.category}` : ''}
                            </span>
                            <span className="inline-actions" style={{ marginTop: 4 }}>
                              <StockBadge quantity={book.stock_quantity} />
                              {!cover && <span className="ap-badge" data-tone="warn">No photo</span>}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="num" data-label="Selling price (₹)">
                        <label htmlFor={`${base}-price`} className="visually-hidden">
                          Selling price of {book.title}
                        </label>
                        <input id={`${base}-price`} className="input ap-cell-input" inputMode="decimal" value={valueOf(book, 'price')} onChange={(e) => edit(book, 'price', e.target.value)} />
                      </td>
                      <td className="num" data-label="MRP (₹)">
                        <label htmlFor={`${base}-mrp`} className="visually-hidden">
                          MRP of {book.title}
                        </label>
                        <input id={`${base}-mrp`} className="input ap-cell-input" inputMode="decimal" value={valueOf(book, 'mrp')} onChange={(e) => edit(book, 'mrp', e.target.value)} />
                      </td>
                      <td className="num" data-label="Stock">
                        <label htmlFor={`${base}-stock`} className="visually-hidden">
                          Stock of {book.title}
                        </label>
                        <input id={`${base}-stock`} className="input ap-cell-input ap-cell-stock" inputMode="numeric" value={valueOf(book, 'stock_quantity')} onChange={(e) => edit(book, 'stock_quantity', e.target.value)} />
                      </td>
                      <td data-label="In the store">
                        <label className="ap-toggle" htmlFor={`${base}-visible`}>
                          <input id={`${base}-visible`} type="checkbox" checked={valueOf(book, 'is_visible')} onChange={(e) => edit(book, 'is_visible', e.target.checked)} />
                          <span className="ap-toggle-track" aria-hidden="true" />
                          {valueOf(book, 'is_visible') ? 'Shown' : 'Hidden'}
                        </label>
                      </td>
                      <td className="ap-col-actions">
                        <div className="ap-row-actions">
                          <Link to={`/admin/books/${book.id}`} className="btn btn-outline btn-sm" aria-label={`Edit ${book.title}`}>
                            Edit
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {result.data && total > 0 && (
          <div className="ap-pager">
            <span className="page-meta" aria-live="polite">
              {plural(total, 'book')}
              {pages > 1 ? ` · page ${page + 1} of ${pages}` : ''}
            </span>
            {pages > 1 && (
              <div className="ap-pager-buttons">
                <button type="button" className="btn btn-outline btn-sm" aria-disabled={page === 0 || undefined} onClick={() => page > 0 && setPage(page - 1)}>
                  Previous
                </button>
                <button type="button" className="btn btn-outline btn-sm" aria-disabled={page >= pages - 1 || undefined} onClick={() => page < pages - 1 && setPage(page + 1)}>
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {changed.length > 0 && (
        <div className="ap-savebar" role="region" aria-label="Unsaved changes">
          <p>{plural(changed.length, 'book')} changed</p>
          <div className="ap-savebar-actions">
            <button type="button" className="btn btn-outline" disabled={saving} onClick={() => { setDrafts({}); setSaveError(null); }}>
              Discard
            </button>
            <button type="button" className="btn btn-primary" aria-busy={saving} aria-disabled={saving || undefined} onClick={saveAll}>
              {saving && <span className="spinner" aria-hidden="true" />}
              Save changes
            </button>
          </div>
          {saveError && (
            <p className="notice" data-tone="error" role="alert" style={{ flexBasis: '100%' }}>
              {saveError}
            </p>
          )}
        </div>
      )}
    </>
  );
}

export default AdminBooks;
