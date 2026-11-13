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
import { createDelhivery, labelUrl } from '../supabase/functions/shipping/delhivery.js';
import { dlvText, mapDelhiveryStatus } from '../supabase/functions/shipping/delhivery-shipping.js';

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
    if (XB.mode.refuseClearly?.has(json.courier_id)) return send(200, { status: false, message: 'Selected courier is not available for this pincode' });
    if (XB.mode.slowBook) await sleep(600);
    if (XB.mode.bookDown) return send(503, { status: false, message: 'Service unavailable' });
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

// ---------- Fake Delhivery (answers shaped like the live API's) ----------
const DL_TOKEN = 'dlv-test-token-0123456789abcdef01234567';
const DL = { calls: [], books: [], cancels: [], pickups: [], ndr: [], registrations: [], warehouses: new Set(['Kitaabaurkona DL']), mode: {}, track: { StatusType: 'UD', Status: 'In Transit', StatusCode: 'X-PPOM' } };
let wbSeq = 5021310000001;
const dlServer = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  DL.calls.push(p);
  const send = (status, value) => {
    res.writeHead(status, { 'content-type': typeof value === 'string' ? 'text/html' : 'application/json' });
    res.end(typeof value === 'string' ? value : JSON.stringify(value));
  };
  if (req.headers.authorization !== `Token ${DL_TOKEN}`) {
    res.writeHead(401, { 'content-type': 'text/plain' });
    return res.end('Login or API Key Required');
  }
  if (DL.mode.down) return send(503, '<html><title>503 Service Unavailable</title></html>');
  if (p === '/c/api/pin-codes/json/') {
    const pin = url.searchParams.get('filter_codes');
    if (pin === '799999') return send(200, { delivery_codes: [] });
    const remarks = pin === '799997' ? 'Embargo' : '';
    return send(200, { delivery_codes: [{ postal_code: { pin: Number(pin), cod: pin === '799996' ? 'N' : 'Y', pre_paid: 'Y', cash: 'Y', pickup: 'Y', remarks, district: 'Udaipur' } }] });
  }
  if (p === '/api/kinko/v1/invoice/charges/.json') {
    DL.lastRate = Object.fromEntries(url.searchParams);
    if (DL.mode.noRates) return send(400, {});
    const cod = url.searchParams.get('pt') === 'COD' ? 40 : 0;
    return send(200, [{ status: 'Delivered', charge_COD: cod, total_amount: url.searchParams.get('md') === 'S' ? 116.14 : 140.5 }]);
  }
  if (p === '/api/cmu/create.json') {
    DL.contentType = req.headers['content-type'];
    const form = new URLSearchParams(body);
    const data = JSON.parse(form.get('data'));
    DL.books.push({ format: form.get('format'), data });
    const sh = data.shipments[0];
    const base = { cash_pickups_count: 0, package_count: 0, upload_wbn: 'UPL5504163861590512101', replacement_count: 0, pickups_count: 0, cash_pickups: 0, cod_count: 0, prepaid_count: 0, cod_amount: 0 };
    if (DL.mode.duplicate) return send(200, { ...base, success: false, rmk: '', packages: [{ status: 'Fail', waybill: '', refnum: sh.order, client: 'KITAAB', remarks: ['Duplicate order id'], payment: sh.payment_mode }] });
    // As the live API answered on 2026-11-13 for a name that is not registered.
    if (!DL.warehouses.has(data.pickup_location?.name)) return send(200, { ...base, success: false, error: true, rmk: 'ClientWarehouse matching query does not exist.', packages: [] });
    if (DL.mode.internal) return send(200, { ...base, success: false, error: true, rmk: 'An internal Error has occurred, Please get in touch with client.support@delhivery.com', packages: [] });
    if (DL.mode.bookDown) return send(502, '<html><title>502 Bad Gateway</title></html>');
    if (DL.mode.slowBook) await sleep(600);
    return send(200, { ...base, success: true, package_count: 1, packages: [{ status: 'Success', waybill: String(wbSeq++), refnum: sh.order, client: 'KITAAB', remarks: [], cod_amount: sh.cod_amount, payment: sh.payment_mode }] });
  }
  if (p === '/api/v1/packages/json/') {
    if (DL.mode.trackEmpty) return send(200, { Success: false, Error: 'Data does not exists for provided Waybill(s)' });
    const scan = (Scan, at, Instructions, StatusCode, ScannedLocation) => ({ ScanDetail: { Scan, ScanDateTime: at, ScannedLocation, Instructions, StatusCode, ScanType: 'UD' } });
    return send(200, {
      ShipmentData: [{ Shipment: { AWB: url.searchParams.get('waybill'), Status: { ...DL.track, StatusDateTime: '2026-11-12T12:00:00' }, Scans: [
        scan('Manifested', '2026-11-12T10:00:00', 'Manifest uploaded', 'X-UCI', 'Udaipur <script>'),
        scan(DL.track.Status, '2026-11-12T12:00:00', 'Latest scan', DL.track.StatusCode, 'Udaipur_DC (Rajasthan)'),
      ] } }],
    });
  }
  if (p === '/api/p/edit') {
    const j = JSON.parse(body);
    DL.cancels.push(j);
    return send(200, { status: true, waybill: j.waybill, remark: 'Shipment has been cancelled', order_id: 'KAK' });
  }
  if (p === '/api/p/packing_slip') {
    return send(200, { packages: [{ wbn: url.searchParams.get('wbns'), pdf_download_link: DL.mode.evilLabel ? 'https://evil.example.com/l.pdf' : 'https://s3-ap-southeast-1.amazonaws.com/pdfs/label-1.pdf' }], packages_found: 1 });
  }
  if (p === '/fm/request/new/') {
    const j = JSON.parse(body);
    DL.pickups.push(j);
    if (!DL.warehouses.has(j.pickup_location)) return send(401, { pickup_location: 'Invalid Pickup Location ClientWarehouse matching query does not exist.' });
    return send(201, { pickup_id: 4323300, client_name: 'KITAAB', pickup_location_name: j.pickup_location, incoming_center_name: 'Udaipur_DC', pickup_time: j.pickup_time, pickup_date: j.pickup_date, expected_package_count: j.expected_package_count });
  }
  if (p === '/api/backend/clientwarehouse/create/') {
    const j = JSON.parse(body);
    DL.registrations.push(j);
    if (j.pin === '799999') return send(400, { data: { name: j.name }, success: false, error: "Pincode doesn't exist in system" });
    if (DL.warehouses.has(j.name)) return send(400, { data: { name: j.name }, success: false, error: `Client warehouse with name ${j.name} already exists` });
    DL.warehouses.add(j.name);
    return send(200, { data: { name: j.name, pincode: Number(j.pin), phone: j.phone, client: 'KITAAB', address: j.address, active: true, message: 'A new client warehouse has been created in HQ(Delhivery).' }, success: true, error: '' });
  }
  if (p === '/api/p/update') {
    DL.ndr.push(JSON.parse(body));
    return send(201, { message: 'Request submitted successfully!', request_id: 'UPL13988363159644869096' });
  }
  return send(404, {});
});
await new Promise((r) => dlServer.listen(0, r));
const DL_URL = `http://localhost:${dlServer.address().port}`;

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
  makeDelhivery: () => createDelhivery({ baseUrl: DL_URL, token: DL_TOKEN, timeoutMs: 400, log }),
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
async function placeCod(bookId, qty = 1, ship = SHIP) {
  const r = await asRole(db, READER, (tx) => tx.query(`select public.create_order($1::jsonb, $2::jsonb, 'cod') as id`, [JSON.stringify([{ book_id: bookId, quantity: qty }]), JSON.stringify(ship)]));
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

  // ---------- Refusals: clear ones move on, unclear ones stop for a check ----------
  const lastError = async (orderId) => (await shipmentOf(orderId)).last_error ?? '';
  const booksBefore = () => XB.books.length;
  const skipList = async () => (await db.query(`select skip_couriers from public.shipping_settings`)).rows[0].skip_couriers;
  const clearSkip = () => db.query(`update public.shipping_settings set skip_couriers = '{}'`);
  const eventOf = async (orderId, action) => (await db.query(`select detail from public.shipment_events where order_id = $1 and action = $2 order by created_at desc limit 1`, [orderId, action])).rows[0]?.detail ?? '';

  // A bare 404 (what Xpressbees answered while booking anyway): stop, never send again.
  XB.mode.refuse = new Set(['1']);
  const oA = await placeCod(books[0], 1);
  let n0 = booksBefore();
  await cron('book_due');
  const sA = await shipmentOf(oA);
  check('a bare 404 is not a refusal: the parcel is held for a check, not resent', sA.status === 'failed' && sA.needs_check === true && XB.books.length - n0 === 1, `${sA.status} ${sA.needs_check} ${XB.books.length - n0}`);
  check('the held parcel says what to check, with the order number', /may have booked it anyway/.test(sA.last_error) && /search KAK-\d+/.test(sA.last_error) && /HTTP 404, no reason given/.test(sA.last_error), sA.last_error);
  check('the courier that answered unclearly goes on the skip list', (await skipList()).includes('Surface Xpressbees 0.5 K.G'), JSON.stringify(await skipList()));
  await cron('book_due');
  check('the background job never resends a held parcel', XB.books.length - n0 === 1 && (await shipmentOf(oA)).status === 'failed');
  const unconfirmed = await call({ action: 'book_now', order_id: oA }, { token: admin });
  check('Retry on a held parcel needs the admin to confirm the dashboard check', unconfirmed.status === 409 && /Check the Xpressbees dashboard/.test(unconfirmed.json.error) && XB.books.length - n0 === 1, JSON.stringify(unconfirmed.json));

  // The next order skips that courier and books the next cheapest.
  const oB = await placeCod(books[1], 1);
  await cron('book_due');
  const sB = await shipmentOf(oB);
  check('the next order skips that courier and books the next cheapest', sB.status === 'booked' && sB.courier_id === '6', `${sB.status} ${sB.courier_id} ${sB.last_error}`);
  XB.mode.refuse = null;

  // The admin confirms and retries: booked, flag cleared. (The skipped courier is still skipped.)
  const confirmed = await call({ action: 'book_now', order_id: oA, checked: true }, { token: admin });
  const sA2 = await shipmentOf(oA);
  check('after confirming, Retry books it and clears the check', confirmed.status === 200 && sA2.status === 'booked' && sA2.needs_check === false && sA2.courier_id === '6', JSON.stringify(confirmed.json));

  // Linking the AWB Xpressbees did make, instead of booking again.
  XB.mode.refuse = new Set(['6']);
  const oC = await placeCod(books[2], 1);
  await cron('book_due');
  check('a second unclear answer holds that parcel too', (await shipmentOf(oC)).needs_check === true);
  XB.mode.refuse = null;
  const linked = await call({ action: 'link_awb', order_id: oC, awb: '152489860437073' }, { token: admin });
  const sC = await shipmentOf(oC);
  check('admin links the AWB found in the Xpressbees dashboard', linked.status === 200 && sC.status === 'booked' && sC.awb_number === '152489860437073' && sC.needs_check === false, JSON.stringify(linked.json));
  check('the link is written in the parcel history', /linked from the Xpressbees dashboard/.test(await eventOf(oC, 'awb_linked')));
  check('an AWB already used by another parcel cannot be linked', (await call({ action: 'link_awb', order_id: oB, awb: '152489860437073' }, { token: admin })).status === 409);
  check('linking needs a valid AWB', (await call({ action: 'link_awb', order_id: oC, awb: 'abc' }, { token: admin })).status === 400);
  check('customers cannot link AWBs', (await call({ action: 'link_awb', order_id: oC, awb: '152489860437074' }, { token: reader })).status === 403);
  await clearSkip();

  // A clear refusal of one courier (Xpressbees says no and why): the next cheapest is booked.
  XB.mode.refuseClearly = new Set(['1']);
  const oD = await placeCod(books[3], 1);
  n0 = booksBefore();
  await cron('book_due');
  const sD = await shipmentOf(oD);
  check('a clear refusal of one courier books the next cheapest at once', sD.status === 'booked' && sD.courier_id === '6' && XB.books.length - n0 === 2 && sD.needs_check === false, `${sD.status} ${sD.courier_id} ${sD.last_error}`);
  check('the clearly refused courier and its reason are written down', /Surface Xpressbees 0\.5 K\.G: Selected courier is not available for this pincode/.test(await eventOf(oD, 'courier_refused')), await eventOf(oD, 'courier_refused'));
  check('a clear refusal does not put the courier on the skip list', (await skipList()).length === 0);
  XB.mode.refuseClearly = null;

  // An HTML error page is unclear too.
  XB.mode.htmlNotFound = true;
  const oE = await placeCod(books[4], 1);
  n0 = booksBefore();
  await cron('book_due');
  const eE = await lastError(oE);
  check('an HTML 404 page: held for a check, page title kept, sent once', (await shipmentOf(oE)).needs_check === true && /404 Not Found/.test(eE) && !/<title>|<h1>/.test(eE) && XB.books.length - n0 === 1, eE);
  XB.mode.htmlNotFound = false;
  await clearSkip();

  // A booking that times out, or a server error on booking: may be booked, so held.
  XB.mode.slowBook = true;
  const oF = await placeCod(books[0], 1);
  n0 = booksBefore();
  await cron('book_due');
  const sF = await shipmentOf(oF);
  check('a booking that times out is held for a check, not retried', sF.status === 'failed' && sF.needs_check === true && sF.next_attempt_at === null && XB.books.length - n0 === 1, `${sF.status} ${sF.needs_check} ${sF.last_error}`);
  check('a timeout does not put the courier on the skip list', (await skipList()).length === 0);
  XB.mode.slowBook = false;
  XB.mode.bookDown = true;
  const oG = await placeCod(books[1], 1);
  await cron('book_due');
  check('a server error on booking is held for a check, not retried', (await shipmentOf(oG)).needs_check === true && (await shipmentOf(oG)).status === 'failed');
  XB.mode.bookDown = false;

  // Clear refusals that no courier would pass: stop at once.
  XB.mode.badWarehouse = true;
  const oH = await placeCod(books[2], 1);
  n0 = booksBefore();
  await cron('book_due');
  const eH = await lastError(oH);
  check('a wrong warehouse name: the field-by-field reason is shown, and no other courier is tried', /HTTP 422/.test(eH) && /pickup\.warehouse_name: The selected pickup\.warehouse_name is invalid/.test(eH) && XB.books.length - n0 === 1 && (await shipmentOf(oH)).needs_check === false, eH);
  XB.mode.badWarehouse = false;

  XB.mode.wallet = true;
  const oI = await placeCod(books[3], 1);
  n0 = booksBefore();
  await cron('book_due');
  const eI = await lastError(oI);
  check("low wallet balance: stops at once with Xpressbees' words", eI === 'Booking refused: Wallet balance is low.' && XB.books.length - n0 === 1 && (await shipmentOf(oI)).status === 'failed', eI);
  XB.mode.wallet = false;
  const retryI = await call({ action: 'book_now', order_id: oI }, { token: admin });
  check('after the wallet is topped up, admin Retry books it (no check needed)', retryI.status === 200 && (await shipmentOf(oI)).status === 'booked', JSON.stringify(retryI.json));

  XB.mode.echoPhone = true;
  const oJ = await placeCod(books[4], 1);
  await cron('book_due');
  const eJ = await lastError(oJ);
  check('a refusal that echoes the phone or email keeps neither', /\[phone\]/.test(eJ) && /\[email\]/.test(eJ) && !/9876543210|ops@example\.com/.test(eJ), eJ);
  XB.mode.echoPhone = false;
  check(
    'every refusal is logged with its path, status and reason',
    logs.some((l) => /"event":"xpressbees_refused","path":"\/api\/shipments2","status":404,"reason":"404 Not Found"/.test(l)),
    logs.filter((l) => /xpressbees_refused/.test(l)).slice(0, 2).join(' | '),
  );
  await clearSkip();

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

  // ---------- Delhivery: a separate workflow, chosen per order ----------
  const dlBooks = (await db.query(`select id from public.books where is_visible and stock_quantity >= 3 order by id offset 5 limit 14`)).rows.map((r) => r.id);
  const eventOf2 = async (orderId, action) => (await db.query(`select detail from public.shipment_events where order_id = $1 and action = $2 order by id desc limit 1`, [orderId, action])).rows[0]?.detail ?? '';
  const subtotalOf = async (id) => Number((await db.query(`select subtotal from public.orders where id = $1`, [id])).rows[0].subtotal);
  check('helpers: Delhivery text drops & # % ; and \\', dlvText('Flat #4 & 5; 100% \\ Road', 80) === 'Flat 4 and 5 100 Road', dlvText('Flat #4 & 5; 100% \\ Road', 80));
  check('helpers: label links only from Delhivery or Amazon S3 over https', labelUrl('https://s3-ap-southeast-1.amazonaws.com/x.pdf') && labelUrl('https://cdn.delhivery.com/x.pdf') && !labelUrl('http://s3.amazonaws.com/x.pdf') && !labelUrl('https://amazonaws.com.evil.example/x.pdf') && !labelUrl('https://evil.example.com/x.pdf'));
  check(
    'helpers: Delhivery statuses map to ours',
    mapDelhiveryStatus({ StatusType: 'UD', Status: 'Manifested' }) === 'booked' &&
      mapDelhiveryStatus({ StatusType: 'UD', Status: 'Not Picked' }) === 'booked' &&
      mapDelhiveryStatus({ StatusType: 'UD', Status: 'In Transit' }) === 'in_transit' &&
      mapDelhiveryStatus({ StatusType: 'UD', Status: 'Dispatched' }) === 'out_for_delivery' &&
      mapDelhiveryStatus({ StatusType: 'UD', Status: 'Pending', StatusCode: 'EOD-74' }) === 'exception' &&
      mapDelhiveryStatus({ StatusType: 'DL', Status: 'Delivered' }) === 'delivered' &&
      mapDelhiveryStatus({ StatusType: 'RT', Status: 'In Transit' }) === 'rto' &&
      mapDelhiveryStatus({ StatusType: 'DL', Status: 'RTO' }) === 'rto' &&
      mapDelhiveryStatus({ StatusType: 'UD', Status: 'Cancelled' }) === 'cancelled' &&
      mapDelhiveryStatus({ StatusType: 'XX', Status: 'Teleported' }) === null,
  );
  const wrongToken = createDelhivery({ baseUrl: DL_URL, token: 'wrong', timeoutMs: 400 });
  check('a wrong Delhivery token says to check the secret', await wrongToken.pincode('313001').then(() => false, (e) => /DELHIVERY_API_TOKEN/.test(e.message)));
  check('Delhivery is not used without its token', await (async () => { try { createDelhivery({ baseUrl: DL_URL, token: '' }); return false; } catch (e) { return /not set up/.test(e.message); } })());

  const dlCallsBefore = DL.calls.length;
  const oD1 = await placeCod(dlBooks[0], 1);
  check('new orders start with the default carrier (Xpressbees)', (await shipmentOf(oD1)).carrier === 'xpressbees');
  check('customers cannot switch carriers', (await call({ action: 'set_carrier', order_id: oD1, carrier: 'delhivery' }, { token: reader })).status === 403);
  check('an unknown carrier is refused', (await call({ action: 'set_carrier', order_id: oD1, carrier: 'bluedart' }, { token: admin })).status === 400);
  const sw = await call({ action: 'set_carrier', order_id: oD1, carrier: 'delhivery' }, { token: admin });
  check('admin moves an order to Delhivery before booking', sw.status === 200 && (await shipmentOf(oD1)).carrier === 'delhivery', JSON.stringify(sw.json));
  check('the switch is logged', /Xpressbees -> Delhivery/.test(await eventOf2(oD1, 'carrier_set')));
  const noWh = await call({ action: 'book_now', order_id: oD1 }, { token: admin });
  check('no Delhivery booking until its warehouse name is set', noWh.status === 409 && /Delhivery warehouse/.test(noWh.json.error) && DL.books.length === 0, JSON.stringify(noWh.json));
  await db.query(`update public.shipping_settings set delhivery_warehouse_name = 'Kitaabaurkona DL'`);
  const dlRates = await call({ action: 'rates', order_id: oD1 }, { token: admin });
  check('Delhivery rates: Surface and Express, cheapest first', dlRates.status === 200 && dlRates.json.data.carrier === 'delhivery' && dlRates.json.data.couriers.map((c) => c.id).join() === 'surface,express' && dlRates.json.data.couriers[0].total_charges === 116.14, JSON.stringify(dlRates.json));
  check('rates are asked as cash on delivery with the order amount and parcel weight', DL.lastRate.pt === 'COD' && Number(DL.lastRate.cod) === (await subtotalOf(oD1)) && Number(DL.lastRate.cgm) > 0 && DL.lastRate.o_pin === '313002');
  const xbBooksBefore = XB.books.length;
  const dlBook = await call({ action: 'book_now', order_id: oD1 }, { token: admin });
  const sD1 = await shipmentOf(oD1);
  const sentD = DL.books.at(-1);
  const shD = sentD?.data.shipments[0];
  check('admin books the order with Delhivery', dlBook.status === 200 && sD1.status === 'booked' && /^\d+$/.test(sD1.awb_number) && sD1.carrier === 'delhivery', JSON.stringify(dlBook.json));
  check('nothing was sent to Xpressbees for it', XB.books.length === xbBooksBefore);
  check('Delhivery gets format=json&data=… form-encoded', sentD.format === 'json' && /x-www-form-urlencoded/.test(DL.contentType));
  check('Delhivery booking: our order number, COD for the order total', shD.order === `KAK-${(await db.query('select order_number from public.orders where id = $1', [oD1])).rows[0].order_number}` && shD.payment_mode === 'COD' && shD.cod_amount === (await subtotalOf(oD1)) && shD.total_amount === (await subtotalOf(oD1)));
  check('Delhivery booking: customer from the order, our warehouse and return address', shD.pin === '313001' && shD.phone === '9876543210' && sentD.data.pickup_location.name === 'Kitaabaurkona DL' && shD.return_pin === '313002');
  check('Delhivery booking: weight in grams, size in cm, books HSN, Surface', shD.weight > 0 && Number.isInteger(shD.shipment_length) && shD.hsn_code === '4901' && shD.shipping_mode === 'Surface');
  check('the Delhivery parcel saves mode and cost', sD1.courier_id === 'surface' && sD1.courier_name === 'Delhivery Surface' && Number(sD1.total_charges) === 116.14 && sD1.label_url === null);
  check('Delhivery parcels cannot be switched once booked', (await call({ action: 'set_carrier', order_id: oD1, carrier: 'xpressbees' }, { token: admin })).status === 409);

  // Admin picks Express for the next one.
  const oD2 = await placeCod(dlBooks[1], 1);
  await call({ action: 'set_carrier', order_id: oD2, carrier: 'delhivery' }, { token: admin });
  check('an Xpressbees courier id is refused for a Delhivery parcel', (await call({ action: 'set_courier', order_id: oD2, courier_id: '1' }, { token: admin })).status === 400);
  const setE = await call({ action: 'set_courier', order_id: oD2, courier_id: 'express' }, { token: admin });
  check('admin can choose Delhivery Express', setE.status === 200 && (await shipmentOf(oD2)).courier_id === 'express');
  await call({ action: 'book_now', order_id: oD2 }, { token: admin });
  check('Express is used for the booking', DL.books.at(-1).data.shipments[0].shipping_mode === 'Express' && (await shipmentOf(oD2)).courier_name === 'Delhivery Express');

  // Default carrier Delhivery: booked automatically with it.
  await db.query(`update public.shipping_settings set default_carrier = 'delhivery'`);
  const oD3 = await placeCod(dlBooks[2], 1);
  check('with Delhivery as default, new orders start with Delhivery', (await shipmentOf(oD3)).carrier === 'delhivery');
  const dlJob = await cron('book_due');
  check('the automatic job books Delhivery parcels with Delhivery', dlJob.json?.data?.booked >= 1 && (await shipmentOf(oD3)).status === 'booked' && (await shipmentOf(oD3)).carrier === 'delhivery', JSON.stringify(dlJob.json));
  DL.mode.noRates = true;
  const oD4 = await placeCod(dlBooks[3], 1);
  await cron('book_due');
  check('a missing Delhivery price does not stop the booking', (await shipmentOf(oD4)).status === 'booked' && (await shipmentOf(oD4)).total_charges === null);
  DL.mode.noRates = false;

  // PIN codes Delhivery does not serve.
  const oD5 = await placeCod(dlBooks[4], 1, { ...SHIP, pincode: '799996' });
  await cron('book_due');
  const sD5 = await shipmentOf(oD5);
  check('no Delhivery COD to that PIN: fails with advice to switch, sends nothing', sD5.status === 'failed' && /switch this parcel to Xpressbees/.test(sD5.last_error) && !DL.books.some((b) => b.data.shipments[0].pin === '799996'), sD5.last_error);
  const back = await call({ action: 'set_carrier', order_id: oD5, carrier: 'xpressbees' }, { token: admin });
  const rebook = await call({ action: 'book_now', order_id: oD5 }, { token: admin });
  const sD5b = await shipmentOf(oD5);
  check('switched to Xpressbees, it books there', back.status === 200 && rebook.status === 200 && sD5b.carrier === 'xpressbees' && sD5b.status === 'booked' && /^\d+$/.test(sD5b.courier_id), JSON.stringify(rebook.json));

  // Unclear answers hold the parcel; nothing is sent twice.
  DL.mode.duplicate = true;
  const oD6 = await placeCod(dlBooks[5], 1);
  const n6 = DL.books.length;
  await cron('book_due');
  const sD6 = await shipmentOf(oD6);
  check('"Duplicate order id": held for a check, not resent', sD6.status === 'failed' && sD6.needs_check === true && DL.books.length - n6 === 1 && /already exists/.test(sD6.last_error) && /Delhivery panel/.test(sD6.last_error), sD6.last_error);
  DL.mode.duplicate = false;
  await cron('book_due');
  check('the job never resends a held Delhivery parcel', DL.books.length - n6 === 1);
  const unconfirmedD = await call({ action: 'book_now', order_id: oD6 }, { token: admin });
  check('Retry on a held Delhivery parcel needs the panel check confirmed', unconfirmedD.status === 409 && /Delhivery may already have booked/.test(unconfirmedD.json.error));
  const unconfirmedSwitch = await call({ action: 'set_carrier', order_id: oD6, carrier: 'xpressbees' }, { token: admin });
  check('switching a held parcel to the other carrier also needs that check', unconfirmedSwitch.status === 409 && (await shipmentOf(oD6)).carrier === 'delhivery');
  const linkedD = await call({ action: 'link_awb', order_id: oD6, awb: '5021319999999' }, { token: admin });
  check('admin links the AWB found in the Delhivery panel', linkedD.status === 200 && (await shipmentOf(oD6)).awb_number === '5021319999999' && (await shipmentOf(oD6)).status === 'booked' && /Delhivery panel/.test(await eventOf2(oD6, 'awb_linked')), JSON.stringify(linkedD.json));

  DL.mode.internal = true;
  const oD7 = await placeCod(dlBooks[6], 1);
  await cron('book_due');
  check('"internal error": held for a check', (await shipmentOf(oD7)).needs_check === true && (await shipmentOf(oD7)).next_attempt_at === null);
  DL.mode.internal = false;
  const confirmedSwitch = await call({ action: 'set_carrier', order_id: oD7, carrier: 'xpressbees', checked: true }, { token: admin });
  const s7 = await shipmentOf(oD7);
  check('after confirming the check, the parcel moves to Xpressbees and the hold clears', confirmedSwitch.status === 200 && s7.carrier === 'xpressbees' && s7.needs_check === false && s7.status === 'failed');

  DL.mode.bookDown = true;
  const oD8 = await placeCod(dlBooks[7], 1);
  await cron('book_due');
  check('a Delhivery server error on booking: held for a check, not retried', (await shipmentOf(oD8)).needs_check === true && (await shipmentOf(oD8)).status === 'failed');
  DL.mode.bookDown = false;
  DL.mode.slowBook = true;
  const oD9 = await placeCod(dlBooks[8], 1);
  await cron('book_due');
  check('a Delhivery booking that times out: held for a check', (await shipmentOf(oD9)).needs_check === true);
  DL.mode.slowBook = false;

  // The pickup location is not registered with Delhivery (what happened to KAK-4 on live).
  await db.query(`update public.shipping_settings set delhivery_warehouse_name = 'kitaabaurkona'`);
  const oD10 = await placeCod(dlBooks[9], 1);
  const n10 = DL.books.length;
  await cron('book_due');
  const sD10 = await shipmentOf(oD10);
  check('an unregistered pickup location: the parcel waits for an admin, nothing is resent', sD10.status === 'failed' && sD10.needs_check === false && sD10.next_attempt_at === null && DL.books.length - n10 === 1, `${sD10.status} ${sD10.needs_check}`);
  check(
    'the refusal says what is wrong and how to fix it, with the name',
    /no pickup location named "kitaabaurkona"/.test(sD10.last_error) && /case-sensitive/.test(sD10.last_error) && /Register pickup address with Delhivery/.test(sD10.last_error) && !/matching query/.test(sD10.last_error) && sD10.last_error.length < 300,
    sD10.last_error,
  );
  check('the warehouse name reaches Delhivery exactly as typed', DL.books.at(-1).data.pickup_location.name === 'kitaabaurkona');
  check('customers cannot register pickup locations', (await call({ action: 'register_warehouse' }, { token: reader })).status === 403);
  check('registration takes no input from the browser', (await call({ action: 'register_warehouse', name: 'Other' }, { token: admin })).status === 400);
  const reg = await call({ action: 'register_warehouse' }, { token: admin });
  const sentReg = DL.registrations.at(-1);
  check('admin registers the pickup address with Delhivery', reg.status === 200 && reg.json.data.created === true && reg.json.data.name === 'kitaabaurkona', JSON.stringify(reg.json));
  check(
    'the registration is built from the saved settings (address, PIN, phone, email, returns to the same place)',
    sentReg?.name === 'kitaabaurkona' && sentReg.registered_name === 'Kitaabaurkona' && sentReg.pin === '313002' && sentReg.phone === '8690965448' && sentReg.email === 'kitaabaurkona@gmail.com' &&
      sentReg.city === 'Udaipur' && sentReg.return_pin === '313002' && sentReg.return_address === sentReg.address && sentReg.return_state === 'Rajasthan' && sentReg.country === 'India',
    JSON.stringify(sentReg),
  );
  check('the registration is logged', /"kitaabaurkona" registered/.test((await db.query(`select detail from public.shipment_events where action = 'warehouse_registered' order by id desc limit 1`)).rows[0]?.detail ?? ''));
  const regAgain = await call({ action: 'register_warehouse' }, { token: admin });
  check('registering again is fine: Delhivery already has it', regAgain.status === 200 && regAgain.json.data.created === false, JSON.stringify(regAgain.json));
  const retryD10 = await call({ action: 'book_now', order_id: oD10 }, { token: admin });
  check('once registered, Retry books the parcel (no check needed)', retryD10.status === 200 && (await shipmentOf(oD10)).status === 'booked', JSON.stringify(retryD10.json));
  await db.query(`update public.shipping_settings set pickup_pincode = '799999', delhivery_warehouse_name = 'Elsewhere'`);
  const regBad = await call({ action: 'register_warehouse' }, { token: admin });
  check("a refused registration shows Delhivery's reason", regBad.status === 502 && /Pincode doesn't exist in system/.test(regBad.json.error), JSON.stringify(regBad.json));
  await db.query(`update public.shipping_settings set delhivery_warehouse_name = ''`);
  check('registration needs a warehouse name', (await call({ action: 'register_warehouse' }, { token: admin })).status === 409);
  await db.query(`update public.shipping_settings set pickup_pincode = '313002', delhivery_warehouse_name = 'Kitaabaurkona DL'`);

  // Tracking, failed deliveries, labels.
  await db.query(`update public.shipments set last_tracked_at = null where order_id = $1`, [oD1]);
  const trD = await call({ action: 'track', order_id: oD1 }, { token: reader });
  const trS = trD.json?.data?.shipments?.[0];
  check('customer tracks a Delhivery parcel', trD.status === 200 && trS.status === 'in_transit' && (await orderStatus(oD1)) === 'shipped', JSON.stringify(trD.json));
  check('Delhivery history is cleaned and newest first', trS.history[0].message === 'Latest scan' && !JSON.stringify(trS.history).includes('<script>'));
  check('customers see no Delhivery cost or label', !('total_charges' in trS) && !('label_url' in trS));
  DL.track = { StatusType: 'UD', Status: 'Pending', StatusCode: 'EOD-74' };
  await db.query(`update public.shipments set last_tracked_at = null where order_id = $1`, [oD1]);
  await cron('track_active');
  check('a failed Delhivery attempt shows as a delivery exception', (await shipmentOf(oD1)).status === 'exception');
  const ndrD = await call({ action: 'ndr_list' }, { token: admin });
  const ndrItem = ndrD.json?.data?.items?.find((i) => i.awb === sD1.awb_number);
  check('failed deliveries list Delhivery parcels next to Xpressbees ones', ndrD.status === 200 && ndrItem?.carrier === 'delhivery' && ndrItem.remarks === 'Latest scan' && ndrD.json.data.items.some((i) => i.carrier === 'xpressbees'), JSON.stringify(ndrD.json).slice(0, 300));
  const todayIn = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const later = new Date(Date.now() + 330 * 60000 + 2 * 86400000).toISOString().slice(0, 10);
  const xbNdrBefore = XB.lastNdr;
  const actD = await call({ action: 'ndr_action', items: [{ awb: sD1.awb_number, action: 're-attempt', action_data: { re_attempt_date: todayIn } }] }, { token: admin });
  check('Delhivery re-attempt today is RE-ATTEMPT, sent to Delhivery only', actD.status === 200 && DL.ndr.at(-1).data[0].act === 'RE-ATTEMPT' && XB.lastNdr === xbNdrBefore && actD.json.data.results[0].ok, JSON.stringify(actD.json));
  await call({ action: 'ndr_action', items: [{ awb: sD1.awb_number, action: 're-attempt', action_data: { re_attempt_date: later } }] }, { token: admin });
  check('a later date becomes DEFER_DLV with that date', DL.ndr.at(-1).data[0].act === 'DEFER_DLV' && DL.ndr.at(-1).data[0].action_data.deferred_date === later);
  await call({ action: 'ndr_action', items: [{ awb: sD1.awb_number, action: 'change_phone', action_data: { phone: '9123456780' } }] }, { token: admin });
  check('a new phone becomes EDIT_DETAILS', DL.ndr.at(-1).data[0].act === 'EDIT_DETAILS' && DL.ndr.at(-1).data[0].action_data.phone === '9123456780');
  const lab = await call({ action: 'label', order_id: oD2 }, { token: admin });
  check('the Delhivery label is made on request', lab.status === 200 && lab.json.data.url.startsWith('https://s3-ap-southeast-1.amazonaws.com/'), JSON.stringify(lab.json));
  DL.mode.evilLabel = true;
  check('a Delhivery label link from another host is refused', (await call({ action: 'label', order_id: oD2 }, { token: admin })).status === 502);
  DL.mode.evilLabel = false;
  check('customers cannot fetch labels', (await call({ action: 'label', order_id: oD2 }, { token: reader })).status === 403);
  check('Xpressbees labels come from the saved link', (await call({ action: 'label', order_id: o5 }, { token: admin })).json?.data?.url?.startsWith('https://xb-files.s3.amazonaws.com/'));
  check('the Xpressbees manifest leaves Delhivery parcels out', (await call({ action: 'manifest', order_ids: [oD2] }, { token: admin })).status === 400);

  // Pickup requests.
  const pick = await call({ action: 'pickup_request', date: todayIn, time: '14:00', count: 3 }, { token: admin });
  check('admin asks Delhivery for a pickup', pick.status === 200 && pick.json.data.pickup_id === '4323300' && DL.pickups.at(-1).pickup_location === 'Kitaabaurkona DL' && DL.pickups.at(-1).pickup_time === '14:00:00' && DL.pickups.at(-1).expected_package_count === 3, JSON.stringify(pick.json));
  check('the pickup request is logged', Boolean((await db.query(`select 1 from public.shipment_events where action = 'pickup_requested'`)).rows[0]));
  check('pickup requests need a valid time and count', (await call({ action: 'pickup_request', date: todayIn, time: '25:00', count: 3 }, { token: admin })).status === 400 && (await call({ action: 'pickup_request', date: todayIn, time: '14:00', count: 0 }, { token: admin })).status === 400);
  check('pickup dates far ahead are refused', (await call({ action: 'pickup_request', date: '2099-01-01', time: '14:00', count: 1 }, { token: admin })).status === 400);
  check('customers cannot request pickups', (await call({ action: 'pickup_request', date: todayIn, time: '14:00', count: 1 }, { token: reader })).status === 403);
  await db.query(`update public.shipping_settings set delhivery_warehouse_name = 'Old name'`);
  const badPick = await call({ action: 'pickup_request', date: todayIn, time: '14:00', count: 1 }, { token: admin });
  check('a pickup for an unregistered location says how to fix it, not a token error', badPick.status === 502 && /no pickup location named "Old name"/.test(badPick.json.error) && !/TOKEN/.test(badPick.json.error), JSON.stringify(badPick.json));
  await db.query(`update public.shipping_settings set delhivery_warehouse_name = 'Kitaabaurkona DL'`);

  // Cancelling, delivery and returns.
  const oD11 = await placeCod(dlBooks[10], 1);
  await cron('book_due');
  const sD11 = await shipmentOf(oD11);
  await asRole(db, READER, (tx) => tx.query(`select public.cancel_order($1)`, [oD11]));
  await cron('cancel_requested');
  check('a cancelled order is cancelled with Delhivery', DL.cancels.some((c) => c.waybill === sD11.awb_number && c.cancellation === 'true') && (await shipmentOf(oD11)).status === 'cancelled');
  DL.track = { StatusType: 'DL', Status: 'Delivered', StatusCode: 'EOD-38' };
  await db.query(`update public.shipments set last_tracked_at = null where order_id = $1`, [oD2]);
  await cron('track_active');
  check('Delhivery delivered: the order becomes delivered', (await orderStatus(oD2)) === 'delivered');
  const retD = await call({ action: 'return_pickup', order_id: oD2 }, { token: admin });
  const rD = await shipmentOf(oD2, 'reverse');
  const retSent = DL.books.at(-1).data.shipments[0];
  check('return pickup goes with Delhivery for a Delhivery order', retD.status === 200 && rD.carrier === 'delhivery' && rD.status === 'booked' && retSent.payment_mode === 'Pickup' && /-R$/.test(retSent.order) && retSent.pin === '313001', JSON.stringify(retD.json));
  DL.track = { StatusType: 'UD', Status: 'In Transit', StatusCode: 'X-PPOM' };

  // PIN check at checkout with both carriers.
  await db.query(`delete from public.pincode_checks`);
  const both = await call({ action: 'check_pincode', pincode: '799998' }, { token: admin });
  check('PIN check: Delhivery COD counts where Xpressbees has none', both.json?.data?.deliverable === true && both.json.data.cod === true, JSON.stringify(both.json));
  const noneD = await call({ action: 'check_pincode', pincode: '799999' }, { token: admin });
  check('PIN check: a PIN neither carrier serves is not deliverable', noneD.json?.data?.deliverable === false);
  const embargo = await call({ action: 'check_pincode', pincode: '799997' }, { token: admin });
  check('PIN check: a Delhivery embargo falls back to Xpressbees', embargo.json?.data?.deliverable === true);
  DL.mode.down = true;
  await db.query(`delete from public.pincode_checks`);
  const dlDown = await call({ action: 'check_pincode', pincode: '313001' }, { token: admin });
  check('PIN check: Delhivery down, Xpressbees still answers', dlDown.status === 200 && dlDown.json.data.deliverable === true);
  const dlDownNo = await call({ action: 'check_pincode', pincode: '799999' }, { token: admin });
  check('PIN check: a "no" is not trusted while Delhivery is down', dlDownNo.status === 502);
  DL.mode.down = false;
  const healthD = await cron('health');
  check('the health job checks Delhivery too', healthD.json?.data?.connected === true && healthD.json.data.delhivery?.connected === true && healthD.json.data.delhivery.warehouse_set === true, JSON.stringify(healthD.json));
  check('Delhivery is only ever called on its own host', DL.calls.length > dlCallsBefore);

  // Back to the Xpressbees-only setup for the checks below.
  await db.query(`update public.shipping_settings set default_carrier = 'xpressbees', delhivery_warehouse_name = ''`);
  await db.query(`delete from public.pincode_checks`);

  // ---------- Errors and logs ----------
  XB.mode.down = true;
  await db.query(`delete from public.pincode_checks`);
  const down = await call({ action: 'check_pincode', pincode: '560001' }, { token: admin });
  check('when Xpressbees is down customers get a plain message', down.status === 502 && !/503|unavailable/i.test(down.json.error) && down.json.ref);
  XB.mode.down = false;
  const all = logs.join('\n');
  check('logs never contain the password, token, phone numbers or emails', !all.includes('correct-horse') && !all.includes(TOKEN) && !/9876543210|@example\.com/.test(all));
  check('logs never contain the Delhivery token', !all.includes(DL_TOKEN));
  check('the Xpressbees token is stored only in the service-only table', (await db.query(`select count(*)::int as n from public.integration_tokens`)).rows[0].n === 1);
} finally {
  if (process.env.SHOW_LOGS) console.log(logs.filter((l) => /"ok":false/.test(l)).slice(0, 8).join('\n'));
  supa.close();
  xbServer.close();
  dlServer.close();
  await db.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
