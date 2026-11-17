// Builds the Postman collection GoKwik asked for (Custom Checkout APIs and webhooks),
// with example requests and the real answers of our `gokwik` Edge Function code, run
// here against the real schema in PGlite (no live data, no secrets).
// Run: node scripts/make-gokwik-postman.mjs [output file]
// Default output: gokwik-postman-collection.json in the project folder (git-ignored).

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { asRole, createBackend, handleAuth, handleRest, SERVICE_TOKEN, USERS } from '../e2e/fake-supabase.mjs';
import { createHandler } from '../supabase/functions/gokwik/handler.js';
import { DEFAULT_DELIVERY_DAYS } from '../supabase/functions/gokwik/config.js';
import { parseDeliveryDays } from '../supabase/functions/gokwik/cart.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'gokwik-postman-collection.json'));
const BASE_URL = 'https://nxttpbsjcnrppphlxdme.supabase.co/functions/v1/gokwik';
const STAGING = 'https://kitaabaurkonastaging.bizwitheet.com';
const TOKEN = 'sandbox-example-token-0123456789abcdefghijkl';
const WEBHOOK_KEY = 'example-webhook-key-0123456789abcdefghij';
const MID = 'SANDBOXMID01';

// Two sample books (made up, priced like the store's).
const books = [
  { product_code: '9788172234980', sku: '9788172234980', title: 'Godan', description: 'Premchand', price: 199, mrp: 299, gst_percent: 0, stock_quantity: 25, image_urls: ['https://d2lxx579h3vopi.cloudfront.net/sample/godan.jpg'], video_url: null, attributes: { author: 'Munshi Premchand' } },
  { product_code: '9780143414216', sku: '9780143414216', title: 'The Guide', description: 'R. K. Narayan', price: 249, mrp: 350, gst_percent: 0, stock_quantity: 25, image_urls: ['https://d2lxx579h3vopi.cloudfront.net/sample/the-guide.jpg'], video_url: null, attributes: { author: 'R. K. Narayan' } },
];

const db = await createBackend({ schemaPath: path.join(ROOT, 'supabase', 'schema.sql'), books });
const readBody = (req) => new Promise((resolve) => {
  let s = '';
  req.on('data', (c) => (s += c));
  req.on('end', () => resolve(s));
});
const supa = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const input = { method: req.method, url, headers: req.headers, body: await readBody(req) };
  const r = url.pathname.startsWith('/rest/v1/') ? await handleRest(db, input) : handleAuth(input);
  res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers || {}) });
  res.end(r.body ?? '');
});
await new Promise((r) => supa.listen(0, r));

const handle = createHandler({
  db: createClient(`http://localhost:${supa.address().port}`, SERVICE_TOKEN, { auth: { persistSession: false, autoRefreshToken: false } }),
  environments: { production: { token: '', merchantId: '', api: null }, sandbox: { token: TOKEN, merchantId: MID, api: null } },
  webhookKey: WEBHOOK_KEY,
  cronSecret: '',
  checkPincode: async (pin) => (pin === '799999' ? { deliverable: false, cod: false } : { deliverable: true, cod: true }),
  deliveryDays: parseDeliveryDays(DEFAULT_DELIVERY_DAYS),
  ipCheck: 'off',
  now: () => new Date('2026-11-17T10:00:00Z'),
  log: { info() {}, warn() {}, error() {} },
});

// A signed-in customer starts checkout on the test shop: this makes the cart GoKwik reads.
const customer = USERS['reader@example.com'].id;
const ids = (await db.query('select id from public.books order by title')).rows.map((r) => r.id);
const cartId = (await asRole(db, { role: 'authenticated', sub: customer }, (tx) =>
  tx.query('select public.create_checkout_cart($1::jsonb, $2) as id', [JSON.stringify([{ book_id: ids[0], quantity: 2 }, { book_id: ids[1], quantity: 1 }]), STAGING]),
)).rows[0].id;

const ADDRESS = {
  first_name: 'Asha',
  last_name: 'Rao',
  phone: '9876543210',
  email: 'asha@example.com',
  address: '12 MG Road, Near City Palace',
  city: 'Udaipur',
  state: 'Rajasthan',
  pincode: '313001',
  country: 'India',
};

async function run(route, body, { auth = true, query = '' } = {}) {
  const res = await handle(new Request(`${BASE_URL}${route}${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: JSON.stringify(body),
  }));
  const text = await res.text();
  return { code: res.status, body: JSON.stringify(JSON.parse(text), null, 2) };
}

const STATUS = { 200: 'OK', 400: 'Bad Request', 401: 'Unauthorized' };
const json = (value) => JSON.stringify(value, null, 2);
// Our example values in the answers become the collection's variables.
const vars = (text) => text.split(cartId).join('{{cart_id}}').split(TOKEN).join('{{sandbox_token}}').split(WEBHOOK_KEY).join('{{webhook_key}}');

function request(route, body, { auth = true, webhook = false } = {}) {
  const pathParts = route.split('/').filter(Boolean);
  const url = {
    raw: `{{base_url}}${route}${webhook ? '?key={{webhook_key}}' : ''}`,
    host: ['{{base_url}}'],
    path: pathParts,
    ...(webhook ? { query: [{ key: 'key', value: '{{webhook_key}}' }] } : {}),
  };
  return {
    method: 'POST',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    ...(auth ? {} : { auth: { type: 'noauth' } }),
    body: { mode: 'raw', raw: vars(json(body)), options: { raw: { language: 'json' } } },
    url,
  };
}

async function item(name, description, route, body, examples, options = {}) {
  const responses = [];
  for (const ex of examples) {
    const answer = await run(route, ex.body ?? body, { auth: options.auth !== false, query: options.webhook ? `?key=${ex.key ?? WEBHOOK_KEY}` : '' });
    responses.push({
      name: ex.name,
      originalRequest: request(route, ex.body ?? body, options),
      status: STATUS[answer.code] ?? String(answer.code),
      code: answer.code,
      _postman_previewlanguage: 'json',
      header: [{ key: 'Content-Type', value: 'application/json; charset=utf-8' }],
      body: vars(answer.body),
    });
  }
  return { name, request: { ...request(route, body, options), description }, response: responses };
}

const placeBody = (method, amount, extra = {}) => ({
  cart_id: cartId,
  payment_details: {
    payment_method: method,
    payment_amount: amount,
    payment_id: extra.paymentId ?? 'gkpay_sandbox_0001',
    payment_instrument: method === 'cod' ? 'cod' : 'upi',
    pg_payment_trnx_id: method === 'cod' ? '' : 'pg_txn_0001',
  },
  shipping_address: ADDRESS,
  customer_phone: ADDRESS.phone,
  meta_data: { gokwik_order_id: extra.gokwikOrder ?? 'GK-SANDBOX-0001', discounts: [], other_charges: [], rto_risk_flag: 'LOW_RISK' },
});

const subtotal = 199 * 2 + 249;
const items = [];
items.push(await item('Get Cart', 'Returns the cart for `cart_id` (our `merchantCheckoutId`, format `<customer account id>-<n>`, also passed to the SDK as `customerToken` = the account id part). Prices, stock and totals come from our database. Errors answer HTTP 400 with `error`.', '/get-cart', { cart_id: cartId }, [
  { name: 'Cart found' },
  { name: 'Unknown cart', body: { cart_id: '00000000-0000-4000-8000-000000000000-1' } },
]));
items.push(await item('Set Shipping Address', 'Saves the delivery address and checks the PIN code with our couriers. A PIN code we cannot serve returns no shipping methods; where couriers take no cash, only prepaid is offered.', '/set-shipping-address', { cart_id: cartId, shipping_address: ADDRESS }, [
  { name: 'Deliverable PIN code' },
  { name: 'Invalid mobile number', body: { cart_id: cartId, shipping_address: { ...ADDRESS, phone: '12345' } } },
]));
await run('/set-shipping-address', { cart_id: cartId, shipping_address: ADDRESS });
items.push(await item('Set Shipping Option', 'Selects the delivery method. We have one: `free_delivery` (free, estimated 3-7 days).', '/set-shipping-option', { cart_id: cartId, shipping_option: 'free_delivery' }, [
  { name: 'Free delivery selected' },
]));
items.push(await item('Check Order Exists', 'Before an order is placed (or after), by `session_key` (= `cart_id`).', '/check-order-exists', { session_key: cartId }, [
  { name: 'No order yet' },
]));
items.push(await item('Place Order (prepaid)', 'Creates the order once payment is done. `payment_amount` must match the cart after the listed discounts and charges. Calling it again for the same cart returns the same order. On success: our order id (KAK-<number>) and the link back to the order on our site.', '/place-order', placeBody('prepaid', subtotal), [
  { name: 'Order placed' },
  { name: 'Same request again (no second order)' },
]));
items.push(await item('Check Order Exists (after the order)', 'Same call after Place Order: returns our order id.', '/check-order-exists', { session_key: cartId }, [
  { name: 'Order exists' },
]));
const codExample = { ...placeBody('cod', subtotal - 50 + 25, { paymentId: 'gkpay_sandbox_cod_0002', gokwikOrder: 'GK-SANDBOX-0002' }) };
codExample.meta_data.discounts = [{ amount: 50, code: 'WELCOME50', type: 'gkp-coupon' }];
codExample.meta_data.other_charges = [{ amount: 25, charge_type: 'cashon_delivery_fee' }];
items.push({
  name: 'Place Order (cash on delivery, with a coupon and COD fee)',
  request: { ...request('/place-order', codExample), description: 'Same API for cash on delivery. Discounts and other charges are listed in `meta_data`; part payment uses `payment_method: "pp-cod"` with `meta_data.ppcod.prepaid_amount`. (Example request only: the cart above is already ordered.)' },
  response: [],
});

const hmac = (d) => createHash('sha512').update(`${d.merchantReferenceId}|${d.paymentId}|${d.amount}`).digest('hex');
const paymentData = { merchantId: MID, paymentId: 'gkpay_sandbox_0001', merchantReferenceId: 'GK-SANDBOX-0001', amount: subtotal, method: 'upi', provider: 'sandbox', udf4: cartId };
const webhooks = { name: 'Webhooks', description: 'Called by GoKwik. Authenticated by the `key` query parameter (no bearer token); payment notices also carry `hmac` = SHA-512 of `merchantReferenceId|paymentId|amount`.', item: [] };
webhooks.item.push(await item('Payments webhook', 'Payment and refund events: transaction.successful, transaction.failure, transaction.auto_refund, refund.successful, refund.failure, refund.pending, refund.initiated.', '/webhooks/payments', { event: 'transaction.successful', entity: 'transaction', data: { ...paymentData, hmac: hmac(paymentData) } }, [
  { name: 'Recorded' },
  { name: 'Wrong key', key: 'wrong-key' },
], { auth: false, webhook: true }));
webhooks.item.push(await item('Abandoned cart webhook', 'Carts started but not ordered. Each entry may name the cart as `cart_id`, `merchant_checkout_id` or `request_id`.', '/webhooks/abandoned-cart', { carts: [{ cart_id: '22222222-2222-4222-8222-222222222222-2' }] }, [
  { name: 'Received' },
], { auth: false, webhook: true }));

const collection = {
  info: {
    name: 'Kitaab Aur Kona - GoKwik Custom Checkout APIs (sandbox)',
    description: [
      'Merchant APIs of Kitaab Aur Kona for GoKwik Custom Checkout, with example requests and real example answers.',
      '',
      'Base URL: `{{base_url}}`. Every merchant API takes `Authorization: Bearer {{sandbox_token}}` (set at collection level). Sandbox orders are test orders: never shipped, no effect on live stock.',
      '',
      `Staging storefront: ${STAGING} (sandbox merchant id). A real \`cart_id\` comes from there: sign in, add a book, open checkout and press "Continue to payment"; the id is passed to the SDK as \`merchantParams.merchantCheckoutId\`, and the customer's account id as \`merchantParams.customerToken\`.`,
      '',
      'All APIs are POST with a JSON body. Errors answer HTTP 400/401 with `{ "error": "..." }`; address errors also name the field in `invalid_address_field`.',
    ].join('\n'),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{sandbox_token}}', type: 'string' }] },
  variable: [
    { key: 'base_url', value: BASE_URL, type: 'string' },
    { key: 'sandbox_token', value: 'PASTE_THE_SANDBOX_ACCESS_TOKEN', type: 'string' },
    { key: 'webhook_key', value: 'PASTE_THE_WEBHOOK_KEY', type: 'string' },
    { key: 'cart_id', value: 'PASTE_A_CART_ID_FROM_THE_STAGING_SITE', type: 'string' },
  ],
  item: [{ name: 'Checkout APIs', item: items }, webhooks],
};

const text = JSON.stringify(collection, null, 2);
for (const secret of [TOKEN, WEBHOOK_KEY]) if (text.includes(secret)) throw new Error('an example secret leaked into the collection');
fs.writeFileSync(OUT, `${text}\n`);
console.log(`Wrote ${OUT}: ${items.length} checkout requests, ${webhooks.item.length} webhooks`);
supa.close();
await db.close();
