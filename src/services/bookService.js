import { supabase } from '../clients/supabase';
import { escapeLike } from '../utils/storeForm';
import { isUuid, unwrap } from './request';

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

export async function listBooks({ search = '', sort = 'title', inStock = false, category = '', page = 0, pageSize = PAGE_SIZE } = {}) {
  const order = SORTS[sort] ?? SORTS.title;
  let query = supabase.from('books').select(LIST_FIELDS, { count: 'exact' }).eq('is_visible', true);
  const term = search.trim().slice(0, 100);
  if (term) query = query.ilike('title', `%${escapeLike(term)}%`);
  if (inStock) query = query.gt('stock_quantity', 0);
  if (category) query = query.eq('category', category);
  const from = page * pageSize;
  const { data, count } = unwrap(
    await query
      .order(order.column, { ascending: order.ascending })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1),
  );
  return { books: data ?? [], total: count ?? 0 };
}

export async function getBook(id) {
  if (!isUuid(id)) return null;
  const { data } = unwrap(await supabase.from('books').select(DETAIL_FIELDS).eq('id', id).eq('is_visible', true).maybeSingle());
  return data;
}

// Used by the cart: hidden or deleted books simply do not come back.
export async function getBooksByIds(ids) {
  const valid = ids.filter(isUuid);
  if (valid.length === 0) return [];
  const { data } = unwrap(await supabase.from('books').select(`${LIST_FIELDS}, is_visible`).in('id', valid));
  return (data ?? []).filter((book) => book.is_visible);
}

export async function listCategories() {
  const { data } = unwrap(
    await supabase.from('books').select('category').eq('is_visible', true).not('category', 'is', null).limit(1000),
  );
  return [...new Set((data ?? []).map((row) => row.category))].sort((a, b) => a.localeCompare(b));
}
