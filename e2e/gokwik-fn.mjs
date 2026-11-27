// Checks for the `gokwik` Edge Function, run in Node with no real network calls: the
// database is the real supabase/schema.sql in PGlite behind a local fake Supabase API,
// GoKwik's servers are played by this script, and GoKwik's Update Order API is a local
// fake server.
// Run: node e2e/gokwik-fn.mjs

import http from 'node:http';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { asRole, createBackend, fetchPublicBooks, handleAuth, handleRest, SERVICE_TOKEN, USERS } from './fake-supabase.mjs';
import { createHandler } from '../supabase/functions/gokwik/handler.js';
import { createGokwikApi } from '../supabase/functions/gokwik/gokwik-api.js';
import { GOKWIK_API_HOST } from '../supabase/functions/gokwik/config.js';
import { parseDeliveryDays } from '../supabase/functions/gokwik/cart.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${String(detail).slice(0, 300)}`}`);
};

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

// ---------- Fake GoKwik Update Order API ----------
const GK = { calls: [], mode: {} };
const gkServer = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const send = (status, value) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  GK.calls.push({ path: req.url, appId: req.headers['gk-app-id'], appSecret: req.headers['gk-app-secret'], body: body ? JSON.parse(body) : null });
  if (GK.mode.down) return send(503, { error: 'unavailable' });
  if (GK.mode.refuse) return send(400, { status_code: 400, error: 'Order not found' });
  return send(200, { status_code: 200, success: true });
});
await new Promise((r) => gkServer.listen(0, r));
const GK_URL = `http://localhost:${gkServer.address().port}`;

// ---------- The function under test ----------
const logs = [];
const log = { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) };
const service = createClient(SUPA_URL, SERVICE_TOKEN, { auth: { persistSession: false, autoRefreshToken: false } });
const PROD_TOKEN = 'prod-access-token-0123456789abcdefghij';
const SANDBOX_TOKEN = 'sandbox-access-token-0123456789abcdefg';
const WEBHOOK_KEY = 'webhook-key-for-tests-0123456789abcdef';
const CRON = 'cron-secret-for-tests-0123456789abcdef';
const APP_SECRET = 'gk-app-secret-for-tests';
const MID = '19testmerchant';
const SITE = 'https://kitaabaurkona.vercel.app';
const PINS = { 799999: { deliverable: false, cod: false }, 799998: { deliverable: true, cod: false } };
const pinCalls = [];
const handlerOptions = {
  db: service,
  environments: {
    production: { token: PROD_TOKEN, merchantId: MID, api: createGokwikApi({ baseUrl: GK_URL, appId: 'app-prod', appSecret: APP_SECRET, timeoutMs: 800, anyHost: true }) },
    sandbox: { token: SANDBOX_TOKEN, merchantId: 'sandboxmid', api: null },
  },
  webhookKey: WEBHOOK_KEY,
  cronSecret: CRON,
  checkPincode: async (pincode) => {
    pinCalls.push(pincode);
    if (pincode === '560099') throw new Error('courier down');
    return PINS[pincode] ?? { deliverable: true, cod: true };
  },
  deliveryDays: parseDeliveryDays('3-7'),
  log,
};
const handle = createHandler(handlerOptions);
const enforced = createHandler({ ...handlerOptions, ipCheck: 'enforce' });

async function call(route, body, { token = PROD_TOKEN, method = 'POST', headers = {}, raw, query = '', via = handle } = {}) {
  const req = new Request(`http://fn.local/functions/v1/gokwik${route}${query}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined,
  });
  const res = await via(req);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, headers: res.headers };
}
const hook = (route, body, key = WEBHOOK_KEY) => call(route, body, { token: null, query: key ? `?key=${key}` : '' });
const job = (route, secret = CRON) => call(route, {}, { token: null, headers: secret ? { 'x-cron-secret': secret } : {} });

const READER = { role: 'authenticated', sub: USERS['reader@example.com'].id };
const ADMIN = { role: 'authenticated', sub: USERS['admin@example.com'].id };
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const books = (await db.query(`select id, price, mrp, stock_quantity from public.books where is_visible and stock_quantity >= 6 and price > 60 order by id limit 6`)).rows;
const newCart = async (items, who = READER, site = SITE) =>
  (await asRole(db, who, (tx) => tx.query(`select public.create_checkout_cart($1::jsonb, $2) as id`, [JSON.stringify(items), site]))).rows[0].id;
// Another signed-in customer (each has their own open cart).
const newCustomer = async () => {
  const id = randomUUID();
  await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, `${id.slice(0, 8)}@example.com`, {}]);
  return { role: 'authenticated', sub: id };
};
const cartsOf = async (who) => (await db.query(`select id from public.checkout_carts where user_id = $1 order by seq`, [who.sub])).rows.map((r) => r.id);
const tryAs = async (who, sql, params = []) => {
  try {
    await asRole(db, who, (tx) => tx.query(sql, params));
    return null;
  } catch (e) {
    return e.message;
  }
};
const ADDRESS = { postal_code: '313001', city: 'Udaipur', state: 'Rajasthan', first_name: 'Asha', last_name: 'Rao', address: '12 MG Road, Near City Palace', email: 'asha@example.com', phone: '+91 98765 43210' };
const placeBody = (cart, method, amount, extra = {}) => ({
  cart_id: cart,
  payment_details: { payment_method: method, payment_amount: amount, payment_id: extra.paymentId ?? `KWIK${Math.random().toString(36).slice(2, 12)}`, payment_instrument: 'upi', pg_payment_trnx_id: 'PG123' },
  shipping_address: { pincode: '313001', city: 'Udaipur', state: 'Rajasthan', first_name: 'Asha', last_name: 'Rao', address: '12 MG Road, Near City Palace', email: 'asha@example.com', phone: '9876543210' },
  customer_phone: '9876543210',
  meta_data: { gokwik_order_id: extra.gokwikOrder ?? '', discounts: extra.discounts ?? [], other_charges: extra.charges ?? [], ...(extra.ppcod ? { ppcod: extra.ppcod } : {}), rto_risk_flag: 'LOW_RISK' },
});
const orderByNumber = async (kak) => one(`select * from public.orders where order_number = $1`, [Number(kak.replace('KAK-', ''))]);
const sha512 = (s) => createHash('sha512').update(s).digest('hex');
const notice = (event, data) => ({ event, entity: event.split('.')[0], data: { merchantId: MID, ...data, hmac: sha512(`${data.merchantReferenceId}|${data.paymentId}|${data.amount}`) } });

try {
  // ---------- Requests that never get in ----------
  const cartA = await newCart([{ book_id: books[0].id, quantity: 2 }, { book_id: books[1].id, quantity: 1 }]);
  check("a checkout cart id is the customer's user id and cart number", cartA === `${READER.sub}-1`, cartA);
  const cartAgain = await newCart([{ book_id: books[2].id, quantity: 1 }]);
  check('starting checkout again keeps the same cart id and takes the new books', cartAgain === cartA && (await one(`select item_count from public.checkout_carts where id = $1`, [cartA])).item_count === 1 && (await cartsOf(READER)).length === 1);
  await newCart([{ book_id: books[0].id, quantity: 2 }, { book_id: books[1].id, quantity: 1 }]);
  const OTHER = await newCustomer();
  const cartOther = await newCart([{ book_id: books[0].id, quantity: 1 }], OTHER);
  check('another customer gets their own cart id', cartOther === `${OTHER.sub}-1` && cartOther !== cartA);
  check('two quick starts cannot open two carts for one customer', await (async () => {
    const BOTH = await newCustomer();
    await Promise.all([newCart([{ book_id: books[0].id, quantity: 1 }], BOTH), newCart([{ book_id: books[1].id, quantity: 1 }], BOTH)]);
    return (await cartsOf(BOTH)).length === 1;
  })());
  check('without the access token GoKwik is refused', (await call('/get-cart', { cart_id: cartA }, { token: null })).status === 401);
  check('a wrong access token is refused', (await call('/get-cart', { cart_id: cartA }, { token: 'x'.repeat(40) })).status === 401);
  check("a customer's own sign-in token is refused", (await call('/get-cart', { cart_id: cartA }, { token: SERVICE_TOKEN })).status === 401);
  // The token in each form GoKwik's checkout, its validator or a hand-made Postman test sends.
  const tokenForms = {
    'Authorization: Bearer Bearer <token> (Bearer pasted into Postman)': { authorization: `Bearer Bearer ${SANDBOX_TOKEN}` },
    'Authorization: <token> (no Bearer)': { authorization: SANDBOX_TOKEN },
    'Authorization: Bearer "<token>" (in quotes)': { authorization: `Bearer "${SANDBOX_TOKEN}"` },
    'authorization: bearer <token> (lower case)': { authorization: `bearer ${SANDBOX_TOKEN}` },
    'X-API-Key: <token> (validator "API key" setting)': { 'x-api-key': SANDBOX_TOKEN },
  };
  for (const [form, headers] of Object.entries(tokenForms)) {
    check(`the token is accepted as ${form}`, (await call('/get-cart', { cart_id: cartA }, { token: null, headers })).status === 200);
  }
  check('a token merely starting like ours is refused', (await call('/get-cart', { cart_id: cartA }, { token: null, headers: { 'x-api-key': `${SANDBOX_TOKEN}x` } })).status === 401);
  {
    logs.length = 0;
    const refused = await call('/get-cart', { cart_id: cartA }, { token: 'y'.repeat(36), headers: { 'user-agent': 'PostmanRuntime/2.11.0' } });
    const line = logs.find((l) => l.includes('token_refused')) ?? '';
    check('a refused token answers how to send it', refused.status === 401 && /Authorization: Bearer <token>/.test(refused.json?.error ?? '') && /X-API-Key/.test(refused.json?.error ?? ''), JSON.stringify(refused.json));
    check('a refused token is logged with length and fingerprint, never the token', /"length":36/.test(line) && /"fingerprint":"[0-9a-f]{8}"/.test(line) && /"sandbox":\{"length":\d+,"fingerprint":"[0-9a-f]{8}"\}/.test(line) && /PostmanRuntime/.test(line) && !line.includes('y'.repeat(36)) && !line.includes(SANDBOX_TOKEN) && !line.includes(PROD_TOKEN), line);
  }
  {
    // GoKwik's validator sent an unfilled Postman variable and a long key of its own (18 Nov).
    const r = await call('/get-cart', { cart_id: cartA }, { token: null, headers: { authorization: 'Bearer {{access_token}}', 'x-api-key': 'k'.repeat(1088) } });
    const problems = r.json?.problems ?? [];
    check('a refused token says which Postman variable is empty', r.status === 401 && problems.some((p) => /Authorization contains the Postman variable \{\{access_token\}\}, which has no value/.test(p)), JSON.stringify(r.json));
    check('...and that the other value is not our token, by length only', problems.some((p) => /X-API-Key has a 1088-character value/.test(p) && /are \d+ characters long/.test(p)) && !JSON.stringify(r.json).includes('kkkk'), JSON.stringify(problems));
    const none = await call('/get-cart', { cart_id: cartA }, { token: null });
    check('a request without any token says so', none.status === 401 && /No token arrived/.test((none.json?.problems ?? [])[0] ?? ''), JSON.stringify(none.json));
    check('the reply never shows our tokens', !JSON.stringify(r.json).includes(SANDBOX_TOKEN) && !JSON.stringify(r.json).includes(PROD_TOKEN));
  }
  {
    // A long access token (over 512 characters) must be compared whole, not cut short.
    const LONG = `long-sandbox-token-${'z'.repeat(700)}`;
    const longHandler = createHandler({ ...handlerOptions, environments: { ...handlerOptions.environments, sandbox: { ...handlerOptions.environments.sandbox, token: LONG } } });
    check('a token longer than 512 characters is accepted', (await call('/get-cart', { cart_id: cartA }, { token: LONG, via: longHandler })).status === 200);
    check('...but not when cut at 512 characters', (await call('/get-cart', { cart_id: cartA }, { token: LONG.slice(0, 512), via: longHandler })).status === 401);
  }
  {
    const viaGet = await call('/get-cart', null, { method: 'GET', query: `?cart_id=${cartA}` });
    check('GET works for Get Cart, with the cart id in the address', viaGet.status === 200 && Boolean(viaGet.json?.data?.cart), JSON.stringify(viaGet.json).slice(0, 300));
  }
  check('GET is not allowed for routes that change things', (await call('/place-order', null, { method: 'GET' })).status === 405 && (await call('/set-shipping-address', null, { method: 'GET' })).status === 405);
  check('POST with the cart id in the address works', (await call('/get-cart', null, { raw: '', query: `?cart_id=${cartA}` })).status === 200);
  check('a form post (cart_id=...) works', (await call('/get-cart', null, { raw: `cart_id=${cartA}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status === 200);
  check('browser preflights are refused', (await call('/get-cart', null, { method: 'OPTIONS' })).status === 405);
  check('unknown routes are not found', (await call('/drop-tables', {})).status === 404);
  check('a body over 64 KB is refused', (await call('/get-cart', null, { raw: JSON.stringify({ cart_id: cartA, pad: 'x'.repeat(70000) }) })).status === 413);
  check('broken JSON is refused', (await call('/get-cart', null, { raw: '{nope' })).status === 400);
  check('a malformed cart id is refused', (await call('/get-cart', { cart_id: "1' or '1'='1" })).status === 400 && (await call('/get-cart', { cart_id: `${READER.sub}-0` })).status === 400 && (await call('/get-cart', { cart_id: 'a'.repeat(64) })).status === 400);
  const unknown = await call('/get-cart', { cart_id: '00000000-0000-4000-8000-000000000000-1' });
  check('an unknown cart answers 400 with the reason', unknown.status === 400 && unknown.json.error === 'Invalid cart id' && unknown.json.data.error === 'Invalid cart id');
  check('jobs without the cron secret are refused', (await job('/jobs/push-updates', null)).status === 401 && (await job('/jobs/push-updates', 'guess')).status === 401);
  check('webhooks without the key are refused', (await hook('/webhooks/payments', {}, null)).status === 401 && (await hook('/webhooks/payments', {}, 'guess')).status === 401);
  check('the GoKwik API address must be a GoKwik host', createGokwikApi({ baseUrl: 'https://evil.example.com', appId: 'a', appSecret: 'b' }) === null && GOKWIK_API_HOST.test('https://api.gokwik.co') && !GOKWIK_API_HOST.test('https://gokwik.co.evil.com') && !GOKWIK_API_HOST.test('http://api.gokwik.co'));

  // ---------- GoKwik's addresses ----------
  const from = (ip, extra = {}) => ({ via: enforced, headers: { 'x-real-ip': ip, ...extra } });
  check('IP check: production token from a production address is let in', (await call('/get-cart', { cart_id: cartA }, from('52.66.34.242'))).status === 200);
  check('IP check: sandbox token from the sandbox address is let in', (await call('/get-cart', { cart_id: cartA }, { ...from('13.200.124.145'), token: SANDBOX_TOKEN })).status === 200);
  check('IP check: production token from the sandbox address is refused', (await call('/get-cart', { cart_id: cartA }, from('13.200.124.145'))).status === 403);
  check('IP check: an unknown address is refused, even with the right token', (await call('/get-cart', { cart_id: cartA }, from('203.0.113.9'))).status === 403);
  check('IP check: no address at all is refused', (await call('/get-cart', { cart_id: cartA }, { via: enforced })).status === 403);
  check("IP check: a caller's own x-forwarded-for start does not count", (await call('/get-cart', { cart_id: cartA }, { via: enforced, headers: { 'x-forwarded-for': '52.66.34.242, 203.0.113.9' } })).status === 403);
  check('IP check: webhooks from a GoKwik address with the key are let in', (await hook('/webhooks/abandoned-cart', { carts: [] }, WEBHOOK_KEY)).status === 200 && (await call('/webhooks/abandoned-cart', { carts: [] }, { ...from('3.108.114.222'), token: null, query: `?key=${WEBHOOK_KEY}` })).status === 200);
  check('IP check: webhooks from elsewhere are refused', (await call('/webhooks/abandoned-cart', { carts: [] }, { ...from('203.0.113.9'), token: null, query: `?key=${WEBHOOK_KEY}` })).status === 403);
  check('IP check: the token is still checked first', (await call('/get-cart', { cart_id: cartA }, { ...from('52.66.34.242'), token: 'x'.repeat(40) })).status === 401);
  check('IP check: in log mode an unknown address is let in and noted', (await call('/get-cart', { cart_id: cartA }, { headers: { 'x-real-ip': '203.0.113.9' } })).status === 200 && logs.some((l) => l.includes('caller_address_not_listed') && l.includes('203.0.113.9')));

  // ---------- Who may touch the database side ----------
  check('visitors cannot start a checkout cart', /permission denied|Sign in/i.test((await tryAs({ role: 'anon', sub: null }, `select public.create_checkout_cart($1::jsonb)`, [JSON.stringify([{ book_id: books[0].id, quantity: 1 }])])) ?? ''));
  check('customers cannot read checkout carts directly', /permission denied/i.test((await tryAs(READER, `select * from public.checkout_carts`)) ?? ''));
  check('customers cannot place an order themselves', /permission denied/i.test((await tryAs(READER, `select public.gokwik_place_order($1, '{}'::jsonb)`, [cartA])) ?? ''));
  check('customers cannot read payment records', (await asRole(db, READER, (tx) => tx.query(`select count(*)::int as n from public.order_payments`))).rows[0].n === 0);
  check('a cart refuses more than 10 of a book', /no longer available/i.test((await tryAs(READER, `select public.create_checkout_cart($1::jsonb)`, [JSON.stringify([{ book_id: books[0].id, quantity: 11 }])])) ?? ''));
  check('a cart refuses the same book twice', /twice/i.test((await tryAs(READER, `select public.create_checkout_cart($1::jsonb)`, [JSON.stringify([{ book_id: books[0].id, quantity: 1 }, { book_id: books[0].id, quantity: 1 }])])) ?? ''));
  check('a site that is not a web address is not kept', (await one(`select site from public.checkout_carts where id = $1`, [await newCart([{ book_id: books[0].id, quantity: 1 }], OTHER, 'javascript:alert(1)')])).site === null);

  // ---------- Get Cart ----------
  const subtotalA = Number(books[0].price) * 2 + Number(books[1].price);
  const got = await call('/get-cart', { cart_id: cartA });
  const c = got.json?.data?.cart;
  check('get-cart: totals come from the books table', got.status === 200 && c.subtotal === subtotalA && c.total === subtotalA && c.discount_total === 0 && c.shipping_total === 0 && c.currency === 'INR', JSON.stringify(c));
  check('get-cart: every item has id, sku, price, MRP, image and stock', c.items.length === 2 && c.items.every((i) => i.product_id && i.variant_id && i.sku && i.title && i.mrp >= i.price && /^https:\/\//.test(i.image_url) && i.total === i.price * i.quantity && i.stock_status === 'in_stock' && i.salable_qty >= i.quantity), JSON.stringify(c.items));
  check('get-cart: order summary extra fields and discounts are present and empty', Array.isArray(c.order_summary_extra_fields) && c.order_summary_extra_fields.length === 0 && Array.isArray(c.discounts) && Array.isArray(c.items[0].metadata.product_details));
  check('get-cart: payment methods are left to GoKwik', c.available_payment_methods === undefined);

  // ---------- Set Shipping Address ----------
  const addr = await call('/set-shipping-address', { cart_id: cartA, shipping_address: ADDRESS });
  check('address: a served PIN code offers free delivery', addr.status === 200 && addr.json.data.cart.available_shipping_methods.length === 1 && addr.json.data.cart.available_shipping_methods[0].price === 0, JSON.stringify(addr.json));
  check('address: the delivery estimate comes from the setting', /^\d{4}-\d{2}-\d{2}$/.test(addr.json.data.cart.items[0].metadata.edd?.default?.max_date ?? ''));
  const saved = (await one(`select shipping from public.checkout_carts where id = $1`, [cartA])).shipping;
  check('address: saved on the cart with a clean 10-digit mobile and no email', saved.phone === '9876543210' && saved.name === 'Asha Rao' && saved.deliverable === true && saved.email === undefined, JSON.stringify(saved));
  const noServe = await call('/set-shipping-address', { cart_id: cartA, shipping_address: { ...ADDRESS, postal_code: '799999' } });
  check('address: a PIN code no courier serves gets no delivery method', noServe.status === 200 && noServe.json.data.cart.available_shipping_methods.length === 0 && noServe.json.data.cart.items[0].serviceable_status === false);
  check('delivery option: refused while the address cannot be served', (await call('/set-shipping-option', { cart_id: cartA, shipping_option: 'free_delivery' })).status === 400);
  const noCod = await call('/set-shipping-address', { cart_id: cartA, shipping_address: { ...ADDRESS, postal_code: '799998' } });
  check('address: where the courier takes no cash only online payment is offered', noCod.json.data.cart.available_payment_methods?.length === 1 && noCod.json.data.cart.available_payment_methods[0].id === 'prepaid');
  const pinDown = await call('/set-shipping-address', { cart_id: cartA, shipping_address: { ...ADDRESS, postal_code: '560099' } });
  check('address: accepted when the PIN check itself cannot run', pinDown.status === 200 && pinDown.json.data.cart.available_shipping_methods.length === 1);
  const badPhone = await call('/set-shipping-address', { cart_id: cartA, shipping_address: { ...ADDRESS, phone: '12345' } });
  check('address: a bad mobile number names the field', badPhone.status === 400 && badPhone.json.invalid_address_field === 'phone' && badPhone.json.data.invalid_address_field === 'phone');
  check('address: a bad PIN code names the field', (await call('/set-shipping-address', { cart_id: cartA, shipping_address: { ...ADDRESS, postal_code: '0123' } })).json.invalid_address_field === 'postal_code');
  await call('/set-shipping-address', { cart_id: cartA, shipping_address: ADDRESS });

  // ---------- Set Shipping Option ----------
  const opt = await call('/set-shipping-option', { cart_id: cartA, shipping_option: 'free_delivery' });
  check('delivery option: selected method and estimate are returned', opt.status === 200 && opt.json.data.cart.selected_shipping_method.id === 'free_delivery' && opt.json.data.cart.estimate_delivery_date.time_delta === '3-7_days', JSON.stringify(opt.json));
  check('delivery option: an unknown option is refused', (await call('/set-shipping-option', { cart_id: cartA, shipping_option: 'express' })).status === 400);

  // ---------- Place Order: paid online ----------
  check('check-order-exists: nothing before the order is placed', (await call('/check-order-exists', { session_key: cartA })).json.message === 'No order found.');
  const stockBefore = (await one(`select stock_quantity from public.books where id = $1`, [books[0].id])).stock_quantity;
  const paid = await call('/place-order', placeBody(cartA, 'prepaid', subtotalA, { paymentId: 'KWIKPAID0001', gokwikOrder: 'GKORDER0001' }));
  check('place order (paid online): success with our order number and a link back', paid.status === 200 && paid.json.status === 'success' && /^KAK-\d+$/.test(paid.json.order_id) && paid.json.thankyou_redirect_url.startsWith(`${SITE}/orders/`), JSON.stringify(paid.json));
  const o1 = await orderByNumber(paid.json.order_id);
  check('place order (paid online): saved as paid, in full', o1.status === 'paid' && o1.payment_method === 'online' && Number(o1.total) === subtotalA && Number(o1.amount_paid) === subtotalA && o1.is_test === false && o1.user_id === READER.sub, JSON.stringify(o1));
  check('place order: the books leave stock', (await one(`select stock_quantity from public.books where id = $1`, [books[0].id])).stock_quantity === stockBefore - 2);
  check('place order: its parcel is queued', (await one(`select count(*)::int as n from public.shipments where order_id = $1 and status = 'queued'`, [o1.id])).n === 1);
  check('place order: the payment is recorded', (await one(`select method, payment_id, environment from public.order_payments where order_id = $1`, [o1.id]))?.payment_id === 'KWIKPAID0001');
  const again = await call('/place-order', placeBody(cartA, 'prepaid', subtotalA, { paymentId: 'KWIKPAID0001' }));
  check('place order: a retry returns the same order and makes no second one', again.json.order_id === paid.json.order_id && (await one(`select count(*)::int as n from public.orders where user_id = $1`, [READER.sub])).n === 1);
  check('check-order-exists: finds the order by the cart id', (await call('/check-order-exists', { session_key: cartA })).json.order_id === paid.json.order_id);
  check('get-cart: an ordered cart is closed', (await call('/get-cart', { cart_id: cartA })).status === 400);
  check('the customer can look up the order of their own cart only', (await asRole(db, READER, (tx) => tx.query(`select public.checkout_cart_order($1) as id`, [cartA]))).rows[0].id === o1.id && (await asRole(db, ADMIN, (tx) => tx.query(`select public.checkout_cart_order($1) as id`, [cartA]))).rows[0].id === null);
  const cartDup = await newCart([{ book_id: books[2].id, quantity: 1 }]);
  check('after an order the next checkout gets the next cart id', cartDup === `${READER.sub}-2`, cartDup);
  const dup = await call('/place-order', placeBody(cartDup, 'prepaid', Number(books[2].price), { paymentId: 'KWIKPAID0001' }));
  check('place order: one payment cannot pay for two orders', dup.json.status === 'failed' && (await one(`select order_id from public.checkout_carts where id = $1`, [cartDup])).order_id === null && (await one(`select count(*)::int as n from public.orders`)).n === 1, JSON.stringify(dup.json));

  // ---------- Place Order: cash on delivery with a GoKwik discount ----------
  const priceB = Number(books[2].price);
  const cod = await call('/place-order', placeBody(cartDup, 'cod', priceB - 40 + 25, { discounts: [{ amount: 40, code: 'WELCOME40', type: 'gkp-coupon' }], charges: [{ amount: 25, charge_type: 'cashon_delivery_fee' }] }));
  const o2 = await orderByNumber(cod.json.order_id);
  check('place order (COD): confirmed, nothing paid, discount and fee kept', o2.status === 'confirmed' && o2.payment_method === 'cod' && Number(o2.discount_total) === 40 && Number(o2.other_charges) === 25 && Number(o2.total) === priceB - 15 && Number(o2.amount_paid) === 0, JSON.stringify(o2));
  const booking = (await one(`select public.shipment_booking_data(id) as d from public.shipments where order_id = $1`, [o2.id])).d;
  check('place order (COD): the courier collects the order total, not the books subtotal', Number(booking.order.cod_amount) === priceB - 15 && Number(booking.order.total) === priceB - 15);
  const bookingPaid = (await one(`select public.shipment_booking_data(id) as d from public.shipments where order_id = $1`, [o1.id])).d;
  check('an order paid online has nothing to collect', Number(bookingPaid.order.cod_amount) === 0);

  // ---------- Place Order: refusals ----------
  const cartBad = await newCart([{ book_id: books[3].id, quantity: 1 }], OTHER);
  check('a cart that was never ordered keeps its id', cartBad === cartOther);
  const priceC = Number(books[3].price);
  const cheap = await call('/place-order', placeBody(cartBad, 'prepaid', priceC - 50));
  check('place order: paying less than the cart explains is refused', cheap.json.status === 'failed' && /amount/.test(cheap.json.reason), JSON.stringify(cheap.json));
  check('place order: an unknown payment method is refused', (await call('/place-order', placeBody(cartBad, 'bitcoin', priceC))).status === 400);
  await db.query(`update public.books set stock_quantity = 0 where id = $1`, [books[3].id]);
  const gone = await call('/place-order', placeBody(cartBad, 'prepaid', priceC));
  check('place order: a book that sold out is refused, so GoKwik refunds', gone.json.status === 'failed' && gone.json.reason === 'product is not available');
  check('get-cart: a cart with a sold-out book is refused', (await call('/get-cart', { cart_id: cartBad })).status === 400);
  await db.query(`update public.books set stock_quantity = 6 where id = $1`, [books[3].id]);
  const noAddress = await call('/place-order', { ...placeBody(cartBad, 'prepaid', priceC), shipping_address: { pincode: '313001' } });
  check('place order: without a usable address nothing is ordered', noAddress.json.status === 'failed' && /address/.test(noAddress.json.reason));
  await db.query(`update public.checkout_carts set expires_at = now() - interval '2 hours' where id = $1`, [cartBad]);
  check('place order: an expired cart is refused', (await call('/place-order', placeBody(cartBad, 'prepaid', priceC))).status === 400);
  check('refusals made no orders', (await one(`select count(*)::int as n from public.orders`)).n === 2);

  // ---------- Sandbox orders and part payment ----------
  const cartTest = await newCart([{ book_id: books[4].id, quantity: 1 }]);
  const stockSandbox = async () => (await one(`select stock_quantity from public.books where id = $1`, [books[4].id])).stock_quantity;
  const beforeTest = await stockSandbox();
  const test = await call('/place-order', placeBody(cartTest, 'prepaid', Number(books[4].price)), { token: SANDBOX_TOKEN });
  const o3 = await orderByNumber(test.json.order_id);
  check('a sandbox order is marked as a test and gets no parcel', o3.is_test === true && (await one(`select count(*)::int as n from public.shipments where order_id = $1`, [o3.id])).n === 0);
  check('a sandbox order takes no books from the live stock', (await stockSandbox()) === beforeTest);
  await asRole(db, ADMIN, (tx) => tx.query(`select public.admin_set_order_status($1, 'cancelled')`, [o3.id]));
  check('cancelling a sandbox order puts no books back either', (await stockSandbox()) === beforeTest);
  const cartTestCod = await newCart([{ book_id: books[4].id, quantity: 1 }]);
  const testCod = await call('/place-order', placeBody(cartTestCod, 'cod', Number(books[4].price)), { token: SANDBOX_TOKEN });
  const o3c = await orderByNumber(testCod.json.order_id);
  await asRole(db, READER, (tx) => tx.query(`select public.cancel_order($1)`, [o3c.id]));
  check('a customer cancelling a sandbox cash-on-delivery order changes no stock', o3c.is_test === true && (await stockSandbox()) === beforeTest);
  const cartPart = await newCart([{ book_id: books[5].id, quantity: 1 }]);
  const priceE = Number(books[5].price);
  const part = await call('/place-order', placeBody(cartPart, 'pp-cod', priceE, { ppcod: { prepaid_amount: 49, payable_on_delivery: priceE - 49 } }));
  const o4 = await orderByNumber(part.json.order_id);
  const bookingPart = (await one(`select public.shipment_booking_data(id) as d from public.shipments where order_id = $1`, [o4.id])).d;
  check('part payment: the rest is collected on delivery', o4.payment_method === 'cod' && Number(o4.amount_paid) === 49 && Number(bookingPart.order.cod_amount) === priceE - 49, JSON.stringify(o4));

  // ---------- Webhooks ----------
  const okNotice = notice('transaction.successful', { paymentId: 'KWIKPAID0001', merchantReferenceId: 'GKORDER0001', amount: subtotalA });
  check('webhook: a payment notice is recorded against its order', (await hook('/webhooks/payments', okNotice)).status === 200 && (await one(`select order_id from public.payment_events where payment_id = 'KWIKPAID0001'`)).order_id === o1.id);
  check('webhook: the same notice twice is kept once', (await hook('/webhooks/payments', okNotice)).status === 200 && (await one(`select count(*)::int as n from public.payment_events`)).n === 1);
  check('webhook: a wrong check value is refused', (await hook('/webhooks/payments', { ...okNotice, data: { ...okNotice.data, amount: 1 } })).status === 401);
  check('webhook: another merchant is refused', (await hook('/webhooks/payments', notice('transaction.successful', { merchantId: 'someoneelse', paymentId: 'X1', merchantReferenceId: 'R1', amount: 5 }))).status === 401);
  check('webhook: an unknown event is acknowledged and ignored', (await hook('/webhooks/payments', notice('transaction.unknown', { paymentId: 'X2', merchantReferenceId: 'R2', amount: 5 }))).json.ignored === true);
  check('webhook: abandoned carts of ours are marked', (await hook('/webhooks/abandoned-cart', { carts: [{ cart_id: cartBad }, { cart_id: 'not-ours' }, { cart_id: cartA }] })).json.marked === 1);
  const back = await newCart([{ book_id: books[3].id, quantity: 1 }], OTHER);
  check('a customer who comes back to an abandoned cart gets the same id, no longer marked', back === cartBad && (await one(`select abandoned_at, expires_at > now() as fresh from public.checkout_carts where id = $1`, [cartBad])).abandoned_at === null);

  // ---------- Updates and refunds sent to GoKwik ----------
  check('nothing was sent to GoKwik before anything changed', (await job('/jobs/push-updates')).json.claimed === 0 && GK.calls.length === 0);
  await db.query(`update public.shipments set status = 'booked', awb_number = 'AWB12345678', courier_name = 'Surface Xpressbees 0.5 K.G' where order_id = $1`, [o1.id]);
  const pushed = await job('/jobs/push-updates');
  const awbCall = GK.calls.at(-1);
  check('a booked parcel is reported with its AWB and our order number', pushed.json.sent === 1 && awbCall.path === '/v3/orders/update' && awbCall.body.merchant_order_id === paid.json.order_id && awbCall.body.awb_number === 'AWB12345678' && awbCall.body.awb_status === 'booked' && awbCall.body.order_status === 'Confirmed' && awbCall.body.refund_amount === undefined, JSON.stringify(awbCall));
  check("GoKwik's keys go in the headers", awbCall.appId === 'app-prod' && awbCall.appSecret === APP_SECRET);
  await db.query(`update public.shipments set status = 'cancelled' where order_id = $1`, [o1.id]);
  await asRole(db, ADMIN, (tx) => tx.query(`select public.admin_set_order_status($1, 'cancelled')`, [o1.id]));
  GK.mode.refuse = true;
  await job('/jobs/push-updates');
  check('a refused update is kept for another try', (await one(`select state, last_error from public.gokwik_order_updates where order_id = $1 and order_status = 'Cancelled'`, [o1.id])).state === 'pending');
  GK.mode.refuse = false;
  await db.query(`update public.gokwik_order_updates set next_try_at = now() where state = 'pending'`);
  await job('/jobs/push-updates');
  const refundCall = GK.calls.at(-1);
  check('cancelling an order paid online asks GoKwik for the refund, once', refundCall.body.order_status === 'Cancelled' && refundCall.body.refund_amount === subtotalA && (await one(`select count(*)::int as n from public.gokwik_order_updates where order_id = $1 and refund_amount is not null`, [o1.id])).n === 1 && (await one(`select refund_status from public.order_payments where order_id = $1`, [o1.id])).refund_status === 'requested', JSON.stringify(refundCall.body));
  await hook('/webhooks/payments', notice('refund.successful', { paymentId: 'RKWIK0001', transactionPaymentId: 'KWIKPAID0001', merchantReferenceId: 'GKORDER0001', amount: subtotalA, refundId: 'RKWIK0001' }));
  const refunded = await one(`select refund_status, refunded_amount from public.order_payments where order_id = $1`, [o1.id]);
  check('webhook: a finished refund is noted on the payment', refunded.refund_status === 'successful' && Number(refunded.refunded_amount) === subtotalA);

  // Part-paid order cancelled by the customer while GoKwik's API is down.
  GK.mode.down = true;
  await asRole(db, READER, (tx) => tx.query(`select public.cancel_order($1)`, [o4.id]));
  await job('/jobs/push-updates');
  const stuck = await one(`select state, attempts, last_error from public.gokwik_order_updates where order_id = $1`, [o4.id]);
  check('a refund request that got no clear answer is never sent again by itself', stuck.state === 'failed' && /not retried/.test(stuck.last_error), JSON.stringify(stuck));
  GK.mode.down = false;
  const sentBefore = GK.calls.length;
  await db.query(`update public.gokwik_order_updates set next_try_at = now()`);
  await job('/jobs/push-updates');
  check('...even on the next round', GK.calls.length === sentBefore);
  check('COD orders cancelled with nothing paid ask for no refund', await (async () => {
    await asRole(db, READER, (tx) => tx.query(`select public.cancel_order($1)`, [o2.id]));
    const row = await one(`select refund_amount from public.gokwik_order_updates where order_id = $1 and order_status = 'Cancelled'`, [o2.id]);
    return row && row.refund_amount === null;
  })());

  // GoKwik refunds a payment by itself: the order must not ship.
  const cartAuto = await newCart([{ book_id: books[4].id, quantity: 1 }]);
  const priceD = Number(books[4].price);
  const auto = await call('/place-order', placeBody(cartAuto, 'prepaid', priceD, { paymentId: 'KWIKAUTO0001' }));
  const o5 = await orderByNumber(auto.json.order_id);
  const stockAuto = (await one(`select stock_quantity from public.books where id = $1`, [books[4].id])).stock_quantity;
  await hook('/webhooks/payments', notice('transaction.auto_refund', { paymentId: 'KWIKAUTO0001', merchantReferenceId: 'GKAUTO1', amount: priceD }));
  const o5After = await one(`select status from public.orders where id = $1`, [o5.id]);
  check('an order GoKwik refunded by itself is cancelled and its book returns to stock', o5After.status === 'cancelled' && (await one(`select stock_quantity from public.books where id = $1`, [books[4].id])).stock_quantity === stockAuto + 1);
  check('...and no second refund is asked for', (await one(`select count(*)::int as n from public.gokwik_order_updates where order_id = $1 and refund_amount is not null`, [o5.id])).n === 0);

  // ---------- Health and logs ----------
  const health = await job('/jobs/health');
  check('health shows what is set up and no secret', health.json.production.merchant_api_token === true && health.json.production.update_order_api === true && health.json.sandbox.update_order_api === false && !JSON.stringify(health.json).includes(PROD_TOKEN) && !JSON.stringify(health.json).includes(APP_SECRET));
  const all = logs.join('\n');
  check('logs never contain tokens, keys, phone numbers or emails', ![PROD_TOKEN, SANDBOX_TOKEN, WEBHOOK_KEY, CRON, APP_SECRET].some((s) => all.includes(s)) && !/9876543210|@example\.com/.test(all));

  // ---------- Limits ----------
  let limitError = null;
  const BUSY = await newCustomer();
  for (let i = 0; i < 31 && !limitError; i++) limitError = await tryAs(BUSY, `select public.create_checkout_cart($1::jsonb)`, [JSON.stringify([{ book_id: books[0].id, quantity: 1 }])]);
  check('at most 30 checkout starts an hour per customer', /Too many checkouts/.test(limitError ?? ''), limitError);
} finally {
  if (process.env.SHOW_LOGS) console.log(logs.filter((l) => /"ok":false/.test(l)).slice(0, 12).join('\n'));
  supa.close();
  gkServer.close();
  await db.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
