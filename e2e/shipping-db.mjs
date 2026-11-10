// Database checks for cash on delivery and shipping, run on the real supabase/schema.sql
// in PGlite (no network writes). Run: node e2e/shipping-db.mjs
//
// Covers: COD orders and stock, the parcel queue (booked at once), who may read and
// write what (customer, other customer, visitor, admin, service role), booking, retries,
// cancellations before and after booking, tracking moving orders along, rate limits.

import fs from 'node:fs';
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
const schemaPath = path.join(ROOT, 'supabase', 'schema.sql');
const db = await createBackend({ schemaPath, books });

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
    return e.message;
  }
};
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

const SHIP = { name: 'Asha Rao', phone: '9876543210', address: '12 MG Road, Near City Palace', city: 'Udaipur', state: 'Rajasthan', pincode: '313001' };
const inStock = (await db.query(`select id, stock_quantity from public.books where is_visible and stock_quantity >= 3 order by id limit 3`)).rows;

async function placeCod(bookId, qty = 1, who = READER) {
  const r = await as(who, `select public.create_order($1::jsonb, $2::jsonb, 'cod') as id`, [JSON.stringify([{ book_id: bookId, quantity: qty }]), JSON.stringify(SHIP)]);
  return r.rows[0].id;
}
const stockOf = async (id) => (await one(`select stock_quantity from public.books where id = $1`, [id])).stock_quantity;
const shipmentOf = (orderId) => one(`select * from public.shipments where order_id = $1 and kind = 'forward' order by created_at desc limit 1`, [orderId]);

try {
  // ---------- Schema can be run again ----------
  let rerun = null;
  try {
    await db.exec(fs.readFileSync(schemaPath, 'utf8'));
  } catch (e) {
    rerun = e.message;
  }
  check('schema.sql runs a second time without errors', rerun === null, rerun);

  // ---------- Cash on delivery ----------
  // Stand-in for the job runner from shipping_cron.sql, which in production asks the
  // shipping function to book due parcels. It notes each call; a second variant fails.
  await db.exec(`
    create table public.job_calls (job text, at timestamptz default now());
    create function public.shipping_run_job(p_job text) returns bigint language plpgsql security definer set search_path = '' as $$
    begin insert into public.job_calls (job) values (p_job); return 1; end $$;
    revoke execute on function public.shipping_run_job(text) from public, anon, authenticated, service_role;
  `);
  const [b1, b2, b3] = inStock;
  const before = await stockOf(b1.id);
  const o1 = await placeCod(b1.id, 2);
  const order1 = await one(`select status, payment_method, subtotal from public.orders where id = $1`, [o1]);
  check('COD order is confirmed at once', order1.status === 'confirmed' && order1.payment_method === 'cod', JSON.stringify(order1));
  check('COD takes the books out of stock immediately', (await stockOf(b1.id)) === before - 2);
  const s1 = await shipmentOf(o1);
  check('a parcel is queued for the order', s1 && s1.status === 'queued');
  check('the parcel is due for booking at once (no waiting time)', new Date(s1.book_after) <= new Date(), s1.book_after);
  check('placing the order wakes the booking worker', (await one(`select count(*)::int as n from public.job_calls where job = 'book_due'`)).n === 1);
  check('the old waiting-time setting is gone', !(await one(`select 1 as x from information_schema.columns where table_name = 'shipping_settings' and column_name = 'hold_minutes'`)));
  await db.exec(`create or replace function public.shipping_run_job(p_job text) returns bigint language plpgsql security definer set search_path = '' as $$ begin raise exception 'vault secrets missing'; end $$;`);
  let extra = null;
  let stillPlaced = null;
  try {
    extra = await placeCod(b3.id, 1);
  } catch (e) {
    stillPlaced = e.message;
  }
  check('an order still goes through when the worker cannot be woken (the 5-minute round books it)', extra && stillPlaced === null, stillPlaced);
  // Not part of the checks below: cancel it, which drops its unbooked parcel.
  if (extra) await as(READER, `select public.cancel_order($1)`, [extra]);
  await db.exec(`drop function public.shipping_run_job(text); drop table public.job_calls;`);
  check('the queueing is logged', Boolean(await one(`select 1 from public.shipment_events where order_id = $1 and action = 'queued'`, [o1])));

  const tooMany = await fails(READER, `select public.create_order($1::jsonb, $2::jsonb, 'cod')`, [JSON.stringify([{ book_id: b1.id, quantity: 999 }]), JSON.stringify(SHIP)]);
  check('COD cannot take more than is in stock', tooMany !== null);
  const badPay = await fails(READER, `select public.create_order($1::jsonb, $2::jsonb, 'card')`, [JSON.stringify([{ book_id: b1.id, quantity: 1 }]), JSON.stringify(SHIP)]);
  check('unknown payment methods are refused', /payment/i.test(badPay ?? ''), badPay);
  check('visitors cannot place orders', (await fails(ANON, `select public.create_order($1::jsonb, $2::jsonb, 'cod')`, [JSON.stringify([{ book_id: b1.id, quantity: 1 }]), JSON.stringify(SHIP)])) !== null);
  check('the old two-argument create_order is gone', !(await one(`select 1 as x from pg_proc where proname = 'create_order' and pronargs = 2`)));

  // ---------- Who can see and touch what ----------
  check('customer cannot read the shipments table directly', (await as(READER, `select * from public.shipments`)).rows.length === 0);
  const mine = (await as(READER, `select * from public.get_my_shipments($1)`, [o1])).rows;
  check('customer sees their own parcel through get_my_shipments', mine.length === 1 && mine[0].status === 'queued');
  check('get_my_shipments hides labels, charges and errors', mine[0] && !('label_url' in mine[0]) && !('total_charges' in mine[0]) && !('last_error' in mine[0]));
  check('another customer sees nothing for that order', (await as(OTHER, `select * from public.get_my_shipments($1)`, [o1])).rows.length === 0);
  check('visitors cannot call get_my_shipments', (await fails(ANON, `select * from public.get_my_shipments($1)`, [o1])) !== null);
  for (const table of ['integration_tokens', 'pincode_checks', 'rate_limits']) {
    check(`customer cannot read ${table}`, (await fails(READER, `select * from public.${table}`)) !== null);
    check(`admin cannot read ${table} from the website either`, (await fails(ADMIN, `select * from public.${table}`)) !== null);
  }
  check('customer cannot read shipping settings', (await as(READER, `select * from public.shipping_settings`)).rows.length === 0);
  check('customer cannot change shipping settings', (await as(READER, `update public.shipping_settings set auto_book = false returning id`)).rows.length === 0);
  check('customer cannot add parcels', (await fails(READER, `insert into public.shipments (order_id) values ($1)`, [o1])) !== null);
  check('customer cannot change parcels', (await fails(READER, `update public.shipments set status = 'delivered'`)) !== null);
  check('admin cannot write parcels from the website', (await fails(ADMIN, `update public.shipments set status = 'delivered'`)) !== null);
  for (const fn of [
    `public.claim_due_shipments(10)`,
    `public.claim_shipment('${s1.id}')`,
    `public.shipment_booking_data('${s1.id}')`,
    `public.record_tracking('${s1.id}', 'delivered', 'x', '[]'::jsonb)`,
    `public.hit_rate_limit('x', 1, 60)`,
  ]) {
    const fnName = fn.split('(')[0];
    check(`customer cannot run ${fnName}`, (await fails(READER, `select ${fn}`)) !== null);
    check(`admin cannot run ${fnName} from the website`, (await fails(ADMIN, `select ${fn}`)) !== null);
  }
  check('admin reads parcels and their log', (await as(ADMIN, `select * from public.shipments`)).rows.length >= 1 && (await as(ADMIN, `select * from public.shipment_events`)).rows.length >= 1);
  check('admin reads shipping settings', (await as(ADMIN, `select * from public.shipping_settings`)).rows.length === 1);
  const badSetting = await fails(ADMIN, `update public.shipping_settings set pickup_pincode = 'abc'`);
  check('settings refuse an invalid PIN code', badSetting !== null);

  // ---------- Worker: claiming ----------
  const noWarehouse = (await as(SERVICE, `select * from public.claim_due_shipments(10)`)).rows;
  check('nothing is booked until the warehouse name is set', noWarehouse.length === 0);
  check('Book now explains the missing warehouse', /warehouse/i.test((await fails(SERVICE, `select * from public.claim_shipment($1)`, [s1.id])) ?? ''));
  await as(ADMIN, `update public.shipping_settings set warehouse_name = 'Kitaabaurkona Udaipur'`);
  await as(ADMIN, `update public.shipping_settings set auto_book = false`);
  check('automatic booking off: nothing is claimed', (await as(SERVICE, `select * from public.claim_due_shipments(10)`)).rows.length === 0);
  await as(ADMIN, `update public.shipping_settings set auto_book = true`);
  const claimed = (await as(SERVICE, `select * from public.claim_due_shipments(10)`)).rows;
  check('due parcels are claimed straight away', claimed.length === 1 && claimed[0].status === 'booking' && claimed[0].attempts === 1, JSON.stringify(claimed.map((c) => c.status)));
  check('a claimed parcel is not claimed twice', (await as(SERVICE, `select * from public.claim_due_shipments(10)`)).rows.length === 0);
  const data = (await as(SERVICE, `select public.shipment_booking_data($1) as d`, [s1.id])).rows[0].d;
  check('booking data comes from the database (order, items with weight, settings)', data.order.pincode === '313001' && data.items[0].weight_kg !== undefined && data.settings.warehouse_name === 'Kitaabaurkona Udaipur');

  // ---------- Recording a booking ----------
  const booking = {
    awb_number: '14344940342223', xb_order_id: '19177931', xb_shipment_id: '9590285', xb_status: 'booked',
    courier_id: '1', courier_name: 'Surface Xpressbees 0.5 K.G', freight_charges: 63, cod_charges: 40, total_charges: 103,
    label_url: 'https://xb-files.s3.amazonaws.com/labels/20240209185649-80.pdf', manifest_url: 'https://xb-files.s3.amazonaws.com/manifest/20240209185649-34.pdf',
    package_weight_g: 800, package_length_cm: 22, package_breadth_cm: 15, package_height_cm: 6,
  };
  const evil = await fails(SERVICE, `select public.record_booking($1, $2::jsonb)`, [s1.id, JSON.stringify({ ...booking, label_url: 'https://evil.example.com/x.pdf' })]);
  check('a label link from any other host is refused', evil !== null);
  await as(SERVICE, `select public.record_booking($1, $2::jsonb)`, [s1.id, JSON.stringify(booking)]);
  const booked = await shipmentOf(o1);
  check('the booking is saved (AWB, courier, label)', booked.status === 'booked' && booked.awb_number === booking.awb_number && booked.label_url === booking.label_url);

  // ---------- Customer cancels a booked (not picked up) order ----------
  const stockBeforeCancel = await stockOf(b1.id);
  await as(READER, `select public.cancel_order($1)`, [o1]);
  check('customer can cancel a COD order before pickup', (await one(`select status from public.orders where id = $1`, [o1])).status === 'cancelled');
  check('cancelling returns the books to stock', (await stockOf(b1.id)) === stockBeforeCancel + 2);
  check('the booked parcel is marked for cancellation with Xpressbees', (await shipmentOf(o1)).status === 'cancel_requested');

  // ---------- Failures and retries ----------
  const o2 = await placeCod(b2.id, 1);
  const s2 = await shipmentOf(o2);
  await db.query(`update public.shipments set book_after = now() - interval '1 minute' where id = $1`, [s2.id]);
  await as(SERVICE, `select * from public.claim_due_shipments(10)`);
  await as(SERVICE, `select public.record_booking_failure($1, 'Xpressbees did not answer', true)`, [s2.id]);
  const retry = await shipmentOf(o2);
  check('a failed booking is retried later', retry.status === 'queued' && new Date(retry.next_attempt_at) > new Date());
  check('it is not claimed again before its retry time', (await as(SERVICE, `select * from public.claim_due_shipments(10)`)).rows.length === 0);
  for (let i = 0; i < 5; i++) {
    await db.query(`update public.shipments set next_attempt_at = now() - interval '1 second' where id = $1`, [s2.id]);
    await as(SERVICE, `select * from public.claim_due_shipments(10)`);
    await as(SERVICE, `select public.record_booking_failure($1, 'still failing', true)`, [s2.id]);
  }
  check('after 5 failed attempts it waits for an admin', (await shipmentOf(o2)).status === 'failed');
  const retried = (await as(SERVICE, `select * from public.claim_shipment($1)`, [s2.id])).rows;
  check('an admin retry takes a failed parcel', retried.length === 1 && retried[0].status === 'booking');
  await as(SERVICE, `select public.record_booking($1, $2::jsonb)`, [s2.id, JSON.stringify({ ...booking, awb_number: '14344940342224' })]);

  // ---------- Tracking moves the order along ----------
  await as(SERVICE, `select public.record_tracking($1, 'in_transit', 'in transit', $2::jsonb)`, [s2.id, JSON.stringify([{ status: 'in transit', at: '2026-11-10 10:00' }])]);
  check('picked up: the order becomes shipped', (await one(`select status from public.orders where id = $1`, [o2])).status === 'shipped');
  check('a shipped order cannot be cancelled by the customer', (await fails(READER, `select public.cancel_order($1)`, [o2])) !== null);
  check('an admin cannot cancel it either while it is with the courier', (await fails(ADMIN, `select public.admin_set_order_status($1, 'cancelled')`, [o2])) !== null);
  check('tracking refuses unknown statuses', (await fails(SERVICE, `select public.record_tracking($1, 'teleported', 'x', '[]'::jsonb)`, [s2.id])) !== null);
  await as(SERVICE, `select public.record_tracking($1, 'delivered', 'delivered', $2::jsonb)`, [s2.id, JSON.stringify([{ status: 'delivered' }])]);
  check('delivered: the order becomes delivered', (await one(`select status from public.orders where id = $1`, [o2])).status === 'delivered');
  const mineDelivered = (await as(READER, `select * from public.get_my_shipments($1)`, [o2])).rows[0];
  check('the customer sees the delivery history', mineDelivered.status === 'delivered' && Array.isArray(mineDelivered.history));

  // ---------- Online order: queued when marked paid ----------
  const o3 = (await as(READER, `select public.create_order($1::jsonb, $2::jsonb) as id`, [JSON.stringify([{ book_id: b3.id, quantity: 1 }]), JSON.stringify(SHIP)])).rows[0].id;
  check('online order waits for payment with no parcel yet', (await one(`select status from public.orders where id = $1`, [o3])).status === 'pending_payment' && !(await shipmentOf(o3)));
  await as(ADMIN, `select public.admin_set_order_status($1, 'paid')`, [o3]);
  check('marking it paid queues its parcel', (await shipmentOf(o3))?.status === 'queued');
  await as(ADMIN, `select public.admin_set_order_status($1, 'cancelled')`, [o3]);
  check('cancelling before booking drops the parcel', (await shipmentOf(o3)).status === 'cancelled');

  // ---------- Returned to sender ----------
  const o4 = await placeCod(b3.id, 1);
  const s4 = await shipmentOf(o4);
  await db.query(`update public.shipments set book_after = now() - interval '1 minute' where id = $1`, [s4.id]);
  await as(SERVICE, `select * from public.claim_due_shipments(10)`);
  await as(SERVICE, `select public.record_booking($1, $2::jsonb)`, [s4.id, JSON.stringify({ ...booking, awb_number: '14344940342225' })]);
  await as(SERVICE, `select public.record_tracking($1, 'in_transit', 'in transit', '[]'::jsonb)`, [s4.id]);
  await as(SERVICE, `select public.record_tracking($1, 'rto', 'rto delivered', '[]'::jsonb)`, [s4.id]);
  const stockRto = await stockOf(b3.id);
  await as(ADMIN, `select public.admin_set_order_status($1, 'cancelled')`, [o4]);
  check('a parcel returned to us lets the admin cancel the order and restock', (await one(`select status from public.orders where id = $1`, [o4])).status === 'cancelled' && (await stockOf(b3.id)) === stockRto + 1);

  // ---------- Rate limits ----------
  const hits = [];
  for (let i = 0; i < 4; i++) hits.push((await as(SERVICE, `select public.hit_rate_limit('pin:test', 3, 3600) as ok`)).rows[0].ok);
  check('rate limit allows 3 then refuses the 4th', JSON.stringify(hits) === '[true,true,true,false]', JSON.stringify(hits));

  // ---------- One live parcel per order ----------
  const dup = await fails(SERVICE, `insert into public.shipments (order_id, kind) values ($1, 'forward')`, [o2]);
  check('an order cannot have two live parcels', dup !== null);
} finally {
  await db.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
