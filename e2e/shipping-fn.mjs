// Checks for the `shipping` Edge Function, run in Node with no real network calls:
// the database is the real supabase/schema.sql in PGlite behind a local fake Supabase
// API, and Xpressbees is a local fake server answering like the documented API.
// Run: node e2e/shipping-fn.mjs

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { asRole, createBackend, fetchPublicBooks, handleAuth, handleRest, sessionFor, SERVICE_TOKEN, USERS } from './fake-supabase.mjs';
import { createHandler } from '../supabase/functions/shipping/handler.js';
import { createXpressbees } from '../supabase/functions/shipping/xpressbees.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${String(detail).slice(0, 300)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Fake Supabase over HTTP ----------
const db = await createBackend({ schemaPath: path.join(ROOT, 'supabase', 'schema.sql'), books: await fetchPublicBooks(path.join(ROOT, '.env.local')) });
const readBody = (req) => new Promise((resolve) => {
  let s = '';
  req.on('data', (c) => (s += c));
  req.on('end', () => resolve(s));
});
const supa = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const body = await readBody(req);
  const input = { method: req.method, url, headers: req.headers, body };
  const r = url.pathname.startsWith('/rest/v1/') ? await handleRest(db, input) : handleAuth(input);
  res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers || {}) });
  res.end(r.body ?? '');
});
await new Promise((r) => supa.listen(0, r));
const SUPA_URL = `http://localhost:${supa.address().port}`;

// ---------- Fake Xpressbees ----------
const XB = { logins: 0, calls: [], books: [], cancels: [], mode: {}, trackStatus: 'in transit' };
const COURIERS = [
  { id: '6', name: 'Air Xpressbees 0.5 K.G', freight_charges: 63, cod_charges: 40, total_charges: 103 },
  { id: '8', name: 'Express Reverse', freight_charges: 10, cod_charges: 0, total_charges: 10 },
  { id: '1', name: 'Surface Xpressbees 0.5 K.G', freight_charges: 50, cod_charges: 40, total_charges: 90 },
  { id: '2', name: 'Xpressbees 2 K.G', freight_charges: 70, cod_charges: 40, total_charges: 110 },
];
const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 10800 })).toString('base64url') + '.sig';
let awbSeq = 14344940342223;
const xbServer = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const json = body ? JSON.parse(body) : null;
  const send = (status, value) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  const sendHtml = (status, html) => {
    res.writeHead(status, { 'content-type': 'text/html' });
    res.end(html);
  };
  const p = new URL(req.url, 'http://x').pathname;
  XB.calls.push(p);
  if (XB.mode.slow) await sleep(600);
  if (p === '/api/users/login') {
    XB.logins += 1;
    if (json?.email !== 'ops@example.com' || json?.password !== 'correct-horse') return send(401, { status: false, message: 'Invalid email or password' });
    return send(200, { status: true, data: TOKEN });
  }
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${TOKEN}`) return send(401, { status: false, message: 'Unauthorized' });
  if (XB.mode.down) return send(503, { status: false, message: 'Service unavailable' });
  if (p === '/api/courier') return send(200, { status: true, data: COURIERS.map(({ id, name }) => ({ id, name })) });
  if (p === '/api/courier/serviceability') {
    if (json.destination === '799999') return send(200, { status: true, data: [] });
    if (json.destination === '799998' && json.payment_type === 'cod') return send(200, { status: true, data: [] });
    return send(200, { status: true, data: COURIERS });
  }
  if (p === '/api/shipments2') {
    XB.books.push(json);
    if (XB.mode.duplicate) return send(400, { status: false, message: 'Order number already exists' });
    // The refusal shapes seen from Xpressbees-style APIs.
    if (XB.mode.refuse?.has(json.courier_id)) return send(404, { status: false, message: '' });
    if (XB.mode.htmlNotFound) return sendHtml(404, '<html><head><title>404 Not Found</title></head><body><h1>Not Found</h1></body></html>');
    if (XB.mode.badWarehouse) return send(422, { message: 'The given data was invalid.', errors: { 'pickup.warehouse_name': ['The selected pickup.warehouse_name is invalid.'] } });
    if (XB.mode.wallet) return send(200, { status: false, message: 'Wallet balance is low.' });
    if (XB.mode.echoPhone) return send(400, { status: false, error: `Invalid consignee phone ${json.consignee.phone} for ops@example.com` });
    const awb = String(awbSeq++);
    return send(200, {
      status: true,
      data: {
        order_id: 19177931, shipment_id: 9590285, awb_number: awb, courier_id: json.courier_id, courier_name: 'Surface Xpressbees 0.5 K.G', status: 'booked',
        label: XB.mode.evilLabel ? 'https://evil.example.com/label.pdf' : 'https://xb-files.s3.amazonaws.com/labels/20240209185649-80.pdf',
        manifest: 'https://xb-files.s3.amazonaws.com/manifest/20240209185649-34.pdf',
      },
    });
  }
  if (p === '/api/reverseshipments') {
    XB.lastReturn = json;
    return send(200, { status: true, data: { order_id: 1, shipment_id: 2, awb_number: String(awbSeq++), courier_id: '8', courier_name: 'Express Reverse', status: 'booked', label: 'https://xb-files.s3.amazonaws.com/labels/r.pdf' } });
  }
  if (p.startsWith('/api/shipments2/track/')) {
    if (XB.mode.trackEmpty) return send(200, { status: false, message: 'No record found' });
    return send(200, { status: true, data: { awb_number: p.split('/').pop(), status: XB.trackStatus, history: [{ status_code: 'IT', location: 'Udaipur <script>', event_time: '2026-11-10 10:00', message: 'In Transit' }] } });
  }
  if (p === '/api/shipments2/cancel') {
    XB.cancels.push(json.awb);
    return send(200, { status: true, message: 'Shipment Cancelled' });
  }
  if (p === '/api/shipments2/manifest') {
    return send(200, { status: true, data: XB.mode.evilManifest ? 'https://evil.example.com/m.pdf' : 'https://xb-files.s3.amazonaws.com/manifest/20240210112211-26.pdf' });
  }
  if (p === '/api/ndr') {
    if (XB.mode.ndrEmpty) return send(200, { status: false, message: 'No record found' });
    return send(200, { status: true, data: [...XB.ndr, { awb_number: '99999999999', event_date: '2026-11-10', courier_remarks: 'Not ours', total_attempts: '1' }] });
  }
  if (p === '/api/ndr/create') {
    XB.lastNdr = json;
    return send(200, json.map((i) => ({ status: true, awb: i.awb, message: 'NDR Submitted Successfully' })));
  }
  return send(404, { status: false, message: 'Not found' });
});
await new Promise((r) => xbServer.listen(0, r));
const XB_URL = `http://localhost:${xbServer.address().port}`;
XB.ndr = [];

// ---------- The function under test ----------
const logs = [];
const log = { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) };
const service = createClient(SUPA_URL, SERVICE_TOKEN, { auth: { persistSession: false, autoRefreshToken: false } });
const tokenStore = {
  async get() {
    const { data } = await service.rpc('xb_token_get');
    return Array.isArray(data) && data[0]?.token ? data[0].token : null;
  },
  async set(token, expiresAt) {
    await service.rpc('xb_token_set', { p_token: token, p_expires_at: expiresAt.toISOString() });
  },
};
const CRON = 'cron-secret-for-tests-0123456789abcdef';
const ORIGIN = 'https://kitaabaurkona.vercel.app';
const handle = createHandler({
  db: service,
  cronSecret: CRON,
  allowedOrigins: [ORIGIN, 'http://localhost:5199'],
  log,
  makeXpressbees: () => createXpressbees({ baseUrl: XB_URL, email: 'ops@example.com', password: 'correct-horse', tokenStore, timeoutMs: 400, log }),
});

const reader = sessionFor('reader@example.com').access_token;
const admin = sessionFor('admin@example.com').access_token;
async function call(body, { token, origin = ORIGIN, method = 'POST', headers = {}, raw } = {}) {
  const req = new Request('http://fn.local/shipping', {
    method,
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined,
  });
  const res = await handle(req);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, headers: res.headers };
}
const cron = (job) => call({ action: 'run_job', job }, { origin: null, headers: { 'x-cron-secret': CRON } });

const READER = { role: 'authenticated', sub: USERS['reader@example.com'].id };
const SHIP = { name: 'Asha Rao', phone: '9876543210', address: '12 MG Road, Near City Palace', city: 'Udaipur', state: 'Rajasthan', pincode: '313001' };
const books = (await db.query(`select id from public.books where is_visible and stock_quantity >= 5 order by id limit 5`)).rows.map((r) => r.id);
async function placeCod(bookId, qty = 1) {
  const r = await asRole(db, READER, (tx) => tx.query(`select public.create_order($1::jsonb, $2::jsonb, 'cod') as id`, [JSON.stringify([{ book_id: bookId, quantity: qty }]), JSON.stringify(SHIP)]));
  const id = r.rows[0].id;
  await db.query(`update public.shipments set book_after = now() - interval '1 minute' where order_id = $1`, [id]);
  return id;
}
const shipmentOf = async (orderId, kind = 'forward') =>
  (await db.query(`select * from public.shipments where order_id = $1 and kind = $2 order by created_at desc limit 1`, [orderId, kind])).rows[0];
const orderStatus = async (id) => (await db.query(`select status from public.orders where id = $1`, [id])).rows[0].status;

try {
  // ---------- Requests that never get in ----------
  check('preflight from the store is allowed', (await call(null, { method: 'OPTIONS' })).status === 204);
  check('preflight from another site is refused', (await call(null, { method: 'OPTIONS', origin: 'https://evil.example.com' })).status === 403);
  check('a POST from another site is refused', (await call({ action: 'check_pincode', pincode: '313001' }, { token: reader, origin: 'https://evil.example.com' })).status === 403);
  check('GET is not allowed', (await call(null, { method: 'GET' })).status === 405);
  check('a body over 32 KB is refused', (await call(null, { token: reader, raw: JSON.stringify({ action: 'check_pincode', pincode: '313001', pad: 'x'.repeat(40000) }) })).status === 413);
  check('broken JSON is refused', (await call(null, { token: reader, raw: '{nope' })).status === 400);
  check('unknown actions are refused', (await call({ action: 'drop_tables' }, { token: reader })).status === 400);
  check('unexpected fields are refused', (await call({ action: 'check_pincode', pincode: '313001', origin: '110001' }, { token: reader })).status === 400);
  check('a bad PIN code is refused', (await call({ action: 'check_pincode', pincode: '012345' }, { token: reader })).status === 400);
  check('signed-out callers are refused', (await call({ action: 'check_pincode', pincode: '313001' })).status === 401);
  check('a forged token is refused', (await call({ action: 'check_pincode', pincode: '313001' }, { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad' })).status === 401);
  check('customers cannot use admin actions', (await call({ action: 'ndr_list' }, { token: reader })).status === 403);
  check('jobs without the cron secret are refused', (await call({ action: 'run_job', job: 'book_due' }, { token: admin })).status === 401);
  check('jobs with a wrong cron secret are refused', (await call({ action: 'run_job', job: 'book_due' }, { origin: null, headers: { 'x-cron-secret': 'guess' } })).status === 401);
  check('responses carry no-store and CORS for the store only', (await call({ action: 'check_pincode', pincode: '313001' }, { token: reader })).headers.get('access-control-allow-origin') === ORIGIN);
  check('nothing reached Xpressbees so far except one PIN check', XB.calls.every((c) => c === '/api/users/login' || c === '/api/courier/serviceability'));

  // ---------- PIN check ----------
  const ok = await call({ action: 'check_pincode', pincode: '313001' }, { token: reader });
  check('PIN check: deliverable with cash on delivery', ok.status === 200 && ok.json.data.deliverable === true && ok.json.data.cod === true, JSON.stringify(ok.json));
  const no = await call({ action: 'check_pincode', pincode: '799999' }, { token: reader });
  check('PIN check: a PIN no courier serves is not deliverable', no.json?.data?.deliverable === false && no.json.data.cod === false);
  const prepaidOnly = await call({ action: 'check_pincode', pincode: '799998' }, { token: reader });
  check('PIN check: deliverable but without COD', prepaidOnly.json?.data?.deliverable === true && prepaidOnly.json.data.cod === false);
  const callsBefore = XB.calls.length;
  await call({ action: 'check_pincode', pincode: '313001' }, { token: reader });
  check('PIN check answers are cached', XB.calls.length === callsBefore);
  check('one login is reused across requests', XB.logins === 1, XB.logins);
  let limited = 0;
  for (let i = 0; i < 20; i++) if ((await call({ action: 'check_pincode', pincode: '313001' }, { token: reader })).status === 429) limited += 1;
  check('PIN checks are rate limited per customer', limited > 0, limited);

  // ---------- Expired token: logs in again once ----------
  await db.query(`update public.integration_tokens set token = 'stale-token'`);
  await db.query(`delete from public.rate_limits`);
  await db.query(`delete from public.pincode_checks`);
  const relog = await call({ action: 'check_pincode', pincode: '313001' }, { token: reader });
  check('an expired Xpressbees session logs in again by itself', relog.status === 200 && XB.logins === 2, `${relog.status} ${XB.logins}`);

  // ---------- Automatic booking ----------
  const o1 = await placeCod(books[0], 2);
  let job = await cron('book_due');
  check('no booking until the warehouse name is set', job.json?.data?.claimed === 0 && XB.books.length === 0, JSON.stringify(job.json));
  await db.query(`update public.shipping_settings set warehouse_name = 'Kitaabaurkona Udaipur'`);
  job = await cron('book_due');
  const s1 = await shipmentOf(o1);
  check('a due COD parcel is booked automatically', job.json?.data?.booked === 1 && s1.status === 'booked' && /^\d+$/.test(s1.awb_number), JSON.stringify(job.json));
  const sent = XB.books.at(-1);
  const order1 = (await db.query(`select order_number, subtotal from public.orders where id = $1`, [o1])).rows[0];
  check('booking uses our order number and refuses duplicates', sent.order_number === `KAK-${order1.order_number}` && sent.unique_order_number === 'yes');
  check('booking is cash on delivery for the order total', sent.payment_type === 'cod' && sent.collectable_amount === String(Number(order1.subtotal)) && sent.order_amount === Number(order1.subtotal));
  check('free shipping: no shipping or COD charge to the customer', sent.shipping_charges === 0 && sent.cod_charges === 0);
  check('the cheapest forward courier is chosen (not the reverse one)', sent.courier_id === '1' && s1.courier_id === '1' && Number(s1.total_charges) === 90);
  check('pickup is the configured warehouse', sent.pickup.warehouse_name === 'Kitaabaurkona Udaipur' && sent.pickup.pincode === '313002');
  check('consignee comes from the order', sent.consignee.pincode === '313001' && sent.consignee.phone === '9876543210');
  check('parcel weight is worked out from the books', sent.package_weight > 0 && s1.package_weight_g === sent.package_weight);
  check('label and manifest links are saved', s1.label_url?.startsWith('https://xb-files.s3.amazonaws.com/'));
  check('booking is logged', (await db.query(`select 1 from public.shipment_events where order_id = $1 and action = 'booked'`, [o1])).rows.length === 1);

  // ---------- Booking failures ----------
  XB.mode.down = true;
  const o2 = await placeCod(books[1], 1);
  await cron('book_due');
  const s2 = await shipmentOf(o2);
  check('Xpressbees down: the parcel is retried later', s2.status === 'queued' && s2.next_attempt_at !== null && /unavailable/i.test(s2.last_error));
  XB.mode.down = false;
  XB.mode.duplicate = true;
  await db.query(`update public.shipments set next_attempt_at = now() - interval '1 second' where id = $1`, [s2.id]);
  await cron('book_due');
  check('a refused booking (duplicate order number) waits for an admin', (await shipmentOf(o2)).status === 'failed');
  XB.mode.duplicate = false;
  XB.mode.evilLabel = true;
  const retry = await call({ action: 'book_now', order_id: o2 }, { token: admin });
  const s2b = await shipmentOf(o2);
  check('admin "Book now" books a failed parcel', retry.status === 200 && s2b.status === 'booked', JSON.stringify(retry.json));
  check('a label link from another host is never saved', s2b.label_url === null);
  check('a set-aside label link is logged with its host only', logs.some((l) => /"event":"file_link_set_aside".*"field":"label","host":"evil.example.com"/.test(l)) && !logs.some((l) => l.includes('evil.example.com/label.pdf')));
  XB.mode.evilLabel = false;
  check('booking the same parcel twice is refused', (await call({ action: 'book_now', order_id: o2 }, { token: admin })).status === 409);
  XB.mode.slow = true;
  const o3 = await placeCod(books[2], 1);
  await cron('book_due');
  check('a slow Xpressbees times out and is retried later', (await shipmentOf(o3)).status === 'queued' && /time/i.test((await shipmentOf(o3)).last_error ?? ''));
  XB.mode.slow = false;

  // ---------- Refusals: the real reason is kept, another courier is tried ----------
  const lastError = async (orderId) => (await shipmentOf(orderId)).last_error ?? '';
  const booksBefore = () => XB.books.length;

  XB.mode.refuse = new Set(['1']);
  const oA = await placeCod(books[0], 1);
  let n0 = booksBefore();
  await cron('book_due');
  const sA = await shipmentOf(oA);
  check('a courier refused with a bare 404: the next cheapest is booked at once', sA.status === 'booked' && sA.courier_id === '6' && XB.books.length - n0 === 2, `${sA.status} ${sA.courier_id} ${sA.last_error}`);
  const refusedEvent = (await db.query(`select detail from public.shipment_events where order_id = $1 and action = 'courier_refused'`, [oA])).rows[0]?.detail ?? '';
  check('the refused courier and the reason are written down', /Surface Xpressbees 0\.5 K\.G: HTTP 404, Xpressbees gave no reason/.test(refusedEvent), refusedEvent);

  XB.mode.refuse = new Set(['1', '6', '2']);
  const oB = await placeCod(books[1], 1);
  n0 = booksBefore();
  await cron('book_due');
  const eB = await lastError(oB);
  check('every courier refused: the parcel fails after 3 couriers, naming them', (await shipmentOf(oB)).status === 'failed' && XB.books.length - n0 === 3 && /HTTP 404/.test(eB) && /Surface Xpressbees 0\.5 K\.G/.test(eB) && /Air Xpressbees/.test(eB), eB);
  XB.mode.refuse = null;

  XB.mode.htmlNotFound = true;
  const oC = await placeCod(books[2], 1);
  await cron('book_due');
  const eC = await lastError(oC);
  check('an HTML 404 page: the status and page title are kept', /HTTP 404/.test(eC) && /404 Not Found/.test(eC) && !/<title>|<h1>/.test(eC), eC);
  XB.mode.htmlNotFound = false;

  XB.mode.badWarehouse = true;
  const oD = await placeCod(books[3], 1);
  n0 = booksBefore();
  await cron('book_due');
  const eD = await lastError(oD);
  check('a wrong warehouse name: the field-by-field reason is shown, and no other courier is tried', /HTTP 422/.test(eD) && /pickup\.warehouse_name: The selected pickup\.warehouse_name is invalid/.test(eD) && XB.books.length - n0 === 1, eD);
  XB.mode.badWarehouse = false;

  XB.mode.wallet = true;
  const oE = await placeCod(books[4], 1);
  n0 = booksBefore();
  await cron('book_due');
  const eE = await lastError(oE);
  check("low wallet balance: stops at once with Xpressbees' words", eE === 'Booking refused: Wallet balance is low.' && XB.books.length - n0 === 1 && (await shipmentOf(oE)).status === 'failed', eE);
  XB.mode.wallet = false;
  const retryE = await call({ action: 'book_now', order_id: oE }, { token: admin });
  check('after the wallet is topped up, admin Retry books it', retryE.status === 200 && (await shipmentOf(oE)).status === 'booked', JSON.stringify(retryE.json));

  XB.mode.echoPhone = true;
  const oF = await placeCod(books[0], 1);
  await cron('book_due');
  const eF = await lastError(oF);
  check('a refusal that echoes the phone or email keeps neither', /\[phone\]/.test(eF) && /\[email\]/.test(eF) && !/9876543210|ops@example\.com/.test(eF), eF);
  XB.mode.echoPhone = false;
  check(
    'every refusal is logged with its path, status and reason',
    logs.some((l) => /"event":"xpressbees_refused","path":"\/api\/shipments2","status":404,"reason":"404 Not Found"/.test(l)),
    logs.filter((l) => /xpressbees_refused/.test(l)).slice(0, 2).join(' | '),
  );

  // ---------- Tracking ----------
  const other = sessionFor('admin@example.com');
  const tr = await call({ action: 'track', order_id: o1 }, { token: reader });
  check('customer tracks their own order', tr.status === 200 && tr.json.data.shipments[0].status === 'in_transit');
  check('tracking hides labels, charges and errors from customers', tr.json && !('label_url' in tr.json.data.shipments[0]) && !('total_charges' in tr.json.data.shipments[0]));
  check('tracking history is cleaned (no markup)', !JSON.stringify(tr.json.data.shipments[0].history).includes('<script>'));
  check('picked up: the order shows as shipped', (await orderStatus(o1)) === 'shipped');
  const trackCalls = XB.calls.filter((c) => c.includes('/track/')).length;
  await call({ action: 'track', order_id: o1 }, { token: reader });
  check('tracking is not asked again within 2 minutes', XB.calls.filter((c) => c.includes('/track/')).length === trackCalls);
  const randomOrder = '9d1c3b5e-4a7f-4c2b-8e6d-1f2a3b4c5d6e';
  check('tracking an order that is not yours finds nothing', (await call({ action: 'track', order_id: randomOrder }, { token: reader })).status === 404);
  check('admins can track any order', (await call({ action: 'track', order_id: o1 }, { token: other.access_token })).status === 200);
  XB.trackStatus = 'Delivered';
  await db.query(`update public.shipments set last_tracked_at = now() - interval '3 hours' where order_id = $1`, [o1]);
  const bg = await cron('track_active');
  check('the background job refreshes tracking', bg.json?.data?.checked >= 1);
  const health = await cron('health');
  check('the health job confirms the Xpressbees connection', health.json?.data?.connected === true && health.json.data.couriers === COURIERS.length, JSON.stringify(health.json));
  check('the health job needs the cron secret', (await call({ action: 'run_job', job: 'health' }, { token: admin })).status === 401);
  check('delivered: the order becomes delivered', (await orderStatus(o1)) === 'delivered');
  XB.trackStatus = 'in transit';

  // ---------- Cancelling a booked parcel ----------
  const o4 = await placeCod(books[3], 1);
  await cron('book_due');
  const s4 = await shipmentOf(o4);
  await asRole(db, READER, (tx) => tx.query(`select public.cancel_order($1)`, [o4]));
  check('customer cancels: the parcel is marked for cancellation', (await shipmentOf(o4)).status === 'cancel_requested');
  await cron('cancel_requested');
  check('the job cancels it with Xpressbees', XB.cancels.includes(s4.awb_number) && (await shipmentOf(o4)).status === 'cancelled');

  // ---------- Admin tools ----------
  const o5 = await placeCod(books[4], 1);
  const rates = await call({ action: 'rates', order_id: o5 }, { token: admin });
  check('rates list couriers cheapest first, without reverse couriers', rates.status === 200 && rates.json.data.couriers[0].id === '1' && !rates.json.data.couriers.some((c) => /reverse/i.test(c.name)));
  check('choosing a courier that is not offered is refused', (await call({ action: 'set_courier', order_id: o5, courier_id: '999' }, { token: admin })).status === 400);
  const setC = await call({ action: 'set_courier', order_id: o5, courier_id: '2' }, { token: admin });
  check('admin can choose another courier before booking', setC.status === 200 && (await shipmentOf(o5)).courier_id === '2');
  await call({ action: 'book_now', order_id: o5 }, { token: admin });
  check('the chosen courier is used for booking', XB.books.at(-1).courier_id === '2');
  const man = await call({ action: 'manifest', order_ids: [o5, o4] }, { token: admin });
  check('manifest for booked parcels', man.status === 200 && man.json.data.url.startsWith('https://xb-files.s3.amazonaws.com/') && man.json.data.count === 1, JSON.stringify(man.json));
  XB.mode.evilManifest = true;
  check('a manifest link from another host is refused', (await call({ action: 'manifest', order_ids: [o5] }, { token: admin })).status === 502);
  XB.mode.evilManifest = false;
  const s5 = await shipmentOf(o5);
  XB.ndr = [{ awb_number: s5.awb_number, event_date: '2026-11-10', courier_remarks: 'Customer not available', total_attempts: '1' }];
  XB.mode.ndrEmpty = true;
  const ndrNone = await call({ action: 'ndr_list' }, { token: admin });
  check('no failed deliveries ("No record found") is an empty list, not an error', ndrNone.status === 200 && Array.isArray(ndrNone.json.data.items) && ndrNone.json.data.items.length === 0, JSON.stringify(ndrNone.json));
  XB.mode.ndrEmpty = false;
  XB.mode.trackEmpty = true;
  await db.query(`update public.shipments set last_tracked_at = null where order_id = $1 and kind = 'forward'`, [o5]);
  const trEmpty = await call({ action: 'track', order_id: o5 }, { token: admin });
  check('a parcel with no tracking events yet keeps its status quietly', trEmpty.status === 200 && trEmpty.json.data.shipments[0].status === 'booked', JSON.stringify(trEmpty.json));
  XB.mode.trackEmpty = false;
  const ndr = await call({ action: 'ndr_list' }, { token: admin });
  check('NDR list shows only our parcels, with the order', ndr.status === 200 && ndr.json.data.items.length === 1 && ndr.json.data.items[0].awb === s5.awb_number);
  const today = new Date().toISOString().slice(0, 10);
  const act = await call({ action: 'ndr_action', items: [{ awb: s5.awb_number, action: 're-attempt', action_data: { re_attempt_date: today } }] }, { token: admin });
  check('NDR re-attempt is sent for our parcel', act.status === 200 && XB.lastNdr?.[0]?.awb === s5.awb_number);
  check('NDR actions on parcels that are not ours are refused', (await call({ action: 'ndr_action', items: [{ awb: '99999999999', action: 're-attempt', action_data: { re_attempt_date: today } }] }, { token: admin })).status === 400);
  check('NDR re-attempt dates far ahead are refused', (await call({ action: 'ndr_action', items: [{ awb: s5.awb_number, action: 're-attempt', action_data: { re_attempt_date: '2099-01-01' } }] }, { token: admin })).status === 400);
  check('NDR phone changes must be valid mobiles', (await call({ action: 'ndr_action', items: [{ awb: s5.awb_number, action: 'change_phone', action_data: { phone: '12345' } }] }, { token: admin })).status === 400);

  // ---------- Return pickup ----------
  check('a return needs a delivered order', (await call({ action: 'return_pickup', order_id: o5 }, { token: admin })).status >= 400);
  const ret = await call({ action: 'return_pickup', order_id: o1 }, { token: admin });
  const r1 = await shipmentOf(o1, 'reverse');
  check('return pickup is booked for a delivered order', ret.status === 200 && r1.status === 'booked' && XB.lastReturn.consignee.pincode === '313001' && XB.lastReturn.pickup.warehouse_name === 'Kitaabaurkona Udaipur');

  // ---------- Errors and logs ----------
  XB.mode.down = true;
  await db.query(`delete from public.pincode_checks`);
  const down = await call({ action: 'check_pincode', pincode: '560001' }, { token: admin });
  check('when Xpressbees is down customers get a plain message', down.status === 502 && !/503|unavailable/i.test(down.json.error) && down.json.ref);
  XB.mode.down = false;
  const all = logs.join('\n');
  check('logs never contain the password, token, phone numbers or emails', !all.includes('correct-horse') && !all.includes(TOKEN) && !/9876543210|@example\.com/.test(all));
  check('the Xpressbees token is stored only in the service-only table', (await db.query(`select count(*)::int as n from public.integration_tokens`)).rows[0].n === 1);
} finally {
  if (process.env.SHOW_LOGS) console.log(logs.filter((l) => /"ok":false/.test(l)).slice(0, 8).join('\n'));
  supa.close();
  xbServer.close();
  await db.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
