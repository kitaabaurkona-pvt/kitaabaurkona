// The gokwik function's request handling, kept free of Deno-only code so it can be
// tested with Node. index.js wires it to Supabase.
//
// Who calls what (nothing here is called by the website's browser code):
//   GoKwik's servers   POST /get-cart, /set-shipping-address, /set-shipping-option,
//                      /place-order, /check-order-exists (the first and last also GET)
//                      with "Authorization: Bearer <our access token>" (or the token in
//                      an X-API-Key header, see sentTokens). There is one
//                      token for GoKwik's production and one for its sandbox; an order
//                      placed with the sandbox token is a test order and is never shipped.
//   GoKwik's webhooks  POST /webhooks/payments, /webhooks/abandoned-cart
//                      with the webhook key in the address (?key=...)
//   scheduler (cron)   POST /jobs/push-updates, /jobs/health with the cron secret header
//
// The cart is ours: prices, stock and totals come from the database, never from GoKwik.
// GoKwik tells us the delivery address, how the order is paid and what it discounted.

import { GOKWIK_IPS, LIMITS, LIVE_SITE, REFUND_EVENTS, SHIPPING_METHOD, SITE_ORIGINS, TRANSACTION_EVENTS } from './config.js';
import { CART_ID, InputError, cartId, cartResponse, clean, merchantOrderId, money, parseAddress, parsePlaceOrder, webhookHashes } from './cart.js';
import { GokwikApiError } from './gokwik-api.js';

class AppError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Compares secrets without leaking their length or content through timing.
async function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const ax = new Uint8Array(x);
  const by = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ax.length; i++) diff |= ax[i] ^ by[i];
  return diff === 0;
}

const MERCHANT_ROUTES = ['/get-cart', '/set-shipping-address', '/set-shipping-option', '/place-order', '/check-order-exists'];
const WEBHOOK_ROUTES = ['/webhooks/payments', '/webhooks/abandoned-cart'];
const JOB_ROUTES = ['/jobs/push-updates', '/jobs/health'];
const ENVIRONMENTS = ['production', 'sandbox'];
// A secret shorter than this is treated as not set, so a blank or weak value never opens the door.
const MIN_SECRET = 32;

// The address a request came from, as Supabase's gateway reports it, with the header it
// was read from. Only the gateway's own headers are used, never the left end of
// x-forwarded-for, which a caller can write itself.
export function callerAddress(req) {
  const header = (name) => (req.headers.get(name) || '').trim();
  for (const name of ['cf-connecting-ip', 'x-real-ip']) {
    if (header(name)) return { ip: header(name).slice(0, 64), from: name };
  }
  const forwarded = header('x-forwarded-for').split(',').map((s) => s.trim()).filter(Boolean);
  if (forwarded.length) return { ip: forwarded[forwarded.length - 1].slice(0, 64), from: 'x-forwarded-for' };
  return { ip: '', from: '' };
}

const IP_CHECKS = ['off', 'log', 'enforce'];

// Where GoKwik's tools put our access token. Their checkout and their API validator can
// be set to "Authorization: Bearer <token>" or to an "X-API-Key" header, and people
// testing by hand send it in other ways too: with "Bearer" pasted into Postman's token
// box (Postman then sends "Bearer Bearer <token>"), without "Bearer", or in quotes. All
// of these carry the same secret, so all are accepted; only the secret itself counts.
const TOKEN_HEADERS = ['authorization', 'x-api-key', 'api-key', 'apikey', 'x-access-token', 'access-token', 'token'];
export function sentTokens(req) {
  const found = [];
  for (const header of TOKEN_HEADERS) {
    let value = (req.headers.get(header) || '').trim();
    for (let i = 0; i < 3; i++) value = value.replace(/^(bearer|token)(\s*[:=]\s*|\s+)/i, '').trim();
    value = value.replace(/^(["'])(.*)\1$/, '$2').trim();
    // Not shortened: a long access token must arrive whole to match (headers are limited
    // to a few KB by the gateway anyway).
    if (value) found.push({ header, value });
  }
  return found;
}

// First 8 hex characters of a value's SHA-256: enough to tell two tokens apart in the
// logs, useless for guessing one.
async function fingerprint(value) {
  if (typeof value !== 'string' || !value) return '';
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...digest.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Shown to a caller whose token was not accepted (GoKwik's team reads this in Postman or
// in their validator).
const TOKEN_HELP = 'not authorized: send the access token we gave you as "Authorization: Bearer <token>" (or in an "X-API-Key" header). The sandbox and production tokens are different.';

// What arrived instead of our token, said so the caller can fix it without asking us:
// an unfilled Postman variable is named (it is their own text), anything else is
// described by its length only. Nothing about our tokens is shown except their length.
export function tokenProblems(sent, expectedLength) {
  if (!sent.length) return ['No token arrived: the request had no Authorization or X-API-Key header.'];
  return sent.map(({ header, value }) => {
    const name = header === 'authorization' ? 'Authorization' : header === 'x-api-key' ? 'X-API-Key' : header;
    const variable = /^\{\{\s*([\w.-]{1,60})\s*\}\}$/.exec(value);
    if (variable) return `${name} contains the Postman variable {{${variable[1]}}}, which has no value: set "${variable[1]}" to the sandbox access token in your Postman environment or collection variables.`;
    if (/^\{\{/.test(value)) return `${name} contains an unfilled Postman variable: give it the sandbox access token as its value.`;
    const want = expectedLength ? ` Our access tokens are ${expectedLength} characters long.` : '';
    return `${name} has a ${value.length}-character value that is not our access token.${want}`;
  });
}

// environments: { production: { token, merchantId, api }, sandbox: { ... } } where api is
// createGokwikApi()'s result (null when GoKwik's keys are not set).
// checkPincode(pincode) -> { deliverable, cod } (the shipping function's PIN check).
// ipCheck: 'enforce' refuses GoKwik routes called from outside GoKwik's addresses, 'log'
// (the default) only notes them, 'off' does neither.
export function createHandler({ db, environments, webhookKey, cronSecret, checkPincode, deliveryDays = null, siteOrigins = SITE_ORIGINS, ipCheck = 'log', ipLists = GOKWIK_IPS, log = console, now = () => new Date() }) {
  const ipMode = IP_CHECKS.includes(ipCheck) ? ipCheck : 'log';
  const allIps = [...new Set(Object.values(ipLists).flat())];

  // Whether the caller's address is one GoKwik named for this environment (or for any,
  // for webhooks). In 'log' mode the answer is noted and the request goes on.
  function addressAllowed(req, route, environment) {
    if (ipMode === 'off') return true;
    const { ip, from } = callerAddress(req);
    const allowed = environment ? (ipLists[environment] ?? []) : allIps;
    const ok = Boolean(ip) && allowed.includes(ip);
    if (!ok || ipMode === 'log') log.info(JSON.stringify({ event: ok ? 'caller_address' : 'caller_address_not_listed', route, environment, ip, from, mode: ipMode }));
    return ok || ipMode === 'log';
  }
  const rpc = async (fn, args = {}) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) {
      const e = new Error(`db:${fn}`);
      e.db = error;
      throw e;
    }
    return data;
  };

  const tokenOf = (name) => {
    const token = environments?.[name]?.token;
    return typeof token === 'string' && token.length >= MIN_SECRET ? token : '';
  };

  // Which of GoKwik's environments is calling, by the access token it sent.
  async function environmentOf(req) {
    let found = null;
    for (const { value } of sentTokens(req)) {
      for (const name of ENVIRONMENTS) {
        if (await sameSecret(value, tokenOf(name))) found = name;
      }
    }
    return found;
  }

  // A refused token, logged so the cause can be seen without the secret: which headers
  // came, which ones carried something, its length and fingerprint, and the fingerprints
  // of the tokens we expect (compare with the SHA-256 of the token given to GoKwik).
  async function logRefusedToken(req, route, ref) {
    const sent = await Promise.all(sentTokens(req).map(async ({ header, value }) => ({ header, length: value.length, fingerprint: await fingerprint(value) })));
    const expected = {};
    for (const name of ENVIRONMENTS) expected[name] = { length: tokenOf(name).length, fingerprint: await fingerprint(tokenOf(name)) };
    const headers = [...req.headers.keys()].filter((name) => name !== 'cookie').slice(0, 40);
    log.warn(JSON.stringify({ event: 'token_refused', ref, route, method: req.method, sent, expected, headers, ip: callerAddress(req).ip, agent: (req.headers.get('user-agent') || '').slice(0, 80) }));
  }

  // A cart GoKwik may still work on: it exists, is not ordered yet and has not expired.
  async function openCart(id) {
    const cart = await rpc('gokwik_cart', { p_cart: id });
    if (!cart) throw new AppError(400, 'Invalid cart id');
    if (cart.order || cart.ordered) throw new AppError(400, 'This cart has already been ordered');
    if (cart.expired) throw new AppError(400, 'Cart expired');
    return cart;
  }

  const view = (cart, options = {}) => ({ data: { cart: cartResponse(cart, { deliveryDays, now: now(), ...options }) } });

  // The courier check for a PIN code. If the check itself cannot run, the address is
  // accepted, as on the site's own checkout: the parcel is checked again before booking.
  async function pinAnswer(pincode) {
    try {
      const answer = await checkPincode(pincode);
      return { deliverable: Boolean(answer?.deliverable), cod: Boolean(answer?.cod) };
    } catch {
      log.warn(JSON.stringify({ event: 'pin_check_unavailable' }));
      return { deliverable: true, cod: true };
    }
  }

  const merchant = {
    async '/get-cart'(body) {
      const cart = await openCart(cartId(body?.cart_id));
      if (cart.items.some((item) => (item.salable_qty ?? 0) < item.quantity)) {
        throw new AppError(400, 'Some books in this cart are no longer available');
      }
      return view(cart, { shipping: cart.shipping });
    },

    async '/set-shipping-address'(body) {
      const cart = await openCart(cartId(body?.cart_id));
      const address = parseAddress(body?.shipping_address);
      const shipping = { ...address, ...(await pinAnswer(address.pincode)) };
      await rpc('gokwik_set_address', { p_cart: cart.id, p_shipping: shipping });
      return view(cart, { shipping });
    },

    async '/set-shipping-option'(body) {
      const cart = await openCart(cartId(body?.cart_id));
      const option = typeof body?.shipping_option === 'string' ? body.shipping_option.trim().toLowerCase() : '';
      if (option !== SHIPPING_METHOD.id && option !== SHIPPING_METHOD.title.toLowerCase()) throw new AppError(400, 'Invalid shipping option');
      if (!cart.shipping?.deliverable) throw new AppError(400, 'Set a delivery address we can deliver to first');
      return view(cart, { shipping: cart.shipping, selected: true });
    },

    async '/place-order'(body, environment) {
      const request = parsePlaceOrder(body);
      const cart = await rpc('gokwik_cart', { p_cart: request.cart });
      if (!cart) throw new AppError(400, 'Invalid cart id');

      // The address in the request, or the one GoKwik set on the cart earlier.
      let shipping = null;
      try {
        shipping = parseAddress(request.address);
      } catch (e) {
        if (!(e instanceof InputError)) throw e;
        const saved = cart.shipping;
        if (saved?.pincode) shipping = { name: saved.name, phone: saved.phone, address: saved.address, city: saved.city, state: saved.state, pincode: saved.pincode };
      }
      if (!shipping && !cart.order) return { status: 'failed', reason: 'invalid shipping address' };

      const result = await rpc('gokwik_place_order', { p_cart: request.cart, p: { ...request.order, shipping: shipping ?? {}, environment } });
      const status = result?.status;
      if (status === 'placed' || status === 'exists') {
        const site = siteOrigins.includes(cart.site) ? cart.site : LIVE_SITE;
        return { status: 'success', order_id: merchantOrderId(result.order_number), thankyou_redirect_url: `${site}/orders/${result.order_id}` };
      }
      if (status === 'invalid_cart') throw new AppError(400, 'Invalid cart id');
      if (status === 'expired') throw new AppError(400, 'Cart expired');
      if (status === 'invalid_method') throw new AppError(400, 'invalid payment_method');
      const reasons = {
        unavailable: 'product is not available',
        amount_mismatch: 'payment amount does not match the cart',
        invalid_address: 'invalid shipping address',
        duplicate_payment: 'this payment was already used for another order',
      };
      return { status: 'failed', reason: reasons[status] ?? 'order could not be placed' };
    },

    // GoKwik asks this before retrying a Place Order that got no answer.
    async '/check-order-exists'(body) {
      const key = body?.session_key ?? body?.cart_id;
      const cart = typeof key === 'string' && CART_ID.test(key) ? await rpc('gokwik_cart', { p_cart: key }) : null;
      if (!cart?.order) return { message: 'No order found.' };
      return { order_id: merchantOrderId(cart.order.order_number), message: 'Order exists.' };
    },
  };

  const merchantIds = () => ENVIRONMENTS.map((name) => environments?.[name]?.merchantId).filter((id) => typeof id === 'string' && id);

  const webhooks = {
    // Payment and refund notices. The order itself is always made by Place Order; these
    // record what happened to the money and cancel an order GoKwik refunded by itself.
    async '/webhooks/payments'(body) {
      const data = body?.data;
      const event = typeof body?.event === 'string' ? body.event : '';
      if (!data || typeof data !== 'object' || typeof data.paymentId !== 'string' || !data.paymentId) throw new InputError('Invalid notice');
      const known = merchantIds();
      if (known.length && !known.includes(data.merchantId)) throw new AppError(401, 'not authorized');
      const sent = typeof data.hmac === 'string' ? data.hmac.toLowerCase() : '';
      let matches = false;
      for (const hash of await webhookHashes(data)) {
        if (await sameSecret(sent, hash)) matches = true;
      }
      if (!matches) {
        log.warn(JSON.stringify({ event: 'webhook_hash_mismatch', notice: event.slice(0, 40) }));
        throw new AppError(401, 'not authorized');
      }
      if (!TRANSACTION_EVENTS.includes(event) && !REFUND_EVENTS.includes(event)) return { ok: true, ignored: true };
      const result = await rpc('gokwik_record_event', {
        p: {
          event,
          payment_id: clean(data.paymentId, 100),
          transaction_payment_id: clean(data.transactionPaymentId, 100),
          reference_id: clean(data.merchantReferenceId, 100),
          cart_id: typeof data.udf4 === 'string' && CART_ID.test(data.udf4) ? data.udf4 : '',
          amount: Number.isFinite(Number(data.amount)) ? money(data.amount) : 0,
          detail: {
            method: clean(data.method, 40),
            provider: clean(data.provider, 40),
            refund_id: clean(data.refundId, 100),
            auto: data.auto === true,
          },
        },
      });
      if (result?.cancelled) log.warn(JSON.stringify({ event: 'order_cancelled_after_auto_refund', order: result.order_id }));
      return { ok: true };
    },

    // Carts GoKwik saw started but not ordered. Only carts of ours are marked.
    async '/webhooks/abandoned-cart'(body) {
      const carts = Array.isArray(body?.carts) ? body.carts : Array.isArray(body) ? body : [];
      const ids = [...new Set(carts.slice(0, LIMITS.abandonedCarts).flatMap((c) => [c?.cart_id, c?.merchant_checkout_id, c?.request_id]).filter((id) => typeof id === 'string' && CART_ID.test(id)))];
      const marked = ids.length ? await rpc('gokwik_mark_abandoned', { p_carts: ids }) : 0;
      return { ok: true, marked };
    },
  };

  const jobs = {
    // Sends queued order updates (AWB, status, cancellation, refund) to GoKwik.
    async '/jobs/push-updates'() {
      const ready = ENVIRONMENTS.filter((name) => environments?.[name]?.api);
      if (ready.length === 0) return { skipped: 'GoKwik API keys are not set' };
      const rows = (await rpc('gokwik_claim_updates', { p_environments: ready, p_limit: LIMITS.updateBatch })) ?? [];
      let sent = 0;
      for (const row of rows) {
        const payload = {
          merchant_order_id: merchantOrderId(row.order_number),
          order_status: row.order_status,
          awb_number: row.awb_number ?? '',
          awb_status: row.awb_status ?? '',
          shipping_provider: row.shipping_provider ?? '',
          order_note: row.order_note ?? '',
        };
        const refund = row.refund_amount !== null && row.refund_amount !== undefined;
        if (refund) payload.refund_amount = money(row.refund_amount);
        try {
          await environments[row.environment].api.updateOrder(payload);
          await rpc('gokwik_update_done', { p_id: row.id, p_ok: true });
          sent += 1;
        } catch (e) {
          if (!(e instanceof GokwikApiError)) throw e;
          // A refund that got no clear answer may have gone through: it is never sent
          // again by itself, an admin checks GoKwik's dashboard first.
          const final = refund && e.unclear;
          const note = final ? `${e.message}. This asked for a refund, so it is not retried: check the GoKwik dashboard.` : e.message;
          await rpc('gokwik_update_done', { p_id: row.id, p_ok: false, p_error: note, p_final: final });
          log.warn(JSON.stringify({ event: 'gokwik_update_failed', update: row.id, status: e.status, refund, final }));
        }
      }
      return { claimed: rows.length, sent };
    },

    // What is set up, without showing any secret.
    async '/jobs/health'() {
      const out = { webhook_key: typeof webhookKey === 'string' && webhookKey.length >= MIN_SECRET, delivery_days: deliveryDays, ip_check: ipMode };
      for (const name of ENVIRONMENTS) {
        out[name] = { merchant_api_token: Boolean(tokenOf(name)), merchant_id: Boolean(environments?.[name]?.merchantId), update_order_api: Boolean(environments?.[name]?.api) };
      }
      return out;
    },
  };

  // ---------- Request handling ----------

  return async function handle(req) {
    const started = Date.now();
    const ref = crypto.randomUUID().slice(0, 8);
    const reply = (status, body) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      });
    // GoKwik reads the reason from `error` (its examples nest it under `data` as well).
    const fail = (status, error, extra = {}) => reply(status, { error, ...extra, data: { error, ...extra }, ref });

    let url;
    try {
      url = new URL(req.url);
    } catch {
      return fail(400, 'Invalid request');
    }
    const match = /\/gokwik((?:\/[a-z-]+){1,2})\/?$/.exec(url.pathname);
    const route = match?.[1] ?? '';
    const kind = MERCHANT_ROUTES.includes(route) ? 'merchant' : WEBHOOK_ROUTES.includes(route) ? 'webhook' : JOB_ROUTES.includes(route) ? 'job' : null;
    if (!kind) return fail(404, 'Not found');
    // No browser ever calls this function, so there is no CORS: preflights are refused.
    // The two read-only GoKwik routes also take GET (GoKwik's API validator defaults to
    // it), with the cart id in the address.
    const readOnly = route === '/get-cart' || route === '/check-order-exists';
    if (req.method !== 'POST' && !(readOnly && req.method === 'GET')) return fail(405, 'Method not allowed: use POST');

    let environment = null;
    try {
      if (kind === 'merchant') {
        environment = await environmentOf(req);
        if (!environment) {
          await logRefusedToken(req, route, ref);
          const lengths = [...new Set(ENVIRONMENTS.map((name) => tokenOf(name).length).filter(Boolean))];
          return fail(401, TOKEN_HELP, { problems: tokenProblems(sentTokens(req), lengths.length === 1 ? lengths[0] : 0) });
        }
        if (!addressAllowed(req, route, environment)) return fail(403, 'not authorized');
      } else if (kind === 'webhook') {
        const expected = typeof webhookKey === 'string' && webhookKey.length >= MIN_SECRET ? webhookKey : '';
        const sent = url.searchParams.get('key') || req.headers.get('x-webhook-key') || '';
        if (!(await sameSecret(sent, expected))) return fail(401, 'not authorized');
        if (!addressAllowed(req, route, null)) return fail(403, 'not authorized');
      } else {
        let expected = '';
        try {
          expected = typeof cronSecret === 'function' ? await cronSecret() : cronSecret;
        } catch {
          expected = '';
        }
        if (!(await sameSecret(req.headers.get('x-cron-secret'), expected))) return fail(401, 'not authorized');
      }

      const max = kind === 'webhook' ? LIMITS.webhookBodyBytes : LIMITS.bodyBytes;
      if (Number(req.headers.get('content-length') || 0) > max) return fail(413, 'Request too large');
      const raw = await req.text();
      if (raw.length > max) return fail(413, 'Request too large');
      let body = null;
      if (raw.trim()) {
        try {
          body = JSON.parse(raw);
        } catch {
          // A form post (cart_id=...) from a hand-made test is read too.
          if (!/application\/x-www-form-urlencoded/i.test(req.headers.get('content-type') || '')) return fail(400, 'Invalid JSON');
          body = Object.fromEntries(new URLSearchParams(raw));
        }
      }
      // For GoKwik's routes, values in the address (?cart_id=...) fill in what the body
      // does not give. (Webhooks keep their own ?key=, which is not data.)
      if (kind === 'merchant') {
        const query = Object.fromEntries([...url.searchParams].filter(([name]) => /^[a-z_]{1,40}$/i.test(name)));
        if (Object.keys(query).length && (body === null || (typeof body === 'object' && !Array.isArray(body)))) body = { ...query, ...(body ?? {}) };
      }

      const table = kind === 'merchant' ? merchant : kind === 'webhook' ? webhooks : jobs;
      const data = await table[route](body, environment);
      log.info(JSON.stringify({ ref, route, environment, ok: true, ms: Date.now() - started }));
      return reply(200, data);
    } catch (e) {
      if (e instanceof InputError) {
        return fail(400, e.message, e.field ? { invalid_address_field: e.field } : {});
      }
      if (e instanceof AppError) {
        log.info(JSON.stringify({ ref, route, environment, ok: false, status: e.status }));
        return fail(e.status, e.message, e.extra);
      }
      log.error(JSON.stringify({ ref, route, environment, ok: false, error: String(e?.message ?? e).slice(0, 120), code: e?.db?.code ?? null }));
      return fail(500, 'internal server error');
    }
  };
}
