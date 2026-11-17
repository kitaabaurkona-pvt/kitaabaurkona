// Admin site only: the client is part of the admin panel's first download anyway.
import { supabase } from '../clients/supabaseClient';
import { unwrap } from './request';

// Every call here is also enforced by the database: RLS and is_admin() refuse non-admins.

const headCount = async (query) => unwrap(await query).count ?? 0;
const booksCount = () => supabase.from('books').select('id', { count: 'exact', head: true });
const ordersCount = () => supabase.from('orders').select('id', { count: 'exact', head: true });

export async function getAdminStats() {
  const shipmentsCount = () => supabase.from('shipments').select('id', { count: 'exact', head: true });
  const [books, hidden, outOfStock, lowStock, noPhoto, pending, confirmed, paid, shipped, delivered, problems] = await Promise.all([
    headCount(booksCount()),
    headCount(booksCount().eq('is_visible', false)),
    headCount(booksCount().eq('stock_quantity', 0)),
    headCount(booksCount().gt('stock_quantity', 0).lte('stock_quantity', 5)),
    headCount(booksCount().eq('image_urls', '{}')),
    headCount(ordersCount().eq('status', 'pending_payment')),
    headCount(ordersCount().eq('status', 'confirmed')),
    headCount(ordersCount().eq('status', 'paid')),
    headCount(ordersCount().eq('status', 'shipped')),
    headCount(ordersCount().eq('status', 'delivered')),
    headCount(shipmentsCount().in('status', ['failed', 'exception', 'rto', 'cancel_requested'])),
  ]);
  return { books, hidden, outOfStock, lowStock, noPhoto, pending, confirmed, paid, shipped, delivered, problems };
}

export const ADMIN_PAGE_SIZE = 25;

// Characters with special meaning in the API's filter syntax are removed from the search.
// An underscore stays: SKUs contain them (2008_FREE SIZE), and in a search it only means
// "any one character", so a full SKU still finds its book.
const cleanSearch = (value) => value.replace(/[%\\",()*:]/g, ' ').trim().slice(0, 100);

const LIST_COLUMNS = 'id, title, sku, price, mrp, stock_quantity, is_visible, category, image_urls';

export async function adminListBooks({ search = '', filter = 'all', page = 0 } = {}) {
  let query = supabase.from('books').select(LIST_COLUMNS, { count: 'exact' });
  const term = cleanSearch(search);
  if (term) query = query.or(`title.ilike.%${term}%,sku.ilike.%${term}%`);
  if (filter === 'visible') query = query.eq('is_visible', true);
  if (filter === 'hidden') query = query.eq('is_visible', false);
  if (filter === 'out') query = query.eq('stock_quantity', 0);
  if (filter === 'low') query = query.gt('stock_quantity', 0).lte('stock_quantity', 5);
  if (filter === 'nophoto') query = query.eq('image_urls', '{}');
  const from = page * ADMIN_PAGE_SIZE;
  const { data, count } = unwrap(
    await query.order('title', { ascending: true }).order('id').range(from, from + ADMIN_PAGE_SIZE - 1),
  );
  return { books: data ?? [], total: count ?? 0 };
}

export async function adminListCategories() {
  const { data } = unwrap(await supabase.from('books').select('category').not('category', 'is', null).limit(1000));
  return [...new Set((data ?? []).map((row) => row.category))].sort((a, b) => a.localeCompare(b));
}

export async function adminUpdateBook(id, patch) {
  const { data } = unwrap(await supabase.from('books').update(patch).eq('id', id).select(LIST_COLUMNS).single());
  return data;
}

// Every editable field of one book, plus its admin-only cost price and pickup code.
export async function adminGetBook(id) {
  const [{ data: book }, { data: internal }] = await Promise.all([
    supabase.from('books').select('*').eq('id', id).maybeSingle().then(unwrap),
    supabase.from('book_internal').select('cost_price, pickup_address_code').eq('book_id', id).maybeSingle().then(unwrap),
  ]);
  return book ? { ...book, internal: internal ?? { cost_price: null, pickup_address_code: null } } : null;
}

async function saveInternal(bookId, internal) {
  unwrap(await supabase.from('book_internal').upsert({ book_id: bookId, ...internal }, { onConflict: 'book_id' }));
}

// Adds a new book. A SKU or product code already in use is refused by the database
// (error 23505), so adding can never overwrite another book.
export async function adminCreateBook(fields, internal) {
  const { data } = unwrap(await supabase.from('books').insert(fields).select('*').single());
  await saveInternal(data.id, internal);
  return data;
}

export async function adminSaveBook(id, fields, internal) {
  const { data } = unwrap(await supabase.from('books').update(fields).eq('id', id).select('*').single());
  await saveInternal(id, internal);
  return data;
}

// True when a book other than exceptId still shows this photo link.
export async function photoUsedElsewhere(url, exceptId) {
  let query = supabase.from('books').select('id', { count: 'exact', head: true }).contains('image_urls', [url]);
  if (exceptId) query = query.neq('id', exceptId);
  return (unwrap(await query).count ?? 0) > 0;
}

export async function adminListOrders({ status = 'all', page = 0 } = {}) {
  let query = supabase
    .from('orders')
    .select(
      '*, order_items(sku, title, quantity, unit_price, image_url), shipments(id, kind, carrier, status, needs_check, awb_number, xb_order_id, courier_id, courier_name, courier_chosen_by_admin, total_charges, label_url, last_error, attempts, book_after, updated_at)',
      { count: 'exact' },
    );
  if (status !== 'all') query = query.eq('status', status);
  const from = page * ADMIN_PAGE_SIZE;
  const { data, count } = unwrap(
    await query.order('created_at', { ascending: false }).range(from, from + ADMIN_PAGE_SIZE - 1),
  );
  return { orders: data ?? [], total: count ?? 0 };
}

export async function adminSetOrderStatus(id, status) {
  unwrap(await supabase.rpc('admin_set_order_status', { p_order: id, p_status: status }));
}

export const NEXT_STATUSES = {
  pending_payment: ['paid', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export function adminErrorMessage(error) {
  if (error?.code === '42501' || error?.status === 403) return "You don't have permission to do that.";
  if (error?.hint === 'stock' || error?.details?.hint === 'stock') return 'Not enough stock to mark this order paid.';
  if (error?.hint === 'shipped' || error?.details?.hint === 'shipped') return 'This parcel has already left with the courier, so the order cannot be cancelled now.';
  if (error?.code === '23505') return 'Another book already uses this SKU or product code. Use a different one.';
  if (error?.code === '23514') return 'Those values are not allowed. Check that the price is not above the MRP and nothing is negative.';
  if (error?.status === 401 || error?.code === 'PGRST301') return 'Your session has expired. Sign in again.';
  if (error?.status === 0) return 'Unable to reach the server. Check your connection and try again.';
  return 'That change could not be saved. Try again.';
}
