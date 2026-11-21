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

// ---------- Orders (Process orders / Track orders) ----------

// An order still waiting to leave is late once it is this old (the "Delayed" filter).
export const SHIP_WITHIN_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
export const shipByOf = (createdAt) => new Date(new Date(createdAt).getTime() + SHIP_WITHIN_DAYS * DAY_MS);
const delayedBefore = () => new Date(Date.now() - SHIP_WITHIN_DAYS * DAY_MS).toISOString();

// Which orders each tab lists, by order status.
export const ORDER_TABS = {
  process: [
    ['to_ship', 'To ship', ['confirmed', 'paid']],
    ['pending', 'Payment pending', ['pending_payment']],
    ['cancelled', 'Cancelled', ['cancelled']],
  ],
  track: [
    ['all', 'All', null],
    ['shipped', 'On the way', ['shipped']],
    ['delivered', 'Delivered', ['delivered']],
  ],
};

// Parcel states the "Parcel" filter picks between, for orders still to ship.
const PARCEL_STATES = {
  unbooked: ['queued', 'booking', 'failed'],
  booked: ['booked'],
};
// Forward parcels of orders that have not left yet: small enough to filter by id.
const OPEN_PARCEL_STATES = ['queued', 'booking', 'booked', 'failed', 'cancel_requested'];

const ORDER_COLUMNS =
  '*, order_items(sku, title, quantity, unit_price, image_url), shipments(id, kind, carrier, status, needs_check, awb_number, xb_order_id, courier_id, courier_name, courier_chosen_by_admin, total_charges, label_url, last_error, attempts, book_after, updated_at)';

// India's midnight at the start of a YYYY-MM-DD day, as an instant.
const indiaMidnight = (day) => new Date(`${day}T00:00:00+05:30`);

// Order ids whose forward parcel matches, or null when the filter is not used. Filters on
// a parcel field are done in two steps (parcels first, then their orders).
async function parcelOrderIds(f) {
  const wantsAwb = f.searchBy === 'awb' && f.search;
  if (!wantsAwb && !f.carrier && !f.parcel) return null;
  let query = supabase.from('shipments').select('order_id').eq('kind', 'forward');
  if (wantsAwb) query = query.ilike('awb_number', `%${f.search.replace(/[^0-9A-Za-z]/g, '')}%`);
  if (f.carrier) query = query.eq('carrier', f.carrier);
  query = query.in('status', f.parcel ? PARCEL_STATES[f.parcel] : wantsAwb ? [...OPEN_PARCEL_STATES, 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'rto'] : OPEN_PARCEL_STATES);
  const rows = unwrap(await query.limit(500)).data ?? [];
  return [...new Set(rows.map((r) => r.order_id))];
}

// The same filters for the list and for its counts.
function filtered(query, f, ids, { items = f.items } = {}) {
  const statuses = ORDER_TABS[f.view].find(([value]) => value === f.tab)?.[2];
  if (statuses) query = query.in('status', statuses);
  if (ids) query = query.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  const term = cleanSearch(f.search ?? '');
  if (term && f.searchBy === 'order') {
    const n = term.replace(/^(KB|KAK)-?/i, '').replace(/^0+/, '');
    query = /^[0-9]{1,12}$/.test(n) ? query.eq('order_number', n) : query.eq('order_number', -1);
  }
  if (term && f.searchBy === 'phone') query = query.ilike('shipping_phone', `%${term.replace(/\D/g, '').slice(-10)}%`);
  if (term && f.searchBy === 'name') query = query.ilike('shipping_name', `%${term}%`);
  if (f.from) query = query.gte('created_at', indiaMidnight(f.from).toISOString());
  if (f.to) query = query.lt('created_at', new Date(indiaMidnight(f.to).getTime() + DAY_MS).toISOString());
  if (f.payment) query = query.eq('payment_method', f.payment);
  if (f.delayed) query = query.lt('created_at', delayedBefore());
  if (items === 'single') query = query.eq('item_count', 1);
  if (items === 'clubbed') query = query.gt('item_count', 1);
  return query;
}

// One page of orders for the orders table, plus how many are single-book and clubbed
// (several books) under the same filters.
export async function adminListOrders(f) {
  const ids = await parcelOrderIds(f);
  const from = f.page * ADMIN_PAGE_SIZE;
  const count = (items) => headCount(filtered(ordersCount(), f, ids, { items }));
  const [list, single, clubbed] = await Promise.all([
    filtered(supabase.from('orders').select(ORDER_COLUMNS, { count: 'exact' }), f, ids)
      .order('created_at', { ascending: f.sort === 'oldest' })
      .range(from, from + ADMIN_PAGE_SIZE - 1),
    count('single'),
    count('clubbed'),
  ]);
  const { data, count: total } = unwrap(list);
  return { orders: data ?? [], total: total ?? 0, single, clubbed, at: Date.now() };
}

// The numbers at the top of Process orders.
export async function adminOrderSummary() {
  const shipmentsCount = () => supabase.from('shipments').select('id', { count: 'exact', head: true });
  const toShip = () => ordersCount().in('status', ['confirmed', 'paid']);
  const [total, delayed, unbooked, booked, problems] = await Promise.all([
    headCount(toShip()),
    headCount(toShip().lt('created_at', delayedBefore())),
    headCount(shipmentsCount().eq('kind', 'forward').in('status', PARCEL_STATES.unbooked)),
    headCount(shipmentsCount().eq('kind', 'forward').in('status', PARCEL_STATES.booked)),
    headCount(shipmentsCount().in('status', ['failed', 'exception', 'rto', 'cancel_requested'])),
  ]);
  return { total, delayed, unbooked, booked, problems };
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
