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
// The latest delivery date customers are shown: the top of the 3-7 days GoKwik's checkout
// promises (DEFAULT_DELIVERY_DAYS in supabase/functions/gokwik/config.js).
export const DELIVER_WITHIN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
export const shipByOf = (createdAt) => new Date(new Date(createdAt).getTime() + SHIP_WITHIN_DAYS * DAY_MS);
export const deliverByOf = (createdAt) => new Date(new Date(createdAt).getTime() + DELIVER_WITHIN_DAYS * DAY_MS);
const delayedBefore = () => new Date(Date.now() - SHIP_WITHIN_DAYS * DAY_MS).toISOString();

// Which orders each tab lists, by order status. "Failed AWB orders" are orders to ship
// whose courier booking failed (ShopDeck's "Expired AWB orders").
export const ORDER_TABS = {
  process: [
    ['to_ship', 'Non-dispatched orders', ['confirmed', 'paid']],
    ['awb_failed', 'Failed AWB orders', ['confirmed', 'paid']],
    ['pending', 'Payment pending orders', ['pending_payment']],
    ['cancelled', 'Cancelled', ['cancelled']],
  ],
  track: [
    ['all', 'All', null],
    ['shipped', 'On the way', ['shipped']],
    ['delivered', 'Delivered', ['delivered']],
  ],
};

// What the search box searches by.
export const SEARCH_BY = [
  ['order', 'Order Id'],
  ['awb', 'AWB Number'],
  ['phone', 'Customer No.'],
  ['product', 'Product ID'],
  ['sku', 'SKU ID'],
  ['min_qty', 'Min Quantity'],
  ['max_qty', 'Max Quantity'],
];

// Forward parcels of orders that have not left yet: small enough to filter by id.
const OPEN_PARCEL_STATES = ['queued', 'booking', 'booked', 'failed', 'cancel_requested'];
const LATER_PARCEL_STATES = ['in_transit', 'out_for_delivery', 'delivered', 'exception', 'rto'];

const ORDER_COLUMNS =
  '*, order_items(sku, title, quantity, unit_price, image_url, book_id), shipments(id, kind, carrier, status, needs_check, awb_number, xb_order_id, courier_id, courier_name, courier_chosen_by_admin, total_charges, label_url, last_error, attempts, book_after, updated_at, package_weight_g, package_length_cm, package_breadth_cm, package_height_cm, routing_code), order_fulfilment(label_printed_at, packed_at, handed_over_at, note, return_received_at)';

// The packing steps of orders to ship. Process orders shows the first three; an order
// leaves the page once handed over to the courier.
export const STAGES = [
  ['print', 'Print'],
  ['pack', 'Pack'],
  ['handover', 'Handover'],
  ['handed_over', 'Handed over'],
];
export const PROCESS_STAGES = STAGES.slice(0, 3);

// An order's packing record (one row, or none yet).
export const fulfilmentOf = (order) => {
  const f = order?.order_fulfilment;
  return (Array.isArray(f) ? f[0] : f) ?? null;
};

// Which step an order to ship is at.
export function stageOf(order) {
  const f = fulfilmentOf(order);
  if (!f?.label_printed_at) return 'print';
  if (!f.packed_at) return 'pack';
  if (!f.handed_over_at) return 'handover';
  return 'handed_over';
}

const idsFrom = (rows) => (rows ?? []).map((r) => r.order_id ?? r);
const unique = (list) => [...new Set(list)];
const intersect = (lists) => {
  const used = lists.filter(Boolean);
  if (used.length === 0) return null;
  return used.reduce((acc, list) => acc.filter((id) => list.includes(id)));
};
// The step an order was at when it was cancelled (orders.cancelled_from).
export const CANCELLED_FROM = [
  ['payment_pending', 'Payment pending'],
  ['print', 'Print'],
  ['pack', 'Pack'],
  ['handover', 'Handover'],
  ['handed_over', 'Handed over'],
  ['shipped', 'Shipped (came back)'],
  ['delivered', 'Delivered'],
];
const cancelledTab = (f) => f.view === 'process' && f.tab === 'cancelled';
const tabStatuses = (f) => ORDER_TABS[f.view].find(([value]) => value === f.tab)?.[2] ?? null;

// India's midnight at the start of a YYYY-MM-DD day, as an instant.
const indiaMidnight = (day) => new Date(`${day}T00:00:00+05:30`);

// Order ids whose forward parcel matches, or null when the filter is not used. Filters on
// a parcel field are done in two steps (parcels first, then their orders).
async function parcelOrderIds(f) {
  const wantsAwb = f.searchBy === 'awb' && f.search;
  const failed = f.view === 'process' && f.tab === 'awb_failed';
  if (!wantsAwb && !f.carrier && !failed) return null;
  let query = supabase.from('shipments').select('order_id').eq('kind', 'forward');
  if (wantsAwb) query = query.ilike('awb_number', `%${f.search.replace(/[^0-9A-Za-z]/g, '')}%`);
  if (f.carrier) query = query.eq('carrier', f.carrier);
  const states = failed ? ['failed'] : wantsAwb || f.view === 'track' ? [...OPEN_PARCEL_STATES, ...LATER_PARCEL_STATES] : OPEN_PARCEL_STATES;
  query = query.in('status', states);
  return unique(idsFrom(unwrap(await query.limit(1000)).data));
}

// Orders holding a book, searched by SKU or by the book's product code.
async function itemOrderIds(f) {
  const term = cleanSearch(f.search ?? '');
  if (!term || !['sku', 'product'].includes(f.searchBy)) return null;
  let query = supabase.from('order_items').select('order_id');
  if (f.searchBy === 'product') {
    const books = unwrap(await supabase.from('books').select('id').ilike('product_code', term).limit(50)).data ?? [];
    if (books.length === 0) return [];
    query = query.in('book_id', books.map((b) => b.id));
  } else {
    query = query.ilike('sku', `%${term}%`);
  }
  return unique(idsFrom(unwrap(await query.limit(1000)).data));
}

// Orders from new customers (first order from that mobile number) or repeat ones.
async function customerTypeIds(f) {
  if (!['new', 'repeat'].includes(f.customer)) return null;
  const statuses = tabStatuses(f);
  let query = supabase.from('orders').select('id, shipping_phone');
  if (statuses) query = query.in('status', statuses);
  const rows = unwrap(await query.order('created_at', { ascending: false }).limit(1000)).data ?? [];
  const phones = unique(rows.map((r) => r.shipping_phone));
  if (phones.length === 0) return [];
  const counts = unwrap(await supabase.rpc('admin_phone_order_counts', { p_phones: phones })).data ?? [];
  const orders = Object.fromEntries(counts.map((c) => [c.phone, c.orders]));
  return rows.filter((r) => ((orders[r.shipping_phone] ?? 0) >= 2) === (f.customer === 'repeat')).map((r) => r.id);
}

async function notedOrderIds() {
  return idsFrom(unwrap(await supabase.from('order_fulfilment').select('order_id').not('note', 'is', null).limit(1000)).data);
}

// The same filters for the list and for its counts. ids: only these orders (null = any);
// skip: never these.
function filtered(query, f, ids, skip, { items = f.items, delayed = f.delayed } = {}) {
  const statuses = tabStatuses(f);
  if (statuses) query = query.in('status', statuses);
  if (ids) query = query.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  if (skip.length) query = query.not('id', 'in', `(${skip.join(',')})`);
  const term = cleanSearch(f.search ?? '');
  if (term && f.searchBy === 'order') {
    const n = term.replace(/^(KB|KAK)-?/i, '').replace(/^0+/, '');
    query = /^[0-9]{1,12}$/.test(n) ? query.eq('order_number', n) : query.eq('order_number', -1);
  }
  if (term && f.searchBy === 'phone') query = query.ilike('shipping_phone', `%${term.replace(/\D/g, '').slice(-10)}%`);
  if (term && ['min_qty', 'max_qty'].includes(f.searchBy)) {
    const n = Number.parseInt(term.replace(/\D/g, ''), 10);
    if (Number.isFinite(n)) query = f.searchBy === 'min_qty' ? query.gte('item_count', n) : query.lte('item_count', n);
  }
  // On the Cancelled tab the dates are cancellation dates (as on ShopDeck).
  const dateColumn = cancelledTab(f) ? 'cancelled_at' : 'created_at';
  if (f.from) query = query.gte(dateColumn, indiaMidnight(f.from).toISOString());
  if (f.to) query = query.lt(dateColumn, new Date(indiaMidnight(f.to).getTime() + DAY_MS).toISOString());
  if (cancelledTab(f) && f.was) query = query.eq('cancelled_from', f.was);
  if (f.payment) query = query.eq('payment_method', f.payment);
  if (f.coupon === 'yes') query = query.gt('discount_total', 0);
  if (f.coupon === 'no') query = query.eq('discount_total', 0);
  if (delayed) query = query.lt('created_at', delayedBefore());
  if (items === 'single') query = query.eq('item_count', 1);
  if (items === 'clubbed') query = query.gt('item_count', 1);
  return query;
}

// The most orders one "Print all" or "Group by SKU" works on at once.
export const ADMIN_ALL_LIMIT = 300;

// One page of orders for the orders table (or, with all, every match up to
// ADMIN_ALL_LIMIT), plus how many are single-book, clubbed (several books) and delayed
// under the same filters.
export async function adminListOrders(f) {
  const toShip = f.view === 'process' && f.tab === 'to_ship';
  const [parcelIds, stageIds, dupIds, itemIds, customerIds, notedIds] = await Promise.all([
    parcelOrderIds(f),
    toShip && f.stage ? supabase.rpc('admin_fulfilment_order_ids', { p_stage: f.stage }).then((r) => idsFrom(unwrap(r).data)) : null,
    ['yes', 'no'].includes(f.dup) ? supabase.rpc('admin_duplicate_order_ids').then((r) => idsFrom(unwrap(r).data)) : null,
    itemOrderIds(f),
    customerTypeIds(f),
    ['yes', 'no'].includes(f.remarks) ? notedOrderIds() : null,
  ]);
  const ids = intersect([parcelIds, stageIds, f.dup === 'yes' ? dupIds : null, itemIds, customerIds, f.remarks === 'yes' ? notedIds : null]);
  const skip = [...(f.dup === 'no' ? dupIds : []), ...(f.remarks === 'no' ? notedIds : [])];
  const from = f.all ? 0 : f.page * ADMIN_PAGE_SIZE;
  const size = f.all ? ADMIN_ALL_LIMIT : ADMIN_PAGE_SIZE;
  const count = (opts) => headCount(filtered(ordersCount(), f, ids, skip, opts));
  const [list, single, clubbed, delayed] = await Promise.all([
    filtered(supabase.from('orders').select(ORDER_COLUMNS, { count: 'exact' }), f, ids, skip)
      .order(cancelledTab(f) ? 'cancelled_at' : 'created_at', { ascending: f.sort === 'oldest', nullsFirst: false })
      .range(from, from + size - 1),
    count({ items: 'single' }),
    count({ items: 'clubbed' }),
    count({ delayed: true }),
  ]);
  const { data, count: total } = unwrap(list);
  const orders = data ?? [];
  // How many orders each customer's mobile number has placed (New / Repeat badge), and
  // each book's product code (Product ID).
  const phones = unique(orders.map((o) => o.shipping_phone));
  const bookIds = unique(orders.flatMap((o) => o.order_items.map((i) => i.book_id)).filter(Boolean));
  // Cancelled orders: their online payment's refund (GoKwik) and when it went through.
  const cancelledIds = cancelledTab(f) ? orders.map((o) => o.id) : [];
  const [counts, books, payments, refundEvents] = await Promise.all([
    phones.length ? supabase.rpc('admin_phone_order_counts', { p_phones: phones }).then((r) => unwrap(r).data ?? []) : [],
    bookIds.length ? supabase.from('books').select('id, product_code').in('id', bookIds).then((r) => unwrap(r).data ?? []) : [],
    cancelledIds.length ? supabase.from('order_payments').select('order_id, refund_status, refunded_amount').in('order_id', cancelledIds).then((r) => unwrap(r).data ?? []) : [],
    cancelledIds.length
      ? supabase.from('payment_events').select('order_id, received_at').eq('event', 'refund.successful').in('order_id', cancelledIds).then((r) => unwrap(r).data ?? [])
      : [],
  ]);
  const customerOrders = Object.fromEntries(counts.map((c) => [c.phone, c.orders]));
  const productCodes = Object.fromEntries(books.map((b) => [b.id, b.product_code]));
  const refunds = Object.fromEntries(payments.map((p) => [p.order_id, { ...p, refunded_at: refundEvents.find((e) => e.order_id === p.order_id)?.received_at ?? null }]));
  return { orders, total: total ?? 0, single, clubbed, delayed, customerOrders, productCodes, refunds, at: Date.now() };
}

// The numbers at the top of Process orders and on its tabs. Handed-over orders have left
// the page, so they are not counted.
export async function adminOrderSummary() {
  const toShip = () => ordersCount().in('status', ['confirmed', 'paid']);
  const [stages, handedOver, failedParcels] = await Promise.all([
    supabase.rpc('admin_fulfilment_counts').then((r) => unwrap(r).data ?? {}),
    supabase.rpc('admin_fulfilment_order_ids', { p_stage: 'handed_over' }).then((r) => idsFrom(unwrap(r).data)),
    supabase.from('shipments').select('order_id').eq('kind', 'forward').eq('status', 'failed').limit(1000).then((r) => unique(idsFrom(unwrap(r).data))),
  ]);
  let delayedQuery = toShip().lt('created_at', delayedBefore());
  if (handedOver.length) delayedQuery = delayedQuery.not('id', 'in', `(${handedOver.join(',')})`);
  const [delayed, failed, pending] = await Promise.all([
    headCount(delayedQuery),
    failedParcels.length ? headCount(toShip().in('id', failedParcels)) : 0,
    headCount(ordersCount().eq('status', 'pending_payment')),
  ]);
  const total = (stages.print ?? 0) + (stages.pack ?? 0) + (stages.handover ?? 0);
  return { total, delayed, stages, tabs: { to_ship: total, awb_failed: failed, pending } };
}

// Moves orders to a packing step ('print', 'pack', 'handover' or 'handed_over').
export async function adminSetStage(orderIds, stage) {
  return unwrap(await supabase.rpc('admin_set_fulfilment_stage', { p_orders: orderIds, p_stage: stage })).data;
}

// Parcels coming back: undelivered parcels returning to the shop (RTO) and customers'
// return pickups. Returns their orders, newest first.
export async function adminListReturns() {
  const [rto, reverse] = await Promise.all([
    supabase.from('shipments').select('order_id').eq('kind', 'forward').eq('status', 'rto').limit(300),
    supabase.from('shipments').select('order_id').eq('kind', 'reverse').neq('status', 'cancelled').limit(300),
  ]);
  const ids = [...new Set([...(unwrap(rto).data ?? []), ...(unwrap(reverse).data ?? [])].map((r) => r.order_id))];
  if (ids.length === 0) return [];
  const { data } = unwrap(await supabase.from('orders').select(ORDER_COLUMNS).in('id', ids).order('created_at', { ascending: false }));
  return data ?? [];
}

// A customer's return reached the shop: its books go back into stock (once).
export async function adminReceiveReturn(orderId) {
  return unwrap(await supabase.rpc('admin_receive_return', { p_order: orderId })).data;
}

// Tax invoice numbers for orders (given the first time), by order id.
export async function adminIssueInvoices(orderIds) {
  const rows = unwrap(await supabase.rpc('admin_issue_invoices', { p_orders: orderIds })).data ?? [];
  return Object.fromEntries(rows.map((r) => [r.order_id, r]));
}

// Every order to ship at one step (for "Move all to Handover").
export async function adminStageOrderIds(stage) {
  return idsFrom(unwrap(await supabase.rpc('admin_fulfilment_order_ids', { p_stage: stage })).data);
}

export async function adminSetOrderNote(orderId, note) {
  return unwrap(await supabase.rpc('admin_set_order_note', { p_order: orderId, p_note: note })).data;
}

export async function adminUpdateOrderAddress(orderId, address) {
  unwrap(await supabase.rpc('admin_update_order_address', { p_order: orderId, p_address: address }));
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
  if (error?.hint === 'booked' || error?.details?.hint === 'booked') return 'The parcel is already booked with the courier, so the address cannot change now. Cancel the booking first.';
  if (error?.hint === 'note' || error?.details?.hint === 'note') return 'Keep the note under 500 characters.';
  if (error?.code === '23505') return 'Another book already uses this SKU or product code. Use a different one.';
  if (error?.code === '23514') return 'Those values are not allowed. Check that the price is not above the MRP and nothing is negative.';
  if (error?.status === 401 || error?.code === 'PGRST301') return 'Your session has expired. Sign in again.';
  if (error?.status === 0) return 'Unable to reach the server. Check your connection and try again.';
  return 'That change could not be saved. Try again.';
}
