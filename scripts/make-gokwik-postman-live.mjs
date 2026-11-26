// Builds a Postman collection that calls the LIVE gokwik function with real values: the
// real sandbox access token and webhook key (read from a local, git-ignored file), a real
// cart from the test shop, and the real sandbox merchant id. No {{variables}}, no scripts,
// no collection-level auth, so any Postman version sends exactly what is written.
//
// Run: node scripts/make-gokwik-postman-live.mjs --cart <cart id> --amount <cart subtotal>
//      [--env <file>] [--out <file>]
// Secrets file (default .env.gokwik.local in the project folder, git-ignored by .env.*):
//   GOKWIK_SANDBOX_TOKEN=<the sandbox access token>
//   GOKWIK_WEBHOOK_KEY=<the webhook key>
// Output (default e2e/shots/gokwik-postman-live.json, git-ignored). It holds the sandbox
// token: never commit it, never paste it in chat.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CART_ID } from '../supabase/functions/gokwik/cart.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = 'https://nxttpbsjcnrppphlxdme.supabase.co/functions/v1/gokwik';
const SANDBOX_MID = '198encxdsql5';
// First 8 hex characters of the SHA-256 of the sandbox token the live function holds
// (from its token_refused log line). Catches a wrong token here instead of in Postman.
const SANDBOX_TOKEN_FINGERPRINT = '12e41b5a';
const SANDBOX_TOKEN_LENGTH = 64;
const WRONG_TOKEN = `not-our-token-${'0'.repeat(31)}`;
const UNKNOWN_CART = '00000000-0000-4000-8000-000000000000-1';

function stop(message) {
  console.error(`Not written: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const cart = arg('cart');
const amount = Number(arg('amount'));
const envFile = path.resolve(ROOT, arg('env') ?? '.env.gokwik.local');
const OUT = path.resolve(ROOT, arg('out') ?? path.join('e2e', 'shots', 'gokwik-postman-live.json'));

if (!cart || !CART_ID.test(cart)) stop('--cart must be a cart id like <user id>-<n>');
if (!Number.isFinite(amount) || amount <= 0) stop('--amount must be the cart subtotal, e.g. 299');

// The secrets file: KEY=value lines; quotes and spaces around the value are dropped.
if (!fs.existsSync(envFile)) stop(`${path.relative(ROOT, envFile)} not found (see the top of this script)`);
const secrets = {};
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m) secrets[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2').replace(/^bearer\s+/i, '').trim();
}
const token = secrets.GOKWIK_SANDBOX_TOKEN ?? '';
const webhookKey = secrets.GOKWIK_WEBHOOK_KEY ?? '';
const fingerprint = createHash('sha256').update(token).digest('hex').slice(0, 8);
if (token.length !== SANDBOX_TOKEN_LENGTH || fingerprint !== SANDBOX_TOKEN_FINGERPRINT) {
  stop(`GOKWIK_SANDBOX_TOKEN is not the sandbox token the live function expects (got ${token.length} characters, fingerprint ${fingerprint || '-'}; expected ${SANDBOX_TOKEN_LENGTH} characters, fingerprint ${SANDBOX_TOKEN_FINGERPRINT})`);
}
if (webhookKey.length < 32) stop(`GOKWIK_WEBHOOK_KEY must be 32 or more characters (got ${webhookKey.length})`);

// Unique per run, so a second run never hits "this payment was already used".
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const paymentId = `gkpay_sandbox_${stamp}`;
const gokwikOrderId = `GK-SANDBOX-${stamp}`;

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

const json = (value) => JSON.stringify(value, null, 2);
const BEARER = `Bearer ${token}`;

function url(route, query = []) {
  const u = new URL(`${BASE_URL}${route}`);
  for (const [key, value] of query) u.searchParams.set(key, value);
  return {
    raw: u.toString(),
    protocol: 'https',
    host: u.hostname.split('.'),
    path: u.pathname.split('/').filter(Boolean),
    ...(query.length ? { query: query.map(([key, value]) => ({ key, value })) } : {}),
  };
}

// One request. `authorization` is the exact header value sent (null = no header).
function item(name, description, { method = 'POST', route, body, query = [], authorization = BEARER }) {
  const header = [];
  if (method === 'POST') header.push({ key: 'Content-Type', value: 'application/json' });
  if (authorization !== null) header.push({ key: 'Authorization', value: authorization });
  return {
    name,
    request: {
      method,
      header,
      auth: { type: 'noauth' },
      ...(method === 'POST' ? { body: { mode: 'raw', raw: json(body), options: { raw: { language: 'json' } } } } : {}),
      url: url(route, query),
      description,
    },
    response: [],
  };
}

const placeOrder = {
  cart_id: cart,
  payment_details: {
    payment_method: 'prepaid',
    payment_amount: amount,
    payment_id: paymentId,
    payment_instrument: 'upi',
    pg_payment_trnx_id: `pg_txn_${stamp}`,
  },
  shipping_address: ADDRESS,
  customer_phone: ADDRESS.phone,
  meta_data: { gokwik_order_id: gokwikOrderId, discounts: [], other_charges: [], rto_risk_flag: 'LOW_RISK' },
};

const paymentData = { merchantId: SANDBOX_MID, paymentId, merchantReferenceId: gokwikOrderId, amount, method: 'upi', provider: 'sandbox', udf4: cart };
paymentData.hmac = createHash('sha512').update(`${paymentData.merchantReferenceId}|${paymentData.paymentId}|${paymentData.amount}`).digest('hex');
const webhookQuery = (key) => [['key', key]];

const errors = [
  item('1a Get Cart - no token', 'Expect 401. `problems`: "No token arrived: the request had no Authorization or X-API-Key header."', { route: '/get-cart', body: { cart_id: cart }, authorization: null }),
  item('1b Get Cart - wrong token', `Expect 401. "problems": "Authorization has a ${WRONG_TOKEN.length}-character value that is not our access token. Our access tokens are 64 characters long."`, { route: '/get-cart', body: { cart_id: cart }, authorization: `Bearer ${WRONG_TOKEN}` }),
  item('1c Get Cart - unknown cart', 'Expect 400 `Invalid cart id`.', { route: '/get-cart', body: { cart_id: UNKNOWN_CART } }),
  item('1d Get Cart - unfilled Postman variable', 'GoKwik\'s mistake of 18 Nov, on purpose. Expect 401. `problems` names the variable {{access_token}} as having no value. (If your Postman has a variable called access_token set to the right token, this one answers 200 instead.)', { route: '/get-cart', body: { cart_id: cart }, authorization: 'Bearer {{access_token}}' }),
  item('1e Set Shipping Address - unknown cart, bad phone', 'Expect 400 (`Invalid cart id`). Nothing is saved.', { route: '/set-shipping-address', body: { cart_id: UNKNOWN_CART, shipping_address: { ...ADDRESS, phone: '12345' } } }),
  item('1f Payments webhook - wrong key', 'Expect 401 `not authorized`. Nothing is recorded.', { route: '/webhooks/payments', query: webhookQuery('wrong-key'), authorization: null, body: { event: 'transaction.successful', entity: 'transaction', data: paymentData } }),
];

const flow = [
  item('2a Get Cart (POST)', `Expect 200. \`data.cart\`: the book(s) in your cart with real price, MRP and stock; \`subtotal\` and \`total\` = ${amount}; no shipping fields yet (or the address saved earlier).`, { route: '/get-cart', body: { cart_id: cart } }),
  item('2b Get Cart (GET)', 'Expect the same answer as 2a, with the cart id in the address instead of a body.', { method: 'GET', route: '/get-cart', query: [['cart_id', cart]] }),
  item('2c Set Shipping Address', 'Expect 200. Live courier check of PIN 313001. `available_shipping_methods`: Free delivery; each item has `serviceable_status: true` and `metadata.edd` dates 3-7 days from today.', { route: '/set-shipping-address', body: { cart_id: cart, shipping_address: ADDRESS } }),
  item('2d Set Shipping Option', 'Expect 200. `selected_shipping_method`: free_delivery; `estimate_delivery_date.message_to_be_displayed`: "Estimated delivery in 3-7 days".', { route: '/set-shipping-option', body: { cart_id: cart, shipping_option: 'free_delivery' } }),
  item('2e Check Order Exists (before)', 'Expect 200 `{ "message": "No order found." }`.', { route: '/check-order-exists', body: { session_key: cart } }),
  item('2f Place Order (prepaid)', `Expect 200 \`status: success\`, \`order_id: KAK-<number>\` and \`thankyou_redirect_url\` on the test shop. Makes ONE sandbox test order (never shipped, no stock change) and closes this cart. payment_amount = ${amount}.`, { route: '/place-order', body: placeOrder }),
  item('2g Place Order again (same body)', 'Expect the same answer as 2f, with the same KAK number: no second order.', { route: '/place-order', body: placeOrder }),
  item('2h Check Order Exists (after)', 'Expect 200 `{ "order_id": "KAK-<number>", "message": "Order exists." }` with the number from 2f.', { route: '/check-order-exists', body: { session_key: cart } }),
];

const webhooks = [
  item('3a Payments webhook (transaction.successful)', `Expect 200 \`{ "ok": true }\`. Records the payment ${paymentId} against the order from 2f. Real sandbox merchant id, correct hash.`, { route: '/webhooks/payments', query: webhookQuery(webhookKey), authorization: null, body: { event: 'transaction.successful', entity: 'transaction', data: paymentData } }),
  item('3b Abandoned-cart webhook (unknown cart)', 'Expect 200 `{ "ok": true, "marked": 0 }`. Changes nothing.', { route: '/webhooks/abandoned-cart', query: webhookQuery(webhookKey), authorization: null, body: { carts: [{ cart_id: UNKNOWN_CART }] } }),
];

const collection = {
  info: {
    name: `Kitaab Aur Kona - GoKwik live sandbox check (${stamp})`,
    description: [
      `Calls the live gokwik function with real values. Cart ${cart}, amount ${amount}, sandbox merchant id ${SANDBOX_MID}.`,
      'Run the requests in order (Runner, or one by one). Each request says what answer to expect.',
      'Contains the sandbox access token and webhook key: do not share this file outside GoKwik.',
    ].join('\n'),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [
    { name: '1 Error checks (no changes)', item: errors },
    { name: '2 Checkout flow', item: flow },
    { name: '3 Webhooks', item: webhooks },
  ],
};

const text = JSON.stringify(collection, null, 2);
// The only {{...}} allowed is the deliberate one in 1d.
const braces = text.match(/\{\{[^}]*\}\}/g) ?? [];
if (braces.some((b) => b !== '{{access_token}}') || braces.length > 2) stop(`unexpected Postman variables in the collection: ${[...new Set(braces)].join(', ')}`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${text}\n`);
const count = collection.item.reduce((n, folder) => n + folder.item.length, 0);
console.log(`Wrote ${OUT}: ${count} requests (cart ${cart}, amount ${amount}, payment ${paymentId})`);
