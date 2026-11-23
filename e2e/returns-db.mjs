// Database checks for return and exchange requests, run on the real supabase/schema.sql
// in PGlite (no network writes). Run: node e2e/returns-db.mjs
//
// Covers: who may ask (own delivered order, 3-day window, photos, one open request),
// who may decide, approving (exchange places a free replacement and takes stock),
// rejecting, the stage following the return pickup, the replacement and the refund,
// GoKwik and offline refunds, closing, withdrawing, receiving books back into stock.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asRole, createBackend, fetchPublicBooks, USERS } from './fake-supabase.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${String(detail).slice(0, 300)}`}`);
};

const books = await fetchPublicBooks(path.join(ROOT, '.env.local'));
const db = await createBackend({ schemaPath: path.join(ROOT, 'supabase', 'schema.sql'), books });

const READER = { role: 'authenticated', sub: USERS['reader@example.com'].id };
const ADMIN = { role: 'authenticated', sub: USERS['admin@example.com'].id };
const OTHER = { role: 'authenticated', sub: '33333333-3333-4333-8333-333333333333' };
const ANON = { role: 'anon', sub: null };
const SERVICE = { role: 'service_role', sub: null };

const as = (who, sql, params = []) => asRole(db, who, (tx) => tx.query(sql, params));
const fails = async (who, sql, params = []) => {
  try {
    await as(who, sql, params);
    return null;
  } catch (e) {
    return e.hint || e.code || e.message;
  }
};
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

const SHIP = { name: 'Asha Rao', phone: '9876543210', address: '12 MG Road, Near City Palace', city: 'Udaipur', state: 'Rajasthan', pincode: '313001' };
const inStock = (await db.query(`select id, sku, stock_quantity from public.books where is_visible and stock_quantity >= 10 order by stock_quantity desc, id limit 3`)).rows;
const stockOf = async (id) => (await one(`select stock_quantity from public.books where id = $1`, [id])).stock_quantity;

// A COD order of the reader's, delivered (optionally `days` ago).
async function deliveredOrder(lines, days = 0) {
  const r = await as(READER, `select public.create_order($1::jsonb, $2::jsonb, 'cod') as id`, [JSON.stringify(lines.map(([b, q]) => ({ book_id: b.id, quantity: q }))), JSON.stringify(SHIP)]);
  const id = r.rows[0].id;
  await db.query(`update public.orders set status = 'shipped' where id = $1`, [id]);
  await db.query(`update public.orders set status = 'delivered' where id = $1`, [id]);
  if (days) await db.query(`update public.orders set delivered_at = now() - make_interval(days => $2) where id = $1`, [id, days]);
  return id;
}
const ask = (who, order, { kind = 'return', items, reason = 'Damaged Product', remark = null, photos = null, upi = null }) =>
  as(who, `select public.request_return($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7) as id`, [order, kind, JSON.stringify(items), reason, remark, JSON.stringify(photos ?? [`${who.sub}/photo-0001.jpg`]), upi]).then((r) => r.rows[0].id);
const asks = (who, order, opts) => ask(who, order, opts).then(() => null, (e) => e.hint || e.code || e.message);
const request = (id) => one(`select * from public.return_requests where id = $1`, [id]);
// The courier's pickup: booked by the shipping function in production.
async function pickup(order, status) {
  const live = await one(`select id from public.shipments where order_id = $1 and kind = 'reverse' and status <> 'cancelled'`, [order]);
  const id = live?.id ?? (await as(SERVICE, `select public.create_return_shipment($1, null, 'xpressbees') as id`, [order])).rows[0].id;
  await db.query(`update public.shipments set status = $2 where id = $1`, [id, status]);
  return id;
}

try {
  const [b1, b2, b3] = inStock;

  // ---------- Delivered date ----------
  const o1 = await deliveredOrder([
    [b1, 2],
    [b2, 1],
  ]);
  check('a delivered order records when it was delivered', (await one(`select delivered_at from public.orders where id = $1`, [o1])).delivered_at != null);

  // ---------- Asking ----------
  const undelivered = (await as(READER, `select public.create_order($1::jsonb, $2::jsonb, 'cod') as id`, [JSON.stringify([{ book_id: b3.id, quantity: 1 }]), JSON.stringify(SHIP)])).rows[0].id;
  check('an order not yet delivered cannot be returned', (await asks(READER, undelivered, { items: [{ sku: b3.sku, quantity: 1 }] })) === 'return_not_delivered');
  check('another customer cannot ask about this order', (await asks(OTHER, o1, { items: [{ sku: b1.sku, quantity: 1 }] })) === 'P0002');
  check('a visitor cannot ask', (await fails(ANON, `select public.request_return($1, 'return', '[]'::jsonb, 'Other')`, [o1])) !== null);
  check('a book that is not in the order is refused', (await asks(READER, o1, { items: [{ sku: b3.sku, quantity: 1 }] })) === 'return_items');
  check('more copies than were ordered are refused', (await asks(READER, o1, { items: [{ sku: b2.sku, quantity: 2 }] })) === 'return_items');
  check('an unknown reason is refused', (await asks(READER, o1, { items: [{ sku: b1.sku, quantity: 1 }], reason: 'I just felt like it' })) === 'return_reason');
  check('Other needs a remark', (await asks(READER, o1, { items: [{ sku: b1.sku, quantity: 1 }], reason: 'Other', photos: [] })) === 'return_remark');
  check('a damaged book needs a photo', (await asks(READER, o1, { items: [{ sku: b1.sku, quantity: 1 }], photos: [] })) === 'return_photos');
  check('photos from another customer\'s folder are refused', (await asks(READER, o1, { items: [{ sku: b1.sku, quantity: 1 }], photos: [`${OTHER.sub}/photo-0001.jpg`] })) === 'return_photos');
  check('a UPI ID that is not one is refused', (await asks(READER, o1, { items: [{ sku: b1.sku, quantity: 1 }], upi: 'not a upi' })) === 'return_upi');
  const old = await deliveredOrder([[b3, 1]], 4);
  check('after 3 days the window has closed', (await asks(READER, old, { items: [{ sku: b3.sku, quantity: 1 }] })) === 'return_window');

  const r1 = await ask(READER, o1, { items: [{ sku: b1.sku, quantity: 1 }], remark: 'Cover torn', upi: 'asha@okbank' });
  const req1 = await request(r1);
  check('a customer asks to return one copy of a book', req1.stage === 'new' && req1.kind === 'return' && req1.source === 'website' && req1.items.length === 1 && req1.items[0].quantity === 1, JSON.stringify(req1));
  check('the request is worth that copy', Number(req1.amount) === Number(req1.items[0].unit_price), req1.amount);
  check('the order number and mobile are kept for searching', Number(req1.order_number) > 0 && req1.phone === SHIP.phone);
  check('a second open request for the same order is refused', (await asks(READER, o1, { items: [{ sku: b2.sku, quantity: 1 }] })) === 'return_open');
  check('the customer sees their own request', (await as(READER, `select id from public.return_requests`)).rows.some((r) => r.id === r1));
  check('another customer does not see it', (await as(OTHER, `select id from public.return_requests`)).rows.length === 0);
  check('nobody writes requests directly', (await fails(READER, `update public.return_requests set stage = 'closed' where id = $1`, [r1])) !== null);

  // ---------- Deciding ----------
  check('a customer cannot approve', (await fails(READER, `select public.admin_decide_return($1, 'approved')`, [r1])) === '42501');
  check('rejecting needs a reason from the list', (await fails(ADMIN, `select public.admin_decide_return($1, 'rejected', 'Because')`, [r1])) === 'return_reason');
  check('rejecting with Other needs remarks', (await fails(ADMIN, `select public.admin_decide_return($1, 'rejected', 'Other')`, [r1])) === 'cancel_remarks');
  await as(ADMIN, `select public.admin_decide_return($1, 'approved')`, [r1]);
  check('approving moves it to Ongoing', (await request(r1)).stage === 'ongoing' && (await request(r1)).decision === 'approved');
  check('an approved request cannot be decided again', (await fails(ADMIN, `select public.admin_decide_return($1, 'rejected', 'Duplicate request')`, [r1])) === 'return_locked');
  check('it can no longer be withdrawn', (await fails(READER, `select public.withdraw_return_request($1)`, [r1])) === 'return_locked');

  // The pickup carries only the returned book.
  const firstTry = (await as(SERVICE, `select public.create_return_shipment($1, null, 'xpressbees') as id`, [o1])).rows[0].id;
  const data = (await as(SERVICE, `select public.shipment_booking_data($1) as d`, [firstTry])).rows[0].d;
  check('the return pickup carries only the books being returned', data.items.length === 1 && data.items[0].sku === b1.sku && data.items[0].quantity === 1, JSON.stringify(data.items));
  await as(SERVICE, `select public.record_cancelled($1, null, 'Pickup refused')`, [firstTry]);
  check('a pickup that could not be booked moves it to Pickup Failed', (await request(r1)).stage === 'pickup_failed' && (await request(r1)).pickup_failed_at != null);
  await pickup(o1, 'booked');
  check('booking the pickup again moves it back to Ongoing', (await request(r1)).stage === 'ongoing' && (await request(r1)).pickup_failed_at == null);
  await pickup(o1, 'in_transit');
  check('once picked up, a return waits for its refund', (await request(r1)).stage === 'settlement_pending');

  // ---------- Refund ----------
  check('a COD order cannot be refunded through GoKwik', (await fails(ADMIN, `select public.admin_settle_return($1, 'gokwik', 10)`, [r1])) === 'return_no_gokwik');
  check('a refund larger than the books is refused', (await fails(ADMIN, `select public.admin_settle_return($1, 'offline', $2, 'UTR1')`, [r1, Number(req1.amount) + 1])) === 'return_amount');
  check('an offline refund needs its reference', (await fails(ADMIN, `select public.admin_settle_return($1, 'offline', $2)`, [r1, Number(req1.amount)])) === 'return_ref');
  await as(ADMIN, `select public.admin_settle_return($1, 'offline', $2, 'UTR629717944373')`, [r1, Number(req1.amount)]);
  const paid1 = await request(r1);
  check('an offline refund closes the request as passed', paid1.stage === 'closed' && paid1.outcome === 'passed' && paid1.refund_mode === 'offline' && paid1.refunded_at != null, JSON.stringify(paid1));
  check('a returned order cannot be returned again', (await asks(READER, o1, { items: [{ sku: b2.sku, quantity: 1 }] })) === 'return_done');

  // Receiving the parcel puts back only the returned copy.
  const s1 = await stockOf(b1.id);
  const s2 = await stockOf(b2.id);
  await as(ADMIN, `select public.admin_receive_return($1)`, [o1]);
  check('receiving the return puts back only the returned copy', (await stockOf(b1.id)) === s1 + 1 && (await stockOf(b2.id)) === s2);

  // ---------- GoKwik refund ----------
  const o2 = await deliveredOrder([[b2, 1]]);
  await db.query(`update public.orders set amount_paid = total where id = $1`, [o2]);
  await db.query(`insert into public.order_payments (order_id, method, payment_id) values ($1, 'prepaid', 'pay_test_1')`, [o2]);
  const r2 = await ask(READER, o2, { items: [{ sku: b2.sku, quantity: 1 }], reason: 'Wrong Product Received' });
  await as(ADMIN, `select public.admin_decide_return($1, 'approved')`, [r2]);
  await pickup(o2, 'delivered');
  const amount2 = Number((await request(r2)).amount);
  await as(ADMIN, `select public.admin_settle_return($1, 'gokwik', $2)`, [r2, amount2]);
  const queued = await one(`select * from public.gokwik_order_updates where order_id = $1 and refund_amount is not null order by id desc limit 1`, [o2]);
  check('a GoKwik refund is queued for GoKwik with the amount', queued && Number(queued.refund_amount) === amount2 && queued.order_status === 'Confirmed', JSON.stringify(queued));
  check('until GoKwik confirms it, the request waits in Settlement Pending', (await request(r2)).stage === 'settlement_pending' && (await request(r2)).refund_mode === 'gokwik');
  check('a second refund while one is under way is refused', (await fails(ADMIN, `select public.admin_settle_return($1, 'gokwik', 1)`, [r2])) === 'return_refund_busy');
  await db.query(`update public.order_payments set refund_status = 'successful', refunded_amount = $2 where order_id = $1`, [o2, amount2]);
  check('GoKwik\'s refund closes the request as passed', (await request(r2)).stage === 'closed' && (await request(r2)).outcome === 'passed');

  // ---------- Exchange ----------
  const o3 = await deliveredOrder([[b3, 2]]);
  const r3 = await ask(READER, o3, { kind: 'exchange', items: [{ sku: b3.sku, quantity: 1 }], reason: 'Defective product (pages missing or misprinted)' });
  const s3 = await stockOf(b3.id);
  const replacement = (await as(ADMIN, `select public.admin_decide_return($1, 'approved') as id`, [r3])).rows[0].id;
  const rep = await one(`select o.*, (select unit_price from public.order_items i where i.order_id = o.id) as price, (select status from public.shipments s where s.order_id = o.id and s.kind = 'forward') as parcel from public.orders o where o.id = $1`, [replacement]);
  check('approving an exchange places a free replacement order for the customer', rep && rep.origin === 'exchange' && Number(rep.total) === 0 && Number(rep.price) === 0 && rep.user_id === READER.sub && rep.status === 'paid' && rep.item_count === 1, JSON.stringify(rep && { origin: rep.origin, total: rep.total, user: rep.user_id, status: rep.status }));
  check('the replacement is queued for shipping and takes the copy from stock', rep.parcel === 'queued' && (await stockOf(b3.id)) === s3 - 1);
  check('the replacement is linked to the request', (await request(r3)).replacement_order_id === replacement);
  check('the customer sees the replacement under their orders', (await as(READER, `select id from public.orders where id = $1`, [replacement])).rows.length === 1);
  await pickup(o3, 'in_transit');
  check('an exchange stays Ongoing until the replacement is delivered', (await request(r3)).stage === 'ongoing');
  await db.query(`update public.orders set status = 'shipped' where id = $1`, [replacement]);
  await db.query(`update public.orders set status = 'delivered' where id = $1`, [replacement]);
  check('the replacement delivered closes the exchange as passed', (await request(r3)).stage === 'closed' && (await request(r3)).outcome === 'passed');
  check('a replacement cannot itself be returned here', (await asks(READER, replacement, { items: [{ sku: b3.sku, quantity: 1 }] })) === 'return_replacement');

  // ---------- Rejecting, withdrawing, closing ----------
  const o4 = await deliveredOrder([[b1, 1]]);
  const r4 = await ask(READER, o4, { items: [{ sku: b1.sku, quantity: 1 }], reason: 'Found better price for same product', photos: [] });
  await as(READER, `select public.withdraw_return_request($1)`, [r4]);
  check('a customer can withdraw a new request', (await request(r4)).stage === 'closed' && (await request(r4)).decision === 'withdrawn');
  const r5 = await ask(READER, o4, { kind: 'exchange', items: [{ sku: b1.sku, quantity: 1 }], reason: 'Quality not up to expectation', photos: [] });
  check('after withdrawing, the customer can ask again', (await request(r5)).stage === 'new');
  await as(ADMIN, `select public.admin_decide_return($1, 'rejected', 'Book is used or damaged by the customer')`, [r5]);
  const rej = await request(r5);
  check('rejecting closes the request with its reason', rej.stage === 'closed' && rej.decision === 'rejected' && rej.reject_reason === 'Book is used or damaged by the customer' && rej.replacement_order_id === null);

  const o5 = await deliveredOrder([[b2, 1]]);
  const r6 = await as(ADMIN, `select public.admin_create_return_request($1, 'return', $2::jsonb, 'Missing item/Quantity', 'Called the shop') as id`, [o5, JSON.stringify([{ sku: b2.sku, quantity: 1 }])]).then((r) => r.rows[0].id);
  check('an admin can record a request made by phone', (await request(r6)).source === 'admin' && (await request(r6)).stage === 'new');
  check('a customer cannot use the admin form', (await fails(READER, `select public.admin_create_return_request($1, 'return', $2::jsonb, 'Other', 'x')`, [o5, JSON.stringify([{ sku: b2.sku, quantity: 1 }])])) === '42501');
  await as(ADMIN, `select public.admin_decide_return($1, 'approved')`, [r6]);
  check('closing needs a reason from the list', (await fails(ADMIN, `select public.admin_close_return_request($1, 'Nope')`, [r6])) === 'return_reason');
  await as(ADMIN, `select public.admin_close_return_request($1, 'Cancelled by customer')`, [r6]);
  check('an admin can close an approved request as failed', (await request(r6)).stage === 'closed' && (await request(r6)).outcome === 'failed' && (await request(r6)).fail_reason === 'Cancelled by customer');

  // ---------- Pickup failed for more than 7 days ----------
  const o6 = await deliveredOrder([[b3, 1]]);
  const r7 = await ask(READER, o6, { items: [{ sku: b3.sku, quantity: 1 }], reason: 'Missing item/Quantity', photos: [] });
  await as(ADMIN, `select public.admin_decide_return($1, 'approved')`, [r7]);
  await pickup(o6, 'cancelled');
  await db.query(`update public.return_requests set pickup_failed_at = now() - interval '8 days' where id = $1`, [r7]);

  // ---------- Notes and numbers ----------
  check('a customer cannot read the overview', (await fails(READER, `select public.admin_return_overview()`)) === '42501');
  const overview = (await as(ADMIN, `select public.admin_return_overview() as o`)).rows[0].o;
  check('the overview counts every tab', overview.tabs && overview.tabs.closed >= 6 && overview.tabs.new === 0, JSON.stringify(overview));
  check('a pickup that failed over 7 days ago is closed', (await request(r7)).stage === 'closed' && (await request(r7)).fail_reason === 'Pickup failed');
  check('the overview gives the approval rate', overview.approval_rate > 0 && overview.approval_rate <= 100, JSON.stringify(overview));
  await as(ADMIN, `select public.admin_set_return_note($1, 'Customer sent extra photos on WhatsApp')`, [r7]);
  check('an admin keeps a note on a request', (await request(r7)).note === 'Customer sent extra photos on WhatsApp');
  check('a customer cannot write notes', (await fails(READER, `select public.admin_set_return_note($1, 'x')`, [r7])) === '42501');
} finally {
  await db.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
