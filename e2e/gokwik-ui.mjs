// Browser checks for checkout through GoKwik. Builds the site with a test GoKwik
// merchant id into e2e/shots/gokwik-build (gitignored), serves it with the real security
// headers (vite preview) and clicks through checkout in Chrome.
//
// Nothing real is called: Supabase is fake-supabase.mjs (the real schema.sql in PGlite),
// GoKwik's script is a stand-in that records what the site asks of it, and GoKwik's
// servers are played by this script calling the real `gokwik` Edge Function handler.
// Run: node e2e/gokwik-ui.mjs      Screenshots go to e2e/shots/.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createClient } from '@supabase/supabase-js';
import { createBackend, fetchPublicBooks, handleAuth, handleRest, SERVICE_TOKEN, USERS } from './fake-supabase.mjs';
import { createHandler } from '../supabase/functions/gokwik/handler.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5204;
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = path.join(ROOT, 'e2e', 'shots');
const BUILD = path.join(SHOTS, 'gokwik-build');
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const MID = 'testmid123';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${String(detail).slice(0, 300)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range, range' };

// ---------- The site, built with GoKwik switched on ----------
// The test shop (staging) is built too, told it is "production", to show it stays sandbox.
const STAGING_PORT = 5205;
const STAGING_BASE = `http://localhost:${STAGING_PORT}`;
const STAGING_BUILD = path.join(SHOTS, 'gokwik-staging-build');
async function buildAndServe(outDir, port, args, env) {
  const built = spawnSync(process.execPath, [VITE, 'build', ...args, '--outDir', outDir, '--emptyOutDir'], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (built.status !== 0) {
    console.error(built.stdout, built.stderr);
    process.exit(1);
  }
  const server = spawn(process.execPath, [VITE, 'preview', '--outDir', outDir, '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://localhost:${port}`);
      break;
    } catch {
      await sleep(200);
    }
  }
  return server;
}
const preview = await buildAndServe(BUILD, PORT, [], { VITE_GOKWIK_MID: MID });
const stagingPreview = await buildAndServe(STAGING_BUILD, STAGING_PORT, ['--mode', 'staging'], { VITE_GOKWIK_MID: MID, VITE_GOKWIK_ENV: 'production' });

// ---------- Fake Supabase, and the real gokwik function in this process ----------
const db = await createBackend({ schemaPath: path.join(ROOT, 'supabase', 'schema.sql'), books: await fetchPublicBooks(path.join(ROOT, '.env.local')) });
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const inProcessFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const request = { method: init.method || 'GET', url, headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body };
  const r = url.pathname.startsWith('/rest/v1/') ? await handleRest(db, request) : handleAuth(request);
  return new Response(r.body ?? '', { status: r.status, headers: { 'content-type': 'application/json', ...(r.headers || {}) } });
};
const TOKEN = 'ui-test-access-token-0123456789abcdef';
const gokwik = createHandler({
  db: createClient('https://fake.supabase.co', SERVICE_TOKEN, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: inProcessFetch } }),
  environments: { production: { token: TOKEN, merchantId: MID, api: null }, sandbox: { token: '', merchantId: '', api: null } },
  webhookKey: '',
  cronSecret: '',
  checkPincode: async () => ({ deliverable: true, cod: true }),
  siteOrigins: [BASE],
  log: { info() {}, warn() {}, error() {} },
});
// GoKwik's servers calling the store.
async function gk(route, body) {
  const res = await gokwik(new Request(`https://fake.supabase.co/functions/v1/gokwik${route}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
const ADDRESS = { pincode: '313001', city: 'Udaipur', state: 'Rajasthan', first_name: 'Asha', last_name: 'Rao', address: '12 MG Road, Near City Palace', email: 'asha@example.com', phone: '9876543210' };

// GoKwik's script, replaced by one that only records what the site asks of it.
const FAKE_SDK = `window.__gk = { inits: [], listeners: {} };
window.gokwikSdk = {
  on(event, fn) { (window.__gk.listeners[event] = window.__gk.listeners[event] || []).push(fn); },
  initCheckout(options) { window.__gk.inits.push(options); },
  close() {},
};`;
const fire = (page, event) => page.evaluate((e) => (window.__gk.listeners[e] || []).forEach((fn) => fn({})), event);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
async function newPage({ width = 1280, height = 900, sdk = 'ok' } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  const errors = [];
  const sdkRequests = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|DevTools/.test(m.text())) errors.push(m.text());
  });
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const url = new URL(req.url());
    if (url.hostname.endsWith('gokwik.co')) {
      sdkRequests.push(url.href);
      if (sdk === 'blocked') return req.abort('failed');
      return req.respond({ status: 200, headers: { 'content-type': 'application/javascript' }, body: FAKE_SDK });
    }
    if (!url.hostname.endsWith('.supabase.co')) return req.continue();
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
    if (url.pathname.startsWith('/functions/v1/')) return req.respond({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, data: { pincode: '313001', deliverable: true, cod: true } }) });
    const input = { method: req.method(), url, headers: req.headers(), body: req.postData() };
    const r = url.pathname.startsWith('/rest/v1/') ? await handleRest(db, input) : handleAuth(input);
    return req.respond({ status: r.status, headers: { ...CORS, 'content-type': 'application/json', ...(r.headers || {}) }, body: r.body ?? '' });
  });
  return { page, ctx, errors, sdkRequests };
}
let siteBase = BASE;
const goto = (page, p) => page.goto(`${siteBase}${p}`, { waitUntil: 'domcontentloaded' });
const waitSel = (page, sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
const waitFor = (page, fn, ms = 8000, ...args) => page.waitForFunction(fn, { timeout: ms }, ...args).then(() => true).catch(() => false);
const payButton = (page) => page.$$eval('main .btn-primary', (bs) => bs.filter((b) => /Continue to payment/.test(b.textContent)).length);
const clickPay = (page) => page.$$eval('main .btn-primary', (bs) => bs.find((b) => /Continue to payment/.test(b.textContent))?.click());

async function signIn(page) {
  await goto(page, '/sign-in');
  await waitSel(page, '#email');
  await page.type('#email', 'reader@example.com');
  await page.type('#password', 'reader-pass-1');
  await page.click('button[type=submit]');
  await waitFor(page, () => location.pathname === '/');
}
// One book into the cart from the home page, then the checkout page.
async function toCheckout(page, query = '') {
  await goto(page, '/');
  await waitSel(page, '.book-card .btn-card:not([aria-disabled])');
  await page.$$eval('.book-card .btn-card:not([aria-disabled])', (bs) => bs[0].click());
  await waitFor(page, () => [...document.querySelectorAll('.cart-button, .floating-cart')].some((b) => /^Cart, 1 item/.test(b.getAttribute('aria-label') ?? '')), 5000);
  await goto(page, `/checkout${query}`);
}

try {
  const headers = (await fetch(`${BASE}/`)).headers;
  const csp = headers.get('content-security-policy') ?? '';
  check("the security policy lets GoKwik's script, popup and calls through, and nothing else new", /script-src [^;]*https:\/\/\*\.gokwik\.co/.test(csp) && /frame-src https:\/\/\*\.gokwik\.co;/.test(csp) && /connect-src [^;]*https:\/\/\*\.gokwik\.co/.test(csp) && !/unsafe-eval/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp) && /frame-ancestors 'none'/.test(csp), csp);

  // ---------- Paying online ----------
  {
    const { page, ctx, errors, sdkRequests } = await newPage();
    await signIn(page);
    await toCheckout(page);
    check('checkout: one "Continue to payment" button and no address form', (await waitSel(page, '.line-list .line')) && (await payButton(page)) === 1 && (await page.$('#ship-name')) === null);
    check("checkout: GoKwik's script is not loaded before it is needed", sdkRequests.length === 0);
    await page.screenshot({ path: path.join(SHOTS, 'gokwik-checkout-1280.png'), fullPage: true });
    await clickPay(page);
    check('checkout: GoKwik is opened once', await waitFor(page, () => window.__gk?.inits.length === 1));
    const init = await page.evaluate(() => window.__gk.inits[0]);
    const cartId = init.merchantParams?.merchantCheckoutId ?? '';
    check('checkout: GoKwik gets the merchant id, sandbox mode and a cart id', init.mid === MID && init.environment === 'sandbox' && init.type === 'merchantInfo' && /^[0-9a-f-]{36}-[1-9][0-9]*$/.test(cartId), JSON.stringify(init));
    check("checkout: the customer's mobile is prefilled and no sign-in token is handed over", init.phoneNumber === '9876543210' && !JSON.stringify(init).includes('eyJ'));
    check("checkout: GoKwik gets the customer's account id as customerToken, matching the cart id", init.merchantParams.customerToken === USERS['reader@example.com'].id && cartId.startsWith(`${init.merchantParams.customerToken}-`), JSON.stringify(init.merchantParams));
    check('checkout: the fallback address is the site checkout', init.nativeCheckoutUrl === `${BASE}/checkout?native=1`);
    check('checkout: the script came from the GoKwik sandbox host', sdkRequests.length === 1 && sdkRequests[0] === 'https://sandbox.pdp.gokwik.co/v4/build/gokwik.js');
    const cart = await one(`select user_id, item_count, site from public.checkout_carts where id = $1`, [cartId]);
    check('checkout: the cart is saved for the signed-in customer', cart?.user_id === USERS['reader@example.com'].id && cart.item_count === 1 && cart.site === BASE, JSON.stringify(cart));
    check('checkout: the button is not left busy', await waitFor(page, () => [...document.querySelectorAll('main .btn-primary')].every((b) => b.getAttribute('aria-busy') !== 'true'), 3000));

    // GoKwik's servers read the cart, set the address and place the paid order.
    const got = await gk('/get-cart', { cart_id: cartId });
    await gk('/set-shipping-address', { cart_id: cartId, shipping_address: ADDRESS });
    const placed = await gk('/place-order', { cart_id: cartId, payment_details: { payment_method: 'prepaid', payment_amount: got.json.data.cart.total, payment_id: 'KWIKUI0001', payment_instrument: 'upi', pg_payment_trnx_id: 'PGUI1' }, shipping_address: ADDRESS, customer_phone: '9876543210' });
    check('GoKwik places the paid order with the store', placed.json.status === 'success', JSON.stringify(placed.json));
    await fire(page, 'order-complete');
    check('after payment the order page opens', await waitFor(page, () => /^\/orders\/[0-9a-f-]{36}$/.test(location.pathname)));
    check('order page: says the payment was received', await waitFor(page, () => /Order placed\. Payment received\./.test(document.body.innerText) && /Paid online/.test(document.body.innerText)));
    check('order page: shown as Paid', (await page.$eval('.page-head .status', (e) => e.textContent.trim()).catch(() => null)) === 'Paid');
    check('the ordered book left the cart', await waitFor(page, () => !localStorage.getItem('kitaab_cart_v2') || !/"[0-9a-f-]{36}"/.test(localStorage.getItem('kitaab_cart_v2')), 3000), await page.evaluate(() => localStorage.getItem('kitaab_cart_v2')));
    await page.screenshot({ path: path.join(SHOTS, 'gokwik-order-paid-1280.png'), fullPage: true });
    check('no script errors or blocked resources on the way', errors.length === 0, errors.join(' | '));

    // ---------- Closing GoKwik without ordering ----------
    await toCheckout(page);
    await waitSel(page, '.line-list .line');
    await clickPay(page);
    await waitFor(page, () => window.__gk?.inits.length === 1);
    await fire(page, 'checkout-close');
    await sleep(600);
    check('closing GoKwik without ordering stays on checkout', new URL(page.url()).pathname === '/checkout' && (await payButton(page)) === 1);
    await clickPay(page);
    check('...and the button opens GoKwik again with the same cart id', (await waitFor(page, () => window.__gk.inits.length === 2)) && (await page.evaluate(() => window.__gk.inits[0].merchantParams.merchantCheckoutId === window.__gk.inits[1].merchantParams.merchantCheckoutId)));

    // Closed after the order went through (the "order complete" event never came).
    const cart2 = await page.evaluate(() => window.__gk.inits[1].merchantParams.merchantCheckoutId);
    const got2 = await gk('/get-cart', { cart_id: cart2 });
    const cod = await gk('/place-order', {
      cart_id: cart2,
      payment_details: { payment_method: 'cod', payment_amount: got2.json.data.cart.total - 20, payment_id: 'KWIKUI0002', payment_instrument: 'cod', pg_payment_trnx_id: '' },
      shipping_address: ADDRESS,
      customer_phone: '9876543210',
      meta_data: { discounts: [{ amount: 20, code: 'TEST20', type: 'gkp-coupon' }] },
    });
    check('GoKwik places a cash on delivery order with a discount', cod.json.status === 'success', JSON.stringify(cod.json));
    await fire(page, 'checkout-close');
    check('closing GoKwik after the order was placed still opens the order', await waitFor(page, () => /^\/orders\/[0-9a-f-]{36}$/.test(location.pathname)));
    const due = got2.json.data.cart.total - 20;
    check('order page: discount, order total and the cash to pay', await waitFor(page, (amount) => /Offer discount/.test(document.body.innerText) && /Order total/.test(document.body.innerText) && new RegExp(`Pay ₹\\s?${amount.toLocaleString('en-IN')} in cash`).test(document.body.innerText), 6000, due), await page.evaluate(() => document.querySelector('.summary')?.innerText));
    await page.screenshot({ path: path.join(SHOTS, 'gokwik-order-cod-discount-1280.png'), fullPage: true });

    // ---------- GoKwik cannot start: the site's own checkout takes over ----------
    await toCheckout(page);
    await waitSel(page, '.line-list .line');
    await clickPay(page);
    await waitFor(page, () => window.__gk?.inits.length === 1);
    await fire(page, 'checkout-initiation-failure');
    check("if GoKwik cannot start, the site's own checkout appears with a notice", (await waitSel(page, '#ship-name', 5000)) && (await waitFor(page, () => /Online payment could not be opened/.test(document.body.innerText), 3000)));
    await goto(page, '/checkout?native=1');
    check("the fallback address shows the site's own checkout", (await waitSel(page, '#ship-name', 8000)) && (await payButton(page)) === 0);
    check('no script errors in the fallback', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- GoKwik's script blocked (ad blocker, network) ----------
  {
    const { page, ctx } = await newPage({ sdk: 'blocked' });
    await signIn(page);
    await toCheckout(page);
    await waitSel(page, '.line-list .line');
    await clickPay(page);
    check("if GoKwik's script cannot load, the site's own checkout appears", (await waitSel(page, '#ship-name', 8000)) && (await waitFor(page, () => /Online payment could not be opened/.test(document.body.innerText), 3000)));
    await ctx.close();
  }

  // ---------- The test shop (staging) ----------
  {
    siteBase = STAGING_BASE;
    const html = await (await fetch(`${STAGING_BASE}/`)).text();
    check('test shop: hidden from search engines and titled as the test shop', /<meta name="robots" content="noindex, nofollow"/.test(html) && html.includes('<title>Kitaab Aur Kona (test shop)</title>'));
    check('live store build: no test shop bar or noindex', !/noindex/.test(await (await fetch(`${BASE}/`)).text()));
    const { page, ctx, sdkRequests } = await newPage();
    await signIn(page);
    check('test shop: the "Test shop" bar is shown', await waitFor(page, () => /Test shop/.test(document.querySelector('.test-site-bar')?.textContent ?? ''), 5000));
    await toCheckout(page);
    await waitSel(page, '.line-list .line');
    await clickPay(page);
    await waitFor(page, () => window.__gk?.inits.length === 1);
    const init = await page.evaluate(() => window.__gk.inits[0]);
    check('test shop: GoKwik is always the sandbox, even if the build says production', init.environment === 'sandbox' && sdkRequests[0] === 'https://sandbox.pdp.gokwik.co/v4/build/gokwik.js', JSON.stringify({ env: init.environment, sdkRequests }));
    await fire(page, 'checkout-initiation-failure');
    check('test shop: if GoKwik cannot start, there is no cash on delivery form', (await waitFor(page, () => /GoKwik sandbox checkout could not be opened/.test(document.body.innerText), 5000)) && (await page.$('#ship-name')) === null);
    await goto(page, '/checkout?native=1');
    check("test shop: GoKwik's fallback address offers no cash on delivery either", (await waitFor(page, () => /could not be opened/.test(document.body.innerText), 8000)) && (await page.$('#ship-name')) === null);
    await page.screenshot({ path: path.join(SHOTS, 'gokwik-staging-blocked-1280.png'), fullPage: true });
    await ctx.close();
    siteBase = BASE;
  }

  // ---------- Phone width ----------
  for (const width of [320, 375, 768]) {
    const { page, ctx } = await newPage({ width, height: 800 });
    await signIn(page);
    await toCheckout(page);
    await waitSel(page, '.line-list .line');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`checkout at ${width}px: no sideways scrolling and the button is visible`, overflow <= 0 && (await payButton(page)) === 1, `overflow ${overflow}`);
    if (width === 375) await page.screenshot({ path: path.join(SHOTS, 'gokwik-checkout-375.png'), fullPage: true });
    await ctx.close();
  }
} finally {
  await browser.close();
  preview.kill();
  stagingPreview.kill();
  await db.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
