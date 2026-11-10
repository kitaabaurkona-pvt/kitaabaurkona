import { previewMode } from '../preview/mode';
import { supabase } from '../clients/supabase';
import { escapeLike } from '../utils/storeForm';
import { isUuid, unwrap } from './request';
import { COLLECTIONS } from '../utils/categories';
import { buildIndex, rankBooks } from '../utils/bookSearch';

export const LIST_FIELDS = 'id, title, price, mrp, discount_percent, stock_quantity, image_urls';
const DETAIL_FIELDS =
  'id, title, sku, description, price, mrp, discount_percent, stock_quantity, image_urls, video_url, length_cm, breadth_cm, height_cm, weight_kg, attributes, category';

export const PAGE_SIZE = 24;

export const SORTS = {
  title: { label: 'Title: A to Z', column: 'title', ascending: true },
  price_asc: { label: 'Price: low to high', column: 'price', ascending: true },
  price_desc: { label: 'Price: high to low', column: 'price', ascending: false },
  discount: { label: 'Biggest discount', column: 'discount_percent', ascending: false },
};
// The default order while searching: best match first.
export const RELEVANCE = 'relevance';

export async function listBooks({
  search = '',
  sort = 'title',
  inStock = false,
  category = '',
  maxPrice = null,
  collection = '',
  page = 0,
  pageSize = PAGE_SIZE,
} = {}) {
  if (previewMode) return (await import('../preview/catalogue')).previewList({ search, sort, inStock, category, maxPrice, collection, page, pageSize });
  const order = SORTS[sort] ?? SORTS.title;
  let query = supabase.from('books').select(LIST_FIELDS, { count: 'exact' }).eq('is_visible', true);
  const term = search.trim().slice(0, 100);
  if (term) query = query.ilike('title', `%${escapeLike(term)}%`);
  if (inStock) query = query.gt('stock_quantity', 0);
  if (category) query = query.eq('category', category);
  if (Number.isFinite(maxPrice) && maxPrice > 0) query = query.lte('price', maxPrice);
  // Fixed, code-defined title patterns only; nothing from the URL reaches the filter text.
  const languages = COLLECTIONS[collection]?.languages;
  if (languages) query = query.or(languages.map((word) => `title.ilike.%${word}%`).join(','));
  const from = page * pageSize;
  const { data, count } = unwrap(
    await query
      .order(order.column, { ascending: order.ascending })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1),
  );
  return { books: data ?? [], total: count ?? 0 };
}

// ---------------------------------------------------------------------------------
// Search
//
// The whole visible catalogue (a few fields per book) is read once and ranked in the
// browser by utils/bookSearch, which forgives typos and reads Hindi, Tamil, Urdu and
// other scripts. Only the books on the page being shown are then loaded in full, so
// their prices and stock are current. A search never ends on an empty page: if nothing
// is close, it offers books in stock instead and says so.

const INDEX_FIELDS = 'id, title, category, price, stock_quantity, discount_percent';
const INDEX_TTL = 10 * 60 * 1000;
const INDEX_CHUNK = 1000;
const SUGGESTIONS = 12;
let searchIndex = null;

async function readIndexRows() {
  const rows = [];
  for (let from = 0; from < 20 * INDEX_CHUNK; from += INDEX_CHUNK) {
    const { data } = unwrap(
      await supabase.from('books').select(INDEX_FIELDS).eq('is_visible', true).order('id', { ascending: true }).range(from, from + INDEX_CHUNK - 1),
    );
    rows.push(...(data ?? []));
    if (!data || data.length < INDEX_CHUNK) break;
  }
  return rows;
}

function loadSearchIndex() {
  if (searchIndex && Date.now() - searchIndex.at < INDEX_TTL) return searchIndex.promise;
  const promise = readIndexRows().then(buildIndex);
  searchIndex = { at: Date.now(), promise };
  promise.catch(() => {
    if (searchIndex?.promise === promise) searchIndex = null;
  });
  return promise;
}

function sortRows(rows, sort) {
  const order = SORTS[sort];
  if (!order) return rows;
  const sign = order.ascending ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[order.column];
    const y = b[order.column];
    const diff = typeof x === 'string' ? x.localeCompare(y) : Number(x ?? 0) - Number(y ?? 0);
    return diff !== 0 ? sign * diff : String(a.id).localeCompare(String(b.id));
  });
}

const byDiscount = (a, b) => (b.discount_percent ?? 0) - (a.discount_percent ?? 0) || String(a.title).localeCompare(String(b.title));

// Returns { books, total, note, relaxed, missing }:
//   note     - null (good matches), 'close' (nearest books only) or 'none' (nothing
//              near; `books` are suggestions),
//   relaxed  - the filters left nothing, so matches from the whole store are shown,
//   missing  - languages asked for that the store has no edition in yet.
export async function searchBooks({
  search = '',
  sort = RELEVANCE,
  inStock = false,
  category = '',
  maxPrice = null,
  collection = '',
  page = 0,
  pageSize = PAGE_SIZE,
} = {}) {
  if (previewMode) return (await import('../preview/catalogue')).previewList({ search, sort: SORTS[sort] ? sort : 'title', inStock, category, maxPrice, collection, page, pageSize });
  const index = await loadSearchIndex();
  const ranked = rankBooks(index, search.trim().slice(0, 100));
  const languages = COLLECTIONS[collection]?.languages?.map((word) => word.toLowerCase());
  const passes = (book) =>
    (!inStock || book.stock_quantity > 0) &&
    (!category || book.category === category) &&
    (!(Number.isFinite(maxPrice) && maxPrice > 0) || Number(book.price) <= maxPrice) &&
    (!languages || languages.some((word) => book.title.toLowerCase().includes(word)));

  let note = ranked.quality === 'close' ? 'close' : null;
  let relaxed = false;
  let rows = ranked.results.map((result) => result.book);
  if (rows.length > 0) {
    const kept = rows.filter(passes);
    if (kept.length > 0) rows = kept;
    else relaxed = true;
    if (sort !== RELEVANCE) rows = sortRows(rows, sort);
  } else {
    note = 'none';
    const all = index.entries.map((entry) => entry.book).filter((book) => book.stock_quantity > 0);
    const kept = all.filter(passes);
    rows = (kept.length > 0 ? kept : all).sort(byDiscount).slice(0, SUGGESTIONS);
  }

  const total = rows.length;
  const ids = rows.slice(page * pageSize, (page + 1) * pageSize).map((book) => book.id);
  let books = [];
  if (ids.length > 0) {
    const { data } = unwrap(await supabase.from('books').select(LIST_FIELDS).in('id', ids).eq('is_visible', true));
    const byId = new Map((data ?? []).map((book) => [book.id, book]));
    books = ids.map((id) => byId.get(id)).filter(Boolean);
  }
  return { books, total, note, relaxed, missing: ranked.missing };
}

export async function getBook(id) {
  if (previewMode) return (await import('../preview/catalogue')).previewBooks.find(b => b.id === id) ?? null;
  if (!isUuid(id)) return null;
  const { data } = unwrap(await supabase.from('books').select(DETAIL_FIELDS).eq('id', id).eq('is_visible', true).maybeSingle());
  return data;
}

// Used by the cart: hidden or deleted books simply do not come back.
export async function getBooksByIds(ids) {
  if (previewMode) return (await import('../preview/catalogue')).previewBooks.filter(b => ids.includes(b.id));
  const valid = ids.filter(isUuid);
  if (valid.length === 0) return [];
  const { data } = unwrap(await supabase.from('books').select(`${LIST_FIELDS}, is_visible`).in('id', valid));
  return (data ?? []).filter((book) => book.is_visible);
}

// Per category: how many visible books it has and a cover to show for it (the biggest
// in-stock discount, or any book if none is in stock), e.g.
// { 'Self-Help': { count: 61, cover: 'https://…', bookTitle: '…' } }.
export async function listCategorySummary() {
  const { data } = unwrap(
    await supabase
      .from('books')
      .select('category, title, image_urls, stock_quantity')
      .eq('is_visible', true)
      .not('category', 'is', null)
      .order('discount_percent', { ascending: false })
      .order('title', { ascending: true })
      .limit(1000),
  );
  const summary = {};
  for (const row of data ?? []) {
    const entry = (summary[row.category] ??= { count: 0, cover: null, bookTitle: '', inStock: false });
    entry.count += 1;
    const cover = Array.isArray(row.image_urls) ? row.image_urls[0] : null;
    const inStock = row.stock_quantity > 0;
    if (cover && (!entry.cover || (inStock && !entry.inStock))) {
      entry.cover = cover;
      entry.bookTitle = row.title;
      entry.inStock = inStock;
    }
  }
  return summary;
}

export async function listCategories() {
  if (previewMode) return [...new Set((await import('../preview/catalogue')).previewBooks.map(b => b.category))].filter(Boolean).sort();
  const { data } = unwrap(
    await supabase.from('books').select('category').eq('is_visible', true).not('category', 'is', null).limit(1000),
  );
  return [...new Set((data ?? []).map((row) => row.category))].sort((a, b) => a.localeCompare(b));
}
