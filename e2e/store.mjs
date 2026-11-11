// Browser checks for the storefront. Run the dev server (npm run dev -- --port 5199)
// or a preview build, then: npm run e2e   (BASE=http://localhost:5200 for a preview).
//
// Supabase requests are answered by fake-supabase.mjs: the real schema.sql in PGlite,
// seeded with the public catalogue read live with the anon key from .env.local.
// Screenshots go to e2e/shots/ (gitignored).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createClient } from '@supabase/supabase-js';
import { createBackend, fetchPublicBooks, handleAuth, handleRest, SERVICE_TOKEN } from './fake-supabase.mjs';
import { createHandler } from '../supabase/functions/shipping/handler.js';
import { createXpressbees } from '../supabase/functions/shipping/xpressbees.js';
import { SEARCH_HINTS } from '../src/utils/searchHints.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://localhost:5199';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = path.join(ROOT, 'e2e', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${String(detail).slice(0, 300)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
  'access-control-expose-headers': 'content-range, range',
};

const books = await fetchPublicBooks(path.join(ROOT, '.env.local'));
const db = await createBackend({ schemaPath: path.join(ROOT, 'supabase', 'schema.sql'), books });
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

// The real `shipping` Edge Function, run in this process. It reaches the fake database
// through an in-process fetch and a stand-in Xpressbees that answers like the real API.
const inProcessFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const request = { method: init.method || 'GET', url, headers, body: init.body };
  const r = url.pathname.startsWith('/rest/v1/') ? await handleRest(db, request) : handleAuth(request);
  return new Response(r.body ?? '', { status: r.status, headers: { 'content-type': 'application/json', ...(r.headers || {}) } });
};
const XB_CALLS = [];
const xbToken = `eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 10800 })).toString('base64url')}.sig`;
async function fakeXpressbees(url, init = {}) {
  const p = new URL(url).pathname;
  const body = init.body ? JSON.parse(init.body) : null;
  XB_CALLS.push(p);
  const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  if (p === '/api/users/login') return json(200, { status: true, data: xbToken });
  if (p === '/api/courier/serviceability') {
    return json(200, { status: true, data: body.destination === '799999' ? [] : [{ id: '1', name: 'Surface Xpressbees 0.5 K.G', freight_charges: 50, cod_charges: 40, total_charges: 90 }] });
  }
  if (p === '/api/shipments2') {
    return json(200, {
      status: true,
      data: {
        order_id: 1, shipment_id: 2, awb_number: String(14344940300000 + XB_CALLS.length), courier_id: '1', courier_name: 'Surface Xpressbees 0.5 K.G', status: 'booked',
        label: 'https://xb-files.s3.amazonaws.com/labels/test.pdf', manifest: 'https://xb-files.s3.amazonaws.com/manifest/test.pdf',
      },
    });
  }
  if (p.startsWith('/api/shipments2/track/')) {
    return json(200, { status: true, data: { status: 'in transit', history: [{ status_code: 'IT', location: 'Udaipur', event_time: '2026-11-10 10:00', message: 'In Transit' }] } });
  }
  if (p === '/api/shipments2/manifest') return json(200, { status: true, data: 'https://xb-files.s3.amazonaws.com/manifest/test.pdf' });
  if (p === '/api/ndr') return json(200, { status: true, data: [] });
  return json(404, { status: false, message: 'Not found' });
}
const shippingDb = createClient('https://fake.supabase.co', SERVICE_TOKEN, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: inProcessFetch } });
const shippingFunction = createHandler({
  db: shippingDb,
  cronSecret: 'e2e-cron-secret-0123456789abcdef',
  allowedOrigins: [new URL(BASE).origin],
  log: { info() {}, warn() {}, error() {} },
  makeXpressbees: () =>
    createXpressbees({
      baseUrl: 'https://shipment.xpressbees.com',
      email: 'ops@example.com',
      password: 'e2e-password',
      fetchImpl: fakeXpressbees,
      tokenStore: {
        async get() {
          const { data } = await shippingDb.rpc('xb_token_get');
          return data?.[0]?.token ?? null;
        },
        async set(token, expiresAt) {
          await shippingDb.rpc('xb_token_set', { p_token: token, p_expires_at: expiresAt.toISOString() });
        },
      },
    }),
});

async function newPage({ width = 1280, height = 900, scheme = 'light', touch = false, prefs = null } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height, hasTouch: touch, isMobile: touch });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  if (prefs) await page.evaluateOnNewDocument((p) => localStorage.setItem('kitaab_corner_prefs', p), JSON.stringify(prefs));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|DevTools/.test(m.text())) errors.push(m.text());
  });
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const url = new URL(req.url());
    if (!url.hostname.endsWith('.supabase.co')) return req.continue();
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
    if (url.pathname === '/functions/v1/shipping') {
      const res = await shippingFunction(new Request('https://fake.supabase.co/functions/v1/shipping', { method: req.method(), headers: req.headers(), body: req.postData() }));
      return req.respond({ status: res.status, headers: { ...CORS, ...Object.fromEntries(res.headers) }, body: await res.text() });
    }
    const input = { method: req.method(), url, headers: req.headers(), body: req.postData() };
    const r = url.pathname.startsWith('/rest/v1/') ? await handleRest(db, input) : handleAuth(input);
    return req.respond({ status: r.status, headers: { ...CORS, 'content-type': 'application/json', ...(r.headers || {}) }, body: r.body ?? '' });
  });
  return { page, ctx, errors };
}

const goto = (page, p) => page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' });
const waitSel = (page, sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
const gone = (page, sel, ms = 3000) => page.waitForSelector(sel, { hidden: true, timeout: ms }).then(() => true).catch(() => false);
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => null);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const BLACK = 'rgb(0, 0, 0)';
// The header cart button names the count ("Cart, 2 items"); it waits for a flying cover.
const cartLabel = (page) => page.$eval('.cart-button', (b) => b.getAttribute('aria-label')).catch(() => null);
const waitCart = (page, n, ms = 3000) =>
  page
    .waitForFunction((want) => [...document.querySelectorAll('.cart-button, .floating-cart')].some((b) => b.getAttribute('aria-label') === want), { timeout: ms }, `Cart, ${n} ${n === 1 ? 'item' : 'items'}`)
    .then(() => true)
    .catch(() => false);
// Relative luminance of an rgb() colour, 0 (black) to 1 (white).
const luminance = (rgb) => {
  const [r, g, b] = (rgb.match(/\d+/g) ?? [0, 0, 0]).slice(0, 3).map((v) => Number(v) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const INVENTED = /BUMPER10|Rs\.?\s?200|extra discount|countdown|\d\dH:\d\dM|customer feedback|quality trust|★/i;
// Scroll the whole page so every reveal-on-scroll section has played (for screenshots).
const scrollThrough = (page) =>
  page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 500));
  });

try {
  // ---------- Security headers (vercel.json) ----------
  {
    const csp = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).headers[0].headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    const inline = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const hashes = inline.map((s) => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`);
    check('CSP allows exactly the inline theme script in index.html (update its hash if the script changes)', hashes.length === 1 && csp.includes(hashes[0]), hashes.join(' '));
    check('CSP blocks plugins, framing and other script sources', /object-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp) && !/script-src[^;]*unsafe-(inline|eval)/.test(csp));
    const served = (await fetch(`${BASE}/`)).headers.get('content-security-policy');
    if (new URL(BASE).port === '5200') check('the preview build is served with the CSP', Boolean(served && served.includes("default-src 'self'")), served);
  }

  // ---------- Visitor: Home (reading-corner design) ----------
  {
    const { page, ctx, errors } = await newPage();
    await goto(page, '/');
    check('home: three hero covers', await page.waitForFunction(() => document.querySelectorAll('.hero-book').length === 3, { timeout: 8000 }).then(() => true).catch(() => false));
    const heroLinks = await page.$$eval('.hero-book', (as) => as.map((a) => a.getAttribute('href')));
    const heroIds = heroLinks.map((h) => h.split('/').pop());
    const visibleHero = (await one(`select count(*)::int as n from public.books where is_visible and id::text = any($1::text[])`, [heroIds])).n;
    check('home: each hero cover opens a book in the store', heroLinks.every((h) => /^\/books\/[0-9a-f-]{36}$/.test(h)) && visibleHero === 3, JSON.stringify(heroLinks));
    check('home: Browse books opens the books in stock', (await page.$eval('.hero-cta', (a) => a.getAttribute('href'))) === '/books?stock=1');
    check('home: the budget tile opens books up to ₹299', (await page.$eval('.bento-budget', (a) => a.getAttribute('href'))) === '/books?max=299&stock=1');
    check('home: the fiction tile opens Literary Fiction', (await page.$eval('.bento-fiction', (a) => a.getAttribute('href'))) === '/books?category=Literary%20Fiction');
    const dbCategories = (await db.query(`select distinct category from public.books where is_visible and category is not null`)).rows.map((r) => r.category);
    const moods = await page.$$eval('.mood-tile', (as) => as.map((a) => new URL(a.href).searchParams.get('category')));
    check('home: every genre tile opens a category that has books', moods.length >= 5 && moods.every((c) => dbCategories.includes(c)), JSON.stringify(moods));
    check('home: "Books to start with" shows books', await waitSel(page, '.reading-shelf .book-card'));
    await waitSel(page, '.affordable-section .book-card');
    const cheap = await page.$$eval('.affordable-section .price-block .price', (ps) => ps.map((p) => Number(p.textContent.replace(/[^\d.]/g, ''))));
    check('home: "₹299 & under" shows up to 4 books, all ₹299 or less', cheap.length >= 1 && cheap.length <= 4 && cheap.every((n) => n <= 299), cheap.join(','));
    check('home: no invented promos, countdowns or reviews', !INVENTED.test(await page.$eval('body', (b) => b.innerText)));
    check('cards: every card has a full-width Add to cart button', (await page.$$('.book-card')).length === (await page.$$('.book-card .btn-card')).length);
    const cardBtn = await page.$eval('.book-card .btn-card:not([aria-disabled])', (b) => ({ radius: parseFloat(getComputedStyle(b).borderTopLeftRadius), bg: getComputedStyle(b).backgroundColor }));
    check('cards: Add to cart is a rounded accent button', cardBtn.radius >= 20 && cardBtn.bg !== BLACK && cardBtn.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(cardBtn));
    check(
      'header: logo and name on the left, search in the middle',
      await page.evaluate(() => {
        const logo = document.querySelector('.brand-logo').getBoundingClientRect();
        const search = document.querySelector('.header-search').getBoundingClientRect();
        return logo.left < 60 && /kitaab\s*aur\s*kona/i.test(document.querySelector('.brand-logo').getAttribute('aria-label') ?? '') && Math.abs(search.left + search.width / 2 - window.innerWidth / 2) < 80;
      }),
    );
    check('header: no count while the cart is empty', (await page.$('.mobile-cart-count')) === null && (await cartLabel(page)) === 'Cart, 0 items');
    const hint = await page.$eval('#header-search', (i) => i.placeholder);
    check('header search: the empty box suggests a real book or author', SEARCH_HINTS.includes(hint), hint);
    check('header search: the hint is slightly transparent', Number(await page.$eval('#header-search', (i) => getComputedStyle(i, '::placeholder').opacity)) < 1);
    const footerLinks = await page.$$eval('.site-footer a', (as) => as.map((a) => a.getAttribute('href')));
    check('footer: email and WhatsApp from the owner', footerLinks.includes('mailto:Kitaabaurkona@gmail.com') && footerLinks.some((h) => /wa\.me\/918690965448/.test(h ?? '')), JSON.stringify(footerLinks));
    check('footer: policy links', ['/about', '/returns', '/terms', '/privacy', '/shipping', '/settings'].every((h) => footerLinks.includes(h)), JSON.stringify(footerLinks));
    await scrollThrough(page);
    await page.screenshot({ path: path.join(SHOTS, 'home-light-1280.png'), fullPage: true });

    // ---------- Add to cart: + count − stepper, cover flies to the cart ----------
    const firstCard = await page.evaluateHandle(() => [...document.querySelectorAll('.reading-shelf .book-card, .affordable-section .book-card')].find((c) => c.querySelector('.btn-card:not([aria-disabled])')));
    await firstCard.evaluate((c) => c.scrollIntoView({ block: 'center' }));
    await sleep(400);
    const price = await firstCard.$eval('.price', (e) => e.textContent.trim());
    const before = await firstCard.$eval('.btn-card', (b) => Math.round(b.getBoundingClientRect().height));
    const yBefore = await page.evaluate(() => window.scrollY);
    await firstCard.$eval('.btn-card', (b) => b.click());
    check('add: a copy of the cover flies towards the cart', await waitSel(page, '.cart-flight img', 300));
    check('add: the cart count waits for the cover to land', (await cartLabel(page)) === 'Cart, 0 items', await cartLabel(page));
    await sleep(180);
    await page.screenshot({ path: path.join(SHOTS, 'flight-light-1280.png') });
    const landed = await page
      .waitForFunction(() => !document.querySelector('.cart-flight') && [...document.querySelectorAll('.cart-button, .floating-cart')].some((b) => b.getAttribute('aria-label') === 'Cart, 1 item'), { timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    check('add: it lands, disappears and the cart count becomes 1', landed);
    await sleep(300);
    check('add: the cart panel does not open', (await page.$('.cart-panel')) === null);
    check('add: no pop-up message', (await page.$('.toast')) === null);
    check('add: the page stays where it was', Math.abs((await page.evaluate(() => window.scrollY)) - yBefore) <= 1);
    check('add: the button becomes a − 1 + stepper', (await firstCard.$eval('.cart-stepper-number', (e) => e.textContent.trim()).catch(() => null)) === '1');
    check('add: the stepper is the same height as the button (nothing moves)', (await firstCard.$eval('.cart-stepper', (e) => Math.round(e.getBoundingClientRect().height))) === before);
    const stepperBg = await firstCard.$eval('.cart-stepper', (e) => getComputedStyle(e).backgroundColor);
    check('add: the stepper is dark ink, unlike the yellow button', luminance(stepperBg) < 0.2, stepperBg);
    check('add: focus moves to the stepper', await firstCard.evaluate((c) => c.querySelector('.cart-stepper').contains(document.activeElement)));
    await firstCard.$eval('[data-step="up"]', (b) => b.click());
    const two = await waitCart(page, 2);
    check('stepper: + adds one more (card and header show 2)', two && (await firstCard.$$eval('.cart-stepper-number', (es) => es.at(-1).textContent.trim()).catch(() => null)) === '2');
    await sleep(300);
    await firstCard.$eval('[data-step="down"]', (b) => b.click());
    check('stepper: − takes one away at once', await waitCart(page, 1));
    await sleep(300);
    await firstCard.$eval('[data-step="down"]', (b) => b.click());
    await sleep(300);
    check('stepper: − on the last copy brings back Add to cart', (await firstCard.$('.btn-card')) !== null && (await waitCart(page, 0)));
    await firstCard.$eval('.btn-card', (b) => b.click());
    await waitCart(page, 1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);

    // ---------- Cart panel ----------
    await page.click('.cart-button');
    check('panel: opens from the header cart button', await waitSel(page, '.cart-panel[role="dialog"]', 3000));
    await sleep(300);
    check('panel: focus moves inside', await page.evaluate(() => document.querySelector('.cart-panel').contains(document.activeElement)));
    check('panel: lists the book with its total', (await page.$$('.cart-panel .line')).length === 1 && (await text(page, '.cart-panel .line-total')) === price);
    check('panel: Checkout button shows the total', /^Checkout\s*•\s*₹/i.test(await page.$eval('.cart-panel .btn-primary', (b) => b.textContent.trim())));
    const inc = await page.$('.cart-panel .stepper button[aria-label="Increase quantity"]');
    if (inc) {
      await inc.click();
      check('panel: + raises the quantity and the header count', await waitCart(page, 2), await cartLabel(page));
    }
    await page.screenshot({ path: path.join(SHOTS, 'panel-light-1280.png') });
    await page.keyboard.press('Escape');
    check('panel: Escape closes it', await gone(page, '.cart-panel'));
    check('panel: focus returns to the cart button', await page.evaluate(() => document.activeElement?.classList.contains('cart-button')));
    await page.click('.cart-button');
    await waitSel(page, '.cart-panel');
    await sleep(300);
    await page.mouse.click(40, 450);
    check('panel: clicking outside closes it', await gone(page, '.cart-panel'));
    await page.click('.cart-button');
    await waitSel(page, '.cart-panel');
    await sleep(300);
    await page.$$eval('.cart-panel .btn-link', (bs) => bs.find((b) => b.textContent.trim() === 'Remove')?.click());
    check('panel: removing the last book shows the empty state', await waitSel(page, '.cart-panel-empty', 3000));
    check('panel: the cart count goes back to 0', await waitCart(page, 0));
    await page.click('.cart-panel-empty a');
    check('panel: a link inside the panel closes it and navigates', (await gone(page, '.cart-panel')) && new URL(page.url()).pathname === '/books');
    check('visitor flow: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- Floating cart: wide screens, once the header has scrolled away ----------
  {
    const { page, ctx, errors } = await newPage();
    await goto(page, '/books?stock=1');
    await waitSel(page, '.book-grid .book-card');
    check('floating cart: hidden while the header is on screen', (await page.$('.floating-cart')) === null);
    await page.evaluate(() => window.scrollTo(0, 1400));
    check('floating cart: appears once the header has scrolled away', await waitSel(page, '.floating-cart', 3000));
    const card = await page.evaluateHandle(() => [...document.querySelectorAll('.book-grid .book-card')].find((c) => { const t = c.getBoundingClientRect().top; return t > 120 && t < 520 && c.querySelector('.btn-card:not([aria-disabled])'); }));
    await card.$eval('.btn-card', (b) => b.click());
    check('floating cart: the cover flies to it', await waitSel(page, '.cart-flight img', 300));
    check('floating cart: its count waits for the cover, then shows 1', (await page.$eval('.floating-cart', (b) => b.getAttribute('aria-label'))) === 'Cart, 0 items' && (await page.waitForFunction(() => document.querySelector('.floating-cart')?.getAttribute('aria-label') === 'Cart, 1 item', { timeout: 3000 }).then(() => true).catch(() => false)));
    await sleep(400);
    await page.screenshot({ path: path.join(SHOTS, 'floating-cart-1280.png') });
    await page.click('.floating-cart');
    check('floating cart: opens the cart panel and steps aside', (await waitSel(page, '.cart-panel', 3000)) && (await gone(page, '.floating-cart')));
    await page.keyboard.press('Escape');
    await gone(page, '.cart-panel');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    check('floating cart: goes away when the header is back', await gone(page, '.floating-cart'));
    check('floating cart: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
    const phone = await newPage({ width: 390, height: 844, touch: true });
    await goto(phone.page, '/books');
    await waitSel(phone.page, '.book-grid .book-card');
    await phone.page.evaluate(() => window.scrollTo(0, 1600));
    await sleep(600);
    check('phone: the header stays on screen, so no floating cart', (await phone.page.$eval('.site-header', (h) => Math.round(h.getBoundingClientRect().top))) === 0 && (await phone.page.$('.floating-cart')) === null);
    await phone.ctx.close();
  }

  // ---------- Search hint: changes every 30 seconds (sped up here) ----------
  {
    const { page, ctx, errors } = await newPage();
    await page.evaluateOnNewDocument(() => {
      const every = window.setInterval;
      window.setInterval = (fn, ms, ...rest) => every(fn, ms === 30000 ? 400 : ms, ...rest);
    });
    await goto(page, '/');
    await waitSel(page, '#header-search');
    const first = await page.$eval('#header-search', (i) => i.placeholder);
    const changed = await page.waitForFunction((was) => document.querySelector('#header-search').placeholder !== was, { timeout: 3000 }, first).then(() => true).catch(() => false);
    const second = await page.$eval('#header-search', (i) => i.placeholder);
    check('search hint: moves on to the next suggestion by itself', changed && SEARCH_HINTS.includes(second) && second !== first, `${first} -> ${second}`);
    await page.type('#header-search', 'atomic');
    check('search hint: typing replaces it', (await page.$eval('#header-search', (i) => i.value)) === 'atomic');
    check('header search: suggestions list matching books while typing', await page.waitForFunction(() => document.querySelectorAll('.search-suggestions li a[href^="/books/"]').length > 0, { timeout: 6000 }).then(() => true).catch(() => false));
    await page.keyboard.press('Escape');
    check('header search: Escape closes the suggestions', await gone(page, '.search-suggestions'));
    check('search hint: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- Flow: back lands on the same spot, screens do not reload ----------
  {
    const { page, ctx, errors } = await newPage();
    let catalogue = 0;
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.hostname.endsWith('.supabase.co') && u.pathname.startsWith('/rest/v1/') && r.method() !== 'OPTIONS') catalogue += 1;
    });
    const settle = () => page.waitForNetworkIdle({ idleTime: 400, timeout: 8000 }).catch(() => {});
    await goto(page, '/');
    await waitSel(page, '.affordable-section .book-card');
    await settle();
    const target = await page.$eval('.affordable-section', (s) => Math.round(s.getBoundingClientRect().top + window.scrollY - 200));
    await page.evaluate((y) => window.scrollTo(0, y), target);
    await sleep(300);
    const homeY = await page.evaluate(() => window.scrollY);
    await page.$eval('.affordable-section .book-card-link', (a) => a.click());
    await page.waitForFunction(() => location.pathname.startsWith('/books/'), { timeout: 5000 }).catch(() => {});
    await waitSel(page, '.detail-title');
    check('flow: a new page opens at the top', (await page.evaluate(() => window.scrollY)) === 0);
    await settle();
    const requestsBefore = catalogue;
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => location.pathname === '/', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction((y) => Math.abs(window.scrollY - y) <= 2, { timeout: 3000 }, homeY).catch(() => {});
    check('flow: Back returns to the exact spot on the home page', Math.abs((await page.evaluate(() => window.scrollY)) - homeY) <= 2, `${await page.evaluate(() => window.scrollY)} vs ${homeY}`);
    await settle();
    check('flow: going back reloads nothing (home rows come from memory)', catalogue === requestsBefore, `${catalogue - requestsBefore} requests`);
    check('flow: no skeletons after going back', (await page.$('.skeleton')) === null);

    // Header cart -> View cart -> Continue shopping returns to the same spot.
    await page.$eval('.affordable-section .book-card .btn-card:not([aria-disabled])', (b) => b.click());
    await waitCart(page, 1, 4000);
    const beforeCart = await page.evaluate(() => window.scrollY);
    await page.$eval('.cart-button, .floating-cart', (b) => b.click());
    await waitSel(page, '.cart-panel');
    await sleep(400);
    await page.$$eval('.cart-panel-links button', (bs) => bs.find((b) => /continue shopping/i.test(b.textContent))?.click());
    const panelGone = await gone(page, '.cart-panel');
    const afterPanel = await page.evaluate(() => window.scrollY);
    check('panel: Continue shopping closes it and keeps the place', panelGone && new URL(page.url()).pathname === '/' && Math.abs(afterPanel - beforeCart) <= 2, `gone=${panelGone} ${new URL(page.url()).pathname} ${afterPanel} vs ${beforeCart}`);
    await page.waitForSelector('.cart-button, .floating-cart', { timeout: 3000 }).catch(() => {});
    await page.$eval('.floating-cart', (b) => b.click()).catch(() => page.$eval('.cart-button', (b) => b.click()));
    await waitSel(page, '.cart-panel');
    await sleep(400);
    await page.$$eval('.cart-panel-links a', (as) => as.find((a) => a.getAttribute('href') === '/cart')?.click());
    await page.waitForFunction(() => location.pathname === '/cart', { timeout: 5000 }).catch(() => {});
    await waitSel(page, 'main .line .line-inner');
    await page.$$eval('main .btn-outline', (bs) => bs.find((b) => /continue shopping/i.test(b.textContent))?.click());
    await page.waitForFunction(() => location.pathname === '/', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction((y) => Math.abs(window.scrollY - y) <= 2, { timeout: 3000 }, beforeCart).catch(() => {});
    check('cart page: Continue shopping goes back to the same spot', new URL(page.url()).pathname === '/' && Math.abs((await page.evaluate(() => window.scrollY)) - beforeCart) <= 2, `${await page.evaluate(() => window.scrollY)} vs ${beforeCart}`);
    check('flow: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- Search: any spelling, any script, never an empty page ----------
  {
    const { page, ctx, errors } = await newPage();
    let catalogue = 0;
    const seen = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.hostname.endsWith('.supabase.co') && u.pathname.startsWith('/rest/v1/books') && r.method() !== 'OPTIONS') {
        catalogue += 1;
        seen.push(decodeURIComponent(u.search).slice(0, 140));
      }
    });
    const settle = () => page.waitForNetworkIdle({ idleTime: 300, timeout: 8000 }).catch(() => {});
    // A card shows the title and, on its own line, the author: match on both.
    const titles = () => page.$$eval('.book-grid .book-card', (cs) => cs.map((c) => `${c.querySelector('.book-card-title')?.textContent.trim() ?? ''} ${c.querySelector('.book-author')?.textContent.trim() ?? ''}`.trim()));
    const search = async (q) => {
      await goto(page, `/books?q=${encodeURIComponent(q)}`);
      await waitSel(page, '.book-grid .book-card');
      return titles();
    };
    const cases = [
      ['atomik habbits', /^Atomic Habits/],
      ['एटॉमिक हैबिट्स', /Atomic Habits/],
      ['अमीर पिता गरीब पिता', /Rich Dad Poor Dad/],
      ['रॉबिन शर्मा', /Robin Sharma/],
      ['ایٹامک ہیبٹس', /Atomic Habits/],
      ['psycology of mony', /Psychology of Money/i],
      ['harrypotter', /Harry Potter/],
      ['hector garcia', /Héctor García/],
    ];
    for (const [q, want] of cases) {
      const found = await search(q);
      check(`search: "${q}" puts the right book first`, found.length > 0 && want.test(found[0]), found.slice(0, 2).join(' / '));
    }
    const tamil = await search('தமிழ்');
    check('search: Tamil in its own script finds only Tamil editions', tamil.length > 0 && tamil.every((t) => /tamil/i.test(t)), tamil.join(' / '));
    check('search: results are ordered by Best match', (await page.$eval('#books-sort', (s) => s.value)) === 'relevance');
    check('search: no empty-state block for a search', (await page.$('.state')) === null);

    const nothing = await search('qwertyzxcv');
    const nothingNote = await text(page, '.search-note');
    check('search: gibberish still shows books, with an honest note', nothing.length > 0 && /Nothing in the store matches/.test(nothingNote ?? ''), nothingNote);
    check('search: the suggestions are in stock', (await page.$$eval('.book-grid .book-card .btn-card', (bs) => bs.every((b) => !b.hasAttribute('aria-disabled')))) === true);
    const hindi = await search('hindi books');
    const hindiNote = await text(page, '.search-note');
    check('search: a language the store lacks is said plainly', hindi.length > 0 && /don't have Hindi editions yet/.test(hindiNote ?? ''), hindiNote);

    await goto(page, `/books?q=${encodeURIComponent('harry potter')}&category=Romance`);
    await waitSel(page, '.book-grid .book-card');
    const relaxed = await titles();
    check('search: filters that leave nothing fall back to all matches', relaxed.length > 0 && relaxed.every((t) => /Harry Potter/.test(t)) && /None of the matches/.test((await text(page, '.search-note')) ?? ''), relaxed.slice(0, 2).join(' / '));
    await page.$eval('.search-note .btn-link', (b) => b.click());
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('category'), { timeout: 4000 }).catch(() => {});
    check('search: Clear filters keeps the search', new URL(page.url()).searchParams.get('q') === 'harry potter' && !new URL(page.url()).searchParams.has('category'));

    // Typing in the box searches as you go, from the catalogue already in memory.
    await settle();
    const before = catalogue;
    await page.focus('#books-search');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type('#books-search', 'murakmi');
    await page.waitForFunction(() => [...document.querySelectorAll('.book-grid .book-author')].some((e) => /Murakami/.test(e.textContent)), { timeout: 5000 }).catch(() => {});
    const typed = await titles();
    check('search: typing "murakmi" finds Murakami', typed.length > 0 && typed.every((t) => /Murakami/.test(t)), typed.slice(0, 2).join(' / '));
    await settle();
    const typedReads = seen.slice(before);
    check('search: a new query reads only pages of books, never the whole catalogue again', typedReads.length >= 1 && typedReads.every((q) => /id=in./.test(q)), typedReads.join(' | '));
    await page.select('#books-sort', 'price_asc');
    await page.waitForFunction(() => new URL(location.href).searchParams.get('sort') === 'price_asc', { timeout: 4000 }).catch(() => {});
    await settle();
    const prices = await page.$$eval('.book-grid .book-card .price-block .price', (es) => es.map((e) => Number(e.textContent.replace(/[^\d.]/g, ''))).filter(Boolean));
    check('search: sorting the matches by price works', prices.length > 1 && prices.every((p, i) => i === 0 || p >= prices[i - 1]), prices.join(','));
    check('search: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- Motion and menus: card lift, genre row, page fade; nav menu, filters, policy pages ----------
  {
    const { page, ctx, errors } = await newPage();
    await goto(page, '/');
    await waitSel(page, '.reading-shelf .book-card');
    const card = await page.$('.reading-shelf .book-card');
    await card.evaluate((c) => c.scrollIntoView({ block: 'center' }));
    await sleep(300);
    await card.hover();
    await sleep(400);
    check('cards: a card lifts when hovered', /matrix\(1, 0, 0, 1, 0, -[1-9]/.test(await card.evaluate((c) => getComputedStyle(c).transform)), await card.evaluate((c) => getComputedStyle(c).transform));
    check('home: sections reveal as they scroll in', await page.$eval('.mood-section', (s) => s.hasAttribute('data-reveal')));

    // Genre row: drifts one way in a seamless loop, holds while pointed at, opens a genre.
    const genrePos = () => page.evaluate(() => Math.round(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.genre-track')).transform).m41));
    await page.$eval('.mood-section', (sec) => sec.scrollIntoView({ block: 'center' }));
    await page.mouse.move(5, 5);
    await sleep(600);
    const g1 = await genrePos();
    await sleep(800);
    const g2 = await genrePos();
    await sleep(800);
    const g3 = await genrePos();
    check('genre row: drifts steadily in one direction', g2 < g1 && g3 < g2, `${g1} ${g2} ${g3}`);
    check('genre row: copies follow the tiles, hidden from the keyboard and screen readers', (await page.$$('#genre-rail .genre-set[inert][aria-hidden="true"]')).length >= 1 && (await page.$$eval('#genre-rail .genre-set[inert] a', (as) => as.every((a) => !a.checkVisibility?.() || a.closest('[inert]')))) && (await page.$$eval('#genre-rail a', (as) => as.filter((a) => a.tabIndex >= 0 && !a.closest('[inert]')).length)) === 5);
    check('genre row: the edges fade instead of cutting tiles', /gradient/.test(await page.$eval('.genre-slider', (e) => getComputedStyle(e).maskImage || getComputedStyle(e).webkitMaskImage)));
    await page.hover('#genre-rail');
    await sleep(300);
    const h1 = await genrePos();
    await sleep(800);
    check('genre row: holds still while pointed at', (await genrePos()) === h1);
    await page.click('#genre-rail .genre-set:not([inert]) .mood-tile');
    await page.waitForFunction(() => location.pathname === '/books', { timeout: 4000 }).catch(() => {});
    check('genre row: clicking a tile opens its genre', new URL(page.url()).searchParams.has('category'));
    await goto(page, '/');
    await waitSel(page, '.reading-shelf .book-card');
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);
    await page.hover('.hero-book');
    await sleep(400);
    check('home: a hero cover lifts when pointed at', (await page.$eval('.hero-book img', (i) => getComputedStyle(i).transform)) !== 'none', await page.$eval('.hero-book img', (i) => getComputedStyle(i).transform));
    await page.mouse.move(5, 5);

    // A short fade as each page comes in.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.$eval('.hero-cta', (a) => a.click());
    await page.waitForFunction(() => location.pathname === '/books', { timeout: 4000 }).catch(() => {});
    const fadeStart = await page.$eval('#main > div', (d) => Number(getComputedStyle(d).opacity)).catch(() => 1);
    await sleep(400);
    const fadeEnd = await page.$eval('#main > div', (d) => Number(getComputedStyle(d).opacity));
    check('pages: each page fades in', fadeStart < 1 && fadeEnd === 1, `${fadeStart} -> ${fadeEnd}`);

    // Nav menu (a reload keeps the place on the page, so go back to the top first)
    await goto(page, '/');
    await waitSel(page, '.nav-menu-button');
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(700);
    await page.hover('.nav-menu-button');
    check('nav menu: Categories opens on hover', await waitSel(page, '.nav-menu-panel', 2000));
    const menuCategories = await page.$$eval('.nav-menu-panel a[href*="category="]', (as) => as.map((a) => new URL(a.href).searchParams.get('category')));
    const known = (await db.query(`select distinct category from public.books where is_visible and category is not null`)).rows.map((r) => r.category);
    check('nav menu: lists categories that have books', menuCategories.length >= 5 && menuCategories.every((c) => known.includes(c)), JSON.stringify(menuCategories));
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, 'nav-menu-light-1280.png'), clip: { x: 0, y: 0, width: 1280, height: 560 } });
    await page.keyboard.press('Escape');
    const menuClosed = await gone(page, '.nav-menu-panel');
    const focusBack = await page.waitForFunction(() => document.activeElement?.classList.contains('nav-menu-button'), { timeout: 1500 }).then(() => true).catch(() => false);
    check('nav menu: Escape closes it and focus returns to the button', menuClosed && focusBack);
    await page.keyboard.press('ArrowDown');
    await waitSel(page, '.nav-menu-panel', 2000);
    await sleep(100);
    check('nav menu: Arrow down opens it and focuses the first link', await page.evaluate(() => document.activeElement?.closest('.nav-menu-panel') !== null));
    const firstCategory = await page.$eval('.nav-menu-panel a[href*="category="]', (a) => new URL(a.href).searchParams.get('category'));
    await page.$eval('.nav-menu-panel a[href*="category="]', (a) => a.click());
    await page.waitForFunction(() => location.pathname === '/books', { timeout: 4000 }).catch(() => {});
    check('nav menu: a category opens the filtered Books page and closes the menu', (await gone(page, '.nav-menu-panel')) && new URL(page.url()).searchParams.get('category') === firstCategory);
    const dbCounts = Object.fromEntries((await db.query(`select category, count(*)::int as n from public.books where is_visible group by category`)).rows.map((r) => [r.category, r.n]));
    await waitSel(page, '.book-grid .book-card');
    check('books page: category filter count matches the database', new RegExp(`^${dbCounts[firstCategory]} books?`).test(await text(page, '.page-meta')), await text(page, '.page-meta'));

    // Filters reached from URLs
    const under = (await one(`select count(*)::int as n from public.books where is_visible and stock_quantity > 0 and price <= 299`)).n;
    const regional = (await one(`select count(*)::int as n from public.books where is_visible and (title ilike '%tamil%' or title ilike '%bengali%' or title ilike '%malayalam%')`)).n;
    await goto(page, '/books?max=299&stock=1');
    await waitSel(page, '.book-grid .book-card');
    check('books page: "Up to ₹299" filter count matches the database', new RegExp(`^${under} books`).test(await text(page, '.page-meta')), await text(page, '.page-meta'));
    check('books page: every listed price is ₹299 or less', (await page.$$eval('.book-grid .price-block .price', (ps) => ps.map((p) => Number(p.textContent.replace(/[^\d.]/g, ''))))).every((n) => n <= 299));
    await goto(page, '/books?collection=regional');
    await waitSel(page, '.book-grid .book-card');
    check('books page: regional filter count matches the database', new RegExp(`^${regional} books?`).test(await text(page, '.page-meta')), await text(page, '.page-meta'));
    await goto(page, '/books?max=99999&collection=evil');
    await waitSel(page, '.book-grid .book-card');
    const all = (await one(`select count(*)::int as n from public.books where is_visible`)).n;
    check('books page: unknown filter values are ignored', new RegExp(`^${all} books`).test(await text(page, '.page-meta')), await text(page, '.page-meta'));

    // Header search
    await page.type('#header-search', 'Tintin');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.search.includes('q=Tintin'), { timeout: 4000 }).catch(() => {});
    check('header search: Enter opens Books with the search', new URL(page.url()).searchParams.get('q') === 'Tintin');

    // Policy pages from the footer
    await page.$eval('.site-footer a[href="/returns"]', (a) => a.click());
    await page.waitForFunction(() => location.pathname === '/returns', { timeout: 4000 }).catch(() => {});
    check('returns page: the old store text, word for word', await page.waitForFunction(() => /the standard return window is 3 days/.test(document.body.innerText), { timeout: 5000 }).then(() => true).catch(() => false));
    for (const [route, phrase] of [['/about', 'Where Every Page Turns Into Possibility'], ['/shipping', 'We ship all over India'], ['/privacy', 'Personal Information That We collect']]) {
      await goto(page, route);
      check(`policy page ${route} renders`, await page.waitForFunction((p) => document.body.innerText.includes(p), { timeout: 5000 }, phrase).then(() => true).catch(() => false));
    }
    await goto(page, '/terms');
    await waitSel(page, '.prose h2');
    const terms = await page.$eval('.prose', (p) => p.innerText);
    check('terms: contact details filled in, other unknowns still marked', terms.includes('Kitaabaurkona@gmail.com') && terms.includes('59 Nakoda Nagar') && (await page.$$('.prose .placeholder')).length > 0);
    check('motion/menus/filters/pages: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- Books filters in one dropdown ----------
  {
    const { page, ctx, errors } = await newPage();
    await goto(page, '/books');
    await waitSel(page, '.book-grid .book-card');
    check('books toolbar: only search, sort and one Filters button (no filter chips)', (await page.$$('.toolbar .chip')).length === 0 && (await page.$('.toolbar .filter-toggle')) !== null);
    check('books toolbar: the category chips are still there', (await page.$$('.chip-scroll .chip')).length > 5);
    await page.click('.filter-toggle');
    check('filters: the dropdown opens with three options', (await page.$$('.filter-panel .filter-option')).length === 3);
    await page.screenshot({ path: path.join(SHOTS, 'books-filters-open-1280.png') });
    await page.$$eval('.filter-option', (ls) => ls.find((l) => /In stock only/.test(l.textContent)).querySelector('input').click());
    await page.waitForFunction(() => new URL(location.href).searchParams.get('stock') === '1', { timeout: 4000 }).catch(() => {});
    check('filters: In stock only filters the list', new URL(page.url()).searchParams.get('stock') === '1');
    check('filters: the button counts active filters', await page.waitForFunction(() => document.querySelector('.filter-toggle')?.textContent === 'Filters (1)', { timeout: 3000 }).then(() => true).catch(() => false), await text(page, '.filter-toggle'));
    check('filters: the dropdown stays open to pick more', (await page.$('.filter-panel')) !== null);
    await page.keyboard.press('Escape');
    check('filters: Escape closes it', (await gone(page, '.filter-panel')) && (await page.evaluate(() => document.activeElement?.classList.contains('filter-toggle'))));
    await page.click('.filter-toggle');
    await page.click('.filter-clear');
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('stock'), { timeout: 4000 }).catch(() => {});
    check('filters: Clear filters removes them', !new URL(page.url()).searchParams.has('stock'));
    await page.mouse.click(10, 10);
    check('filters: a click outside closes it', await gone(page, '.filter-panel'));
    check('filters: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();

    // Phones: one "Filters & sort" button opens sort, filters and categories together.
    const phone = await newPage({ width: 375, height: 812, touch: true });
    await goto(phone.page, '/books');
    await waitSel(phone.page, '.book-grid .book-card');
    const toggle = await phone.page.evaluateHandle(() => [...document.querySelectorAll('main button')].find((b) => /Filters & sort/i.test(b.textContent)) ?? null);
    const hasToggle = await toggle.evaluate((b) => b !== null);
    check('phone books: one "Filters & sort" button', hasToggle);
    if (hasToggle) {
      await toggle.tap();
      const opened = await phone.page.waitForSelector('.catalogue-page[data-filters-open]', { timeout: 3000 }).then(() => true).catch(() => false);
      const shown = await phone.page.evaluate(() => {
        const visible = (el) => Boolean(el) && el.getBoundingClientRect().width > 0;
        return { sort: visible(document.querySelector('#books-sort')), options: [...document.querySelectorAll('.filter-option')].filter(visible).length, chips: [...document.querySelectorAll('.chip-scroll .chip')].filter(visible).length };
      });
      check('phone filters: the panel shows sort, the filters and the categories', opened && shown.sort && shown.options >= 3 && shown.chips >= 5, JSON.stringify(shown));
      await phone.page.$$eval('.filter-option', (ls) => ls.find((l) => /In stock only/.test(l.textContent))?.querySelector('input')?.click());
      await phone.page.waitForFunction(() => new URL(location.href).searchParams.get('stock') === '1', { timeout: 4000 }).catch(() => {});
      check('phone filters: In stock only filters the list', new URL(phone.page.url()).searchParams.get('stock') === '1');
      check('phone filters: nothing scrolls sideways', (await overflow(phone.page)) <= 0);
      await phone.page.screenshot({ path: path.join(SHOTS, 'books-filters-phone-375.png') });
    }
    await phone.ctx.close();
  }

  // ---------- Phone: header, side menu ----------
  {
    const { page, ctx, errors } = await newPage({ width: 375, height: 812, touch: true });
    await goto(page, '/');
    await waitSel(page, '.hero-book');
    check('phone: header shows menu, logo, search and cart', Boolean((await page.$('.menu-button')) && (await page.$('.brand-logo')) && (await page.$('#header-search')) && (await page.$('.cart-button'))));
    check('phone: the search box shows a hint', SEARCH_HINTS.includes(await page.$eval('#header-search', (i) => i.placeholder)));
    check('phone: hero covers float gently', (await page.$eval('.hero-book img', (i) => getComputedStyle(i).animationName)) === 'hero-cover-float');
    await page.$eval('.mood-section', (sec) => sec.scrollIntoView({ block: 'center' }));
    await sleep(500);
    const railBox = await page.$eval('#genre-rail', (r) => { const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    const phonePos = () => page.evaluate(() => Math.round(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.genre-track')).transform).m41));
    const beforeSwipe = await phonePos();
    await page.touchscreen.touchStart(railBox.x + 100, railBox.y);
    for (let i = 1; i <= 8; i++) await page.touchscreen.touchMove(railBox.x + 100 - i * 20, railBox.y + 1);
    await page.touchscreen.touchEnd();
    const afterSwipe = await phonePos();
    await sleep(800);
    check('phone: swiping the genre row moves it, and it waits a moment', afterSwipe < beforeSwipe - 100 && (await phonePos()) === afterSwipe, `${beforeSwipe} -> ${afterSwipe}`);
    check('phone: a swipe does not open a genre', new URL(page.url()).pathname === '/');
    await page.click('.menu-button');
    await waitSel(page, '.drawer');
    await waitSel(page, '.drawer nav[aria-label="Help"] a', 4000);
    check('phone menu: no Categories section in the side panel', (await page.$('.drawer nav[aria-label="Categories"], .drawer .drawer-categories')) === null && !(await page.$('.drawer a[href*="category="]')));
    check('phone menu: Help section links the policy pages', (await page.$$('.drawer nav[aria-label="Help"] a')).length >= 4);
    await sleep(400);
    await page.screenshot({ path: path.join(SHOTS, 'drawer-light-375.png') });
    await page.keyboard.press('Escape');
    await gone(page, '.drawer');
    await goto(page, '/books?stock=1');
    await waitSel(page, '.book-grid .book-card');
    const card = await page.$('.book-grid .book-card');
    const h = await card.$eval('.btn-card', (b) => Math.round(b.getBoundingClientRect().height));
    await card.$eval('.btn-card', (b) => b.click());
    check('phone: the cover flies to the header cart', await waitSel(page, '.cart-flight img', 300));
    check('phone: the cart count shows 1 once it lands', await waitCart(page, 1));
    check('phone: the stepper keeps the button height', (await card.$eval('.cart-stepper', (e) => Math.round(e.getBoundingClientRect().height))) === h);
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, 'stepper-phone-375.png') });
    const phoneBook = await one(`select id from public.books where is_visible and stock_quantity > 1 and coalesce(array_length(image_urls, 1), 0) > 1 order by discount_percent desc, id limit 1`);
    await goto(page, `/books/${phoneBook.id}`);
    await waitSel(page, '.mobile-purchase-bar .order-now');
    const bar = await page.$$eval('.mobile-purchase-bar > *', (es) => es.map((e) => ({ text: e.textContent.trim(), w: Math.round(e.getBoundingClientRect().width) })));
    check('phone book: the bar has Add to cart and Order now, side by side', bar.length === 2 && /Add to cart/.test(bar[0].text) && /Order now/.test(bar[1].text) && Math.abs(bar[0].w - bar[1].w) <= 2, JSON.stringify(bar));
    check('phone book: no photo arrows (swipe instead)', await page.$eval('.gallery-next', (b) => getComputedStyle(b).display === 'none'));
    const photoBox = await page.$eval('.gallery-track', (t) => { const b = t.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await page.touchscreen.touchStart(photoBox.x + 120, photoBox.y);
    for (let i = 1; i <= 10; i++) await page.touchscreen.touchMove(photoBox.x + 120 - i * 25, photoBox.y + 1);
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => document.querySelector('.gallery-thumbs li:nth-child(2) .thumb')?.getAttribute('aria-pressed') === 'true', { timeout: 3000 }).catch(() => {});
    check('phone book: swiping the photo shows the next one', (await page.$eval('.gallery-thumbs li:nth-child(2) .thumb', (b) => b.getAttribute('aria-pressed'))) === 'true' && (await page.$$eval('.gallery-dots span', (ds) => ds.findIndex((d) => d.hasAttribute('data-active')))) === 1);
    await page.screenshot({ path: path.join(SHOTS, 'book-phone-375.png') });
    check('phone: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- Book page ----------
  {
    const { page, ctx, errors } = await newPage();
    const book = await one(
      `select id, title from public.books where is_visible and stock_quantity > 1 and coalesce(array_length(image_urls, 1), 0) > 1 order by discount_percent desc, id limit 1`,
    );
    await goto(page, `/books/${book.id}`);
    check('book page: title renders', await waitSel(page, '.detail-title'));
    // The page shows the title, and the author on its own line ("Title by Author" in the database).
    const shownTitle = await text(page, '.detail-title');
    const shownAuthor = (await text(page, '.detail-author')) ?? '';
    check('book page: title (and author) match the database', Boolean(shownTitle) && book.title.startsWith(shownTitle) && (book.title === shownTitle || book.title.includes(shownAuthor)), `${shownTitle} | ${shownAuthor} | ${book.title}`);
    const body = await page.$eval('main', (m) => m.innerText);
    check('book page: no SKU, package size or shipping weight', !/\bSKU\b|Package size|Shipping weight/i.test(body));
check('book page: Order now sits above Add to cart', await page.evaluate(() => {
      const order = document.querySelector('.buy-stack .order-now');
      const add = document.querySelector('.buy-stack .btn-outline');
      return Boolean(order && add) && /Order now/.test(order.textContent) && /Add to cart/.test(add.textContent) && order.getBoundingClientRect().bottom <= add.getBoundingClientRect().top;
    }));
    check('book page: no separate quantity box, and Save stays', (await page.$('.detail-buy .stepper')) === null && (await page.$('.buy-secondary .btn-outline[aria-pressed]')) !== null);
    const photoState = () => page.evaluate(() => ({
      thumb: [...document.querySelectorAll('.gallery-thumbs .thumb')].findIndex((t) => t.getAttribute('aria-pressed') === 'true'),
      dot: [...document.querySelectorAll('.gallery-dots span')].findIndex((d) => d.hasAttribute('data-active')),
      scroll: Math.round(document.querySelector('.gallery-track').scrollLeft),
      width: document.querySelector('.gallery-track').clientWidth,
    }));
    await page.hover('.gallery-main');
    await sleep(300);
    check('photos: arrows appear when pointing at the photo', (await page.$eval('.gallery-next', (b) => getComputedStyle(b).opacity)) === '1');
    await page.click('.gallery-next');
    await sleep(700);
    const afterNext = await photoState();
    check('photos: the next arrow slides to the second photo', afterNext.thumb === 1 && afterNext.dot === 1 && Math.abs(afterNext.scroll - afterNext.width) <= 2, JSON.stringify(afterNext));
    await page.click('.gallery-thumbs li:nth-child(1) .thumb');
    await sleep(700);
    const afterThumb = await photoState();
    check('photos: a thumbnail slides back to its photo', afterThumb.thumb === 0 && afterThumb.scroll <= 2, JSON.stringify(afterThumb));
    await page.focus('.gallery-track');
    await page.keyboard.press('ArrowRight');
    await sleep(700);
    check('photos: the arrow keys move between photos', (await photoState()).thumb === 1);
    await page.screenshot({ path: path.join(SHOTS, 'book-light-1280.png'), fullPage: true });
    await page.$eval('.buy-stack .btn-outline', (b) => b.click());
    check('book page: the cover flies from the photo on screen to the cart', await waitSel(page, '.cart-flight img', 300));
    await waitCart(page, 1, 4000);
    check('book page: Add to cart turns into the stepper, panel stays shut', (await waitSel(page, '.buy-stack .cart-stepper.is-block', 3000)) && (await page.$('.cart-panel')) === null);
    check('book page: the stepper fills the buy column', (await page.$eval('.buy-stack .cart-stepper', (e) => Math.round(e.getBoundingClientRect().width))) === (await page.$eval('.buy-stack', (e) => Math.round(e.getBoundingClientRect().width))));
    await page.click('.buy-stack .order-now');
    await page.waitForFunction(() => location.pathname !== '/books/' + location.pathname.split('/').pop() || /sign-in|checkout/.test(location.pathname), { timeout: 4000 }).catch(() => {});
    await page.waitForFunction(() => /sign-in|checkout/.test(location.pathname), { timeout: 4000 }).catch(() => {});
    check('book page: Order now heads to checkout (sign in first when signed out)', new URL(page.url()).pathname === '/sign-in');
    // Back on the book: the cart still holds one copy; open it from the panel's View cart.
    await goto(page, `/books/${book.id}`);
    check('book page: Order now did not add a second copy', await waitCart(page, 1, 4000));
    await page.click('.cart-button');
    await waitSel(page, '.cart-panel');
    await sleep(400);
    await page.$$eval('.cart-panel-links a', (as) => as.find((a) => a.getAttribute('href') === '/cart')?.click());
    await page.waitForFunction(() => location.pathname === '/cart', { timeout: 4000 }).catch(() => {});
    check('cart page: one line rendered with the shared cart line', await waitSel(page, 'main .line .line-inner'));
    await page.$$eval('main .btn-outline', (bs) => bs.find((b) => /continue shopping/i.test(b.textContent))?.click());
    await page.waitForFunction(() => /^\/books\//.test(location.pathname), { timeout: 4000 }).catch(() => {});
    check('cart page: Continue shopping goes back to the book', /^\/books\//.test(new URL(page.url()).pathname));
    await page.screenshot({ path: path.join(SHOTS, 'cart-light-1280.png'), fullPage: true });
    check('book + cart pages: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- Signed in: checkout up to payment, account pages ----------
  {
    const { page, ctx, errors } = await newPage();
    await goto(page, '/sign-in');
    await waitSel(page, '#email');
    await page.type('#email', 'reader@example.com');
    await page.type('#password', 'reader-pass-1');
    await page.click('button[type=submit]');
    await page.waitForFunction(() => location.pathname === '/', { timeout: 8000 }).catch(() => {});
    check('signed in: lands on the store', new URL(page.url()).pathname === '/');
    await waitSel(page, '.reading-shelf .book-card');
    await page.$$eval('.reading-shelf .book-card .btn-card:not([aria-disabled]), .affordable-section .book-card .btn-card:not([aria-disabled])', (bs) => bs[0].click());
    await waitCart(page, 1, 4000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    await page.click('.cart-button');
    await waitSel(page, '.cart-panel');
    await sleep(400);
    await page.$$eval('.cart-panel a', (as) => as.find((a) => /^checkout/i.test(a.textContent.trim()))?.click());
    await page.waitForFunction(() => location.pathname === '/checkout', { timeout: 5000 }).catch(() => {});
    check('panel Checkout opens the checkout page', new URL(page.url()).pathname === '/checkout');
    await waitSel(page, '#ship-name');
    await page.waitForFunction(() => document.querySelector('#ship-name')?.value.length > 0, { timeout: 5000 }).catch(() => {});
    check('checkout: delivery details prefilled from the profile', (await page.$eval('#ship-name', (e) => e.value)) === 'Asha Rao');
    await page.type('#ship-city', 'Udaipur');
    await page.select('#ship-state', 'Rajasthan');
    await page.type('#ship-pincode', '799999');
    check('checkout: a PIN code the courier cannot serve is flagged', await waitSel(page, '.pin-check[data-state="no"]', 6000));
    check('checkout: Place order is blocked for that PIN', (await page.$$eval('main button[type=submit]', (bs) => bs.find((b) => /Place order/i.test(b.textContent))?.getAttribute('aria-disabled'))) === 'true');
    await page.$eval('#ship-pincode', (e) => e.select());
    await page.type('#ship-pincode', '313001');
    check('checkout: the courier confirms delivery and cash on delivery', await waitSel(page, '.pin-check[data-state="ok"]', 6000));
    check('checkout: payment is cash on delivery with free shipping', /Cash on delivery/i.test(await text(page, '.payment-option')) && /Shipping is free/i.test(await text(page, '.payment-option')));
check('checkout: one Place order button', (await page.$$eval('main .btn-primary', (bs) => bs.filter((b) => /Place order/i.test(b.textContent)).length)) === 1);
    await page.screenshot({ path: path.join(SHOTS, 'checkout-light-1280.png'), fullPage: true });
    const before = (await one('select count(*)::int as n from public.orders')).n;
    await page.$$eval('main button[type=submit]', (bs) => bs.find((b) => /Place order/.test(b.textContent))?.click());
    await page.waitForFunction(() => /^\/orders\//.test(location.pathname), { timeout: 8000 }).catch(() => {});
    check('checkout: order saved once and order page opens', /^\/orders\//.test(new URL(page.url()).pathname) && (await one('select count(*)::int as n from public.orders')).n === before + 1);
    check('order page: "pay in cash when it arrives" notice', await page.waitForFunction(() => /Pay in cash when it arrives/i.test(document.body.innerText), { timeout: 5000 }).then(() => true).catch(() => false));
    const placedId = new URL(page.url()).pathname.split('/').pop();
    check('order: saved as a confirmed cash on delivery order', (await one(`select status, payment_method from public.orders where id = $1`, [placedId]))?.status === 'confirmed');
    check('order page: shows the order as Order placed', (await text(page, '.page-head .status')) === 'Order placed');
    check('order page: delivery steps show Order placed as the current step', await page.waitForFunction(() => document.querySelector('.order-steps li[aria-current="step"] .order-step-label')?.textContent === 'Order placed' && /Tracking appears here once the courier picks up/.test(document.body.innerText), { timeout: 5000 }).then(() => true).catch(() => false));
    check('order page: the customer can still cancel before pickup', /Cancel order/i.test(await page.$eval('main', (m) => m.innerText)));
    check('order: cart emptied after ordering', await waitCart(page, 0, 4000));
    await page.screenshot({ path: path.join(SHOTS, 'order-light-1280.png'), fullPage: true });

    const saveBook = await one(`select id from public.books where is_visible order by discount_percent desc, id limit 1`);
    await goto(page, `/books/${saveBook.id}`);
    await waitSel(page, '.buy-secondary .btn-outline[aria-pressed]');
    await page.click('.buy-secondary .btn-outline[aria-pressed]');
    const savedNow = await page
      .waitForFunction(() => document.querySelector('.buy-secondary .btn-outline[aria-pressed]')?.getAttribute('aria-pressed') === 'true', { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    check('wishlist: Save fills the bookmark', savedNow);
    await sleep(400);
    check('wishlist: label changes to Saved, no pop-up message', /saved/i.test(await text(page, '.buy-secondary .btn-outline[aria-pressed]')) && (await page.$('.toast')) === null);
    check('wishlist: saved in the database', Boolean(await one(`select 1 as ok from public.wishlist_items where book_id = $1`, [saveBook.id])));

    for (const [route, sel, label] of [
      ['/orders', '.order-card', 'orders list shows the order'],
      ['/wishlist', 'main', 'wishlist renders'],
      ['/account', '.stat-row', 'account shows counts'],
      ['/settings', '#appearance', 'settings renders as one column'],
      ['/terms', '.prose h2', 'terms render'],
    ]) {
      await goto(page, route);
      check(`account area: ${label}`, await waitSel(page, sel));
      await sleep(400);
      await page.screenshot({ path: path.join(SHOTS, `${route.slice(1)}-light-1280.png`), fullPage: true });
    }
    await goto(page, '/settings');
    await waitSel(page, '#appearance');
    check('settings: sidebar removed', (await page.$('.settings-nav')) === null);
    await page.click('input[name=theme][value=dark]');
    await sleep(200);
    check('settings: Dark applies the dark theme', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
    await page.screenshot({ path: path.join(SHOTS, 'settings-dark-1280.png'), fullPage: true });
    await goto(page, '/account');
    await waitSel(page, '.stat-row');
    await sleep(400);
    await page.screenshot({ path: path.join(SHOTS, 'account-dark-1280.png'), fullPage: true });
    const orderBook = await one(`select id from public.books where is_visible and stock_quantity > 2 order by id desc limit 1`);
    await goto(page, `/books/${orderBook.id}`);
    await waitSel(page, '.buy-stack .order-now');
    await page.click('.buy-stack .order-now');
    await page.waitForFunction(() => location.pathname === '/checkout', { timeout: 5000 }).catch(() => {});
    const orderTitle = (await one(`select title from public.books where id = $1`, [orderBook.id])).title.split(' by ')[0].slice(0, 20);
    const onCheckout = await page.waitForFunction((t) => location.pathname === '/checkout' && document.querySelector('main')?.innerText.includes(t), { timeout: 6000 }, orderTitle).then(() => true).catch(() => false);
    check('Order now: a signed-in shopper lands on checkout with the book in the order', onCheckout, orderTitle);
    check('signed-in flow: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- Admin: shipping settings, booking a parcel, manifest; customer tracking ----------
  {
    const { page, ctx, errors } = await newPage();
    await goto(page, '/sign-in');
    await waitSel(page, '#email');
    await page.type('#email', 'admin@example.com');
    await page.type('#password', 'admin-pass-1');
    await page.click('button[type=submit]');
    await page.waitForFunction(() => location.pathname === '/', { timeout: 8000 }).catch(() => {});
    await goto(page, '/admin/shipping');
    check('admin shipping: settings load', await waitSel(page, '#ship-warehouse_name'));
    check('admin shipping: warns that nothing is booked without a warehouse name', /Nothing is booked until the warehouse name/i.test(await page.$eval('main', (m) => m.innerText)));
    await page.type('#ship-warehouse_name', 'Kitaabaurkona Udaipur');
    await page.$$eval('main button[type=submit]', (bs) => bs.find((b) => /Save settings/.test(b.textContent))?.click());
    const savedWarehouse = await page
      .waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Shipping settings saved'), { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    check('admin shipping: settings save', savedWarehouse && (await one(`select warehouse_name from public.shipping_settings`)).warehouse_name === 'Kitaabaurkona Udaipur');
    check('admin shipping: failed deliveries list loads from the courier', await page.waitForFunction(() => /No failed delivery attempts/i.test(document.body.innerText), { timeout: 6000 }).then(() => true).catch(() => false));
    await page.screenshot({ path: path.join(SHOTS, 'admin-shipping-light-1280.png'), fullPage: true });

    await goto(page, '/admin/orders?status=confirmed');
    check('admin orders: the COD order shows its queued parcel', await page.waitForFunction(() => /Parcel: Queued/i.test(document.body.innerText), { timeout: 6000 }).then(() => true).catch(() => false));
    await page.$$eval('.parcel-admin button', (bs) => bs.find((b) => /Change courier/.test(b.textContent))?.click());
    check('admin orders: courier prices load for the parcel', await waitSel(page, '.parcel-admin select', 6000));
    await page.$$eval('.parcel-admin button', (bs) => bs.find((b) => /Book now/.test(b.textContent))?.click());
    check('admin orders: Book now books it with an AWB', await page.waitForFunction(() => /Pickup scheduled/i.test(document.body.innerText) && /AWB \d+/.test(document.body.innerText), { timeout: 8000 }).then(() => true).catch(() => false));
    check('admin orders: the label link points to the courier file host', /^https:\/\/xb-files\.s3\.amazonaws\.com\//.test(await page.$eval('.parcel-admin a[href*="labels"]', (a) => a.href).catch(() => '')));
    check('admin orders: booked parcels can be picked for a manifest', await waitSel(page, '.pick input[type=checkbox]', 3000));
    await page.click('.pick input[type=checkbox]');
    check('admin orders: manifest button appears', /Pickup manifest for 1 order/i.test(await page.$eval('main', (m) => m.innerText)));
    await page.screenshot({ path: path.join(SHOTS, 'admin-orders-parcel-light-1280.png'), fullPage: true });
    check('admin shipping flow: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();

    const reader = await newPage();
    await goto(reader.page, '/sign-in');
    await waitSel(reader.page, '#email');
    await reader.page.type('#email', 'reader@example.com');
    await reader.page.type('#password', 'reader-pass-1');
    await reader.page.click('button[type=submit]');
    await reader.page.waitForFunction(() => location.pathname === '/', { timeout: 8000 }).catch(() => {});
    const placed = await one(`select id from public.orders where payment_method = 'cod' order by created_at desc limit 1`);
    await goto(reader.page, `/orders/${placed.id}`);
    check('customer: once picked up, Shipped is the current step with courier and AWB', await reader.page.waitForFunction(() => /Tracking number/i.test(document.body.innerText) && document.querySelector('.order-steps li[aria-current="step"] .order-step-label')?.textContent === 'Shipped', { timeout: 8000 }).then(() => true).catch(() => false));
    check('customer: picked up, so the order is Shipped', (await one(`select status from public.orders where id = $1`, [placed.id])).status === 'shipped');
    check('customer: the page updates the order to Shipped by itself', await reader.page.waitForFunction(() => document.querySelector('.page-head .status')?.textContent.trim() === 'Shipped', { timeout: 6000 }).then(() => true).catch(() => false));
    check('customer: no Cancel button once the parcel has left', !/Cancel order/i.test(await reader.page.$eval('main', (m) => m.innerText)));
    check('customer: the tracking history is listed', (await reader.page.$$('.parcel-history li')).length >= 1);
    check('customer: no label or courier cost is shown', !/label|courier cost|₹90/i.test(await reader.page.$eval('main', (m) => m.innerText)));
    await reader.page.screenshot({ path: path.join(SHOTS, 'order-tracking-light-1280.png'), fullPage: true });
    check('customer tracking: no console errors', reader.errors.length === 0, reader.errors.join(' | '));
    await reader.ctx.close();
  }

  // ---------- Reduced motion ----------
  {
    const { page, ctx, errors } = await newPage({ prefs: { theme: 'system', motion: 'reduce' } });
    await goto(page, '/');
    await waitSel(page, '.cart-button');
    await page.click('.cart-button');
    await waitSel(page, '.cart-panel');
    await sleep(30);
    const transform = await page.$eval('.cart-panel', (e) => getComputedStyle(e).transform);
    check('reduce motion: cart panel is in place immediately', transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)', transform);
    await page.keyboard.press('Escape');
    await gone(page, '.cart-panel');
    await waitSel(page, '.reading-shelf .book-card');
    check('reduce motion: sections are shown without waiting to scroll', (await page.$eval('.affordable-section', (s) => getComputedStyle(s).opacity).catch(() => null)) === '1');
    const card = await page.evaluateHandle(() => [...document.querySelectorAll('.reading-shelf .book-card, .affordable-section .book-card')].find((c) => c.querySelector('.btn-card:not([aria-disabled])')));
    await card.$eval('.btn-card', (b) => b.click());
    await sleep(60);
    check('reduce motion: no flying cover, the count updates at once', (await page.$('.cart-flight')) === null && (await cartLabel(page)) === 'Cart, 1 item');
    check('reduce motion: the stepper still appears', (await card.$('.cart-stepper')) !== null);
    check('reduce motion: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- Themes, widths, overflow ----------
  const pages = ['/', '/books', '/books?max=299&stock=1', '/books?collection=regional', '/cart', '/terms', '/about', '/returns', '/shipping', '/privacy', '/nowhere'];
  for (const scheme of ['light', 'dark']) {
    for (const [w, h] of [[320, 640], [375, 812], [768, 1024], [1280, 900]]) {
      // The store opens in light mode; the dark pass picks Dark in its settings first.
      const { page, ctx, errors } = await newPage({ width: w, height: h, scheme, touch: w < 768, prefs: scheme === 'dark' ? { theme: 'dark' } : null });
      const bad = [];
      for (const p of pages) {
        await goto(page, p);
        await sleep(900);
        const o = await overflow(page);
        if (o > 0) bad.push(`${p}:${o}px`);
      }
      check(`${scheme} ${w}px: no horizontal overflow on ${pages.length} pages`, bad.length === 0, bad.join(' '));
      if (w === 375 || w === 1280) {
        await goto(page, '/');
        await waitSel(page, '.reading-shelf .book-card');
        await scrollThrough(page);
        await page.screenshot({ path: path.join(SHOTS, `home-${scheme}-${w}.png`), fullPage: true });
        await page.$$eval('.reading-shelf .book-card .btn-card:not([aria-disabled]), .affordable-section .book-card .btn-card:not([aria-disabled])', (bs) => {
          bs[0].scrollIntoView({ block: 'center' });
          bs[0].click();
        });
        await sleep(1000);
        await page.screenshot({ path: path.join(SHOTS, `stepper-${scheme}-${w}.png`) });
        await page.evaluate(() => document.querySelector('.cart-button').click());
        await waitSel(page, '.cart-panel');
        await sleep(400);
        await page.screenshot({ path: path.join(SHOTS, `panel-${scheme}-${w}.png`) });
      }
      check(`${scheme} ${w}px: no console errors`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await db.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
