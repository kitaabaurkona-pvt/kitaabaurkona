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
  if (prefs) await page.evaluateOnNewDocument((p) => localStorage.setItem('kitaab_prefs', p), JSON.stringify(prefs));
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
const RED = 'rgb(178, 34, 34)';
const GREEN = 'rgb(0, 128, 0)';
// A spot on the page that is over no carousel (right end of the nav row), so nothing pauses.
const NEUTRAL = [1275, 140];
const ANNOUNCEMENTS = ['Free shipping on all orders', 'Cash on delivery available', 'Easy returns'];
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
// The slides a visitor can see in a carousel (copies and off-screen slides are hidden).
const visibleSlides = (page, root) =>
  page.$$eval(`${root} .carousel-slide:not([aria-hidden="true"])`, (els) => els.map((e) => e.textContent.trim()));
const activeDot = (page, root) =>
  page.$$eval(`${root} .carousel-dot`, (ds) => ds.findIndex((d) => d.getAttribute('aria-current') === 'true'));

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

  // ---------- Visitor: Home ----------
  {
    const { page, ctx, errors } = await newPage();
    await goto(page, '/');
    await page.mouse.move(...NEUTRAL);
    check('home: hero banner shows first', await waitSel(page, '.hero-carousel .carousel-slide:not([data-copy]) img[src="/banners/collect-the-adventure.webp"]'));
    await waitSel(page, '.hero-deal-title');
    const topThree = (
      await db.query(`select title from public.books where is_visible and stock_quantity > 0 order by discount_percent desc, id asc limit 3`)
    ).rows.map((r) => r.title);
    const dealTitles = await page.$$eval('.hero-carousel .carousel-slide:not([data-copy]) .hero-deal-title', (els) => els.map((e) => e.textContent.trim()));
    check('home: hero then shows the 3 biggest in-stock discounts, in order', JSON.stringify(dealTitles) === JSON.stringify(topThree), JSON.stringify(dealTitles));
    check('home: only one hero slide is exposed to assistive tech', (await page.$$('.hero-carousel .carousel-slide:not([aria-hidden="true"])')).length === 1);

    const shownOffers = await page.$$eval('.announcement-bar .carousel-slide:not([data-copy]) .announcement', (els) => els.map((e) => e.textContent.trim()));
    check('announcement bar: only the three confirmed offers', JSON.stringify(shownOffers) === JSON.stringify(ANNOUNCEMENTS), JSON.stringify(shownOffers));
    check('home: no invented promos, countdowns or reviews', !INVENTED.test(await page.$eval('body', (b) => b.innerText)));

    const dbCategories = (await db.query(`select distinct category from public.books where is_visible and category is not null`)).rows.map((r) => r.category);
    await waitSel(page, '.circle');
    const circles = await page.$$eval('.circles-section .circle', (cs) => cs.map((c) => ({ label: c.textContent.trim(), href: c.getAttribute('href'), img: Boolean(c.querySelector('img')) })));
    check('circles: one round link per category in the database', circles.length === dbCategories.length && circles.every((c) => dbCategories.includes(c.label)), JSON.stringify(circles.map((c) => c.label)));
    check('circles: each links to its category and shows a cover', circles.every((c) => c.href === `/books?category=${encodeURIComponent(c.label)}` && c.img));

    const trust = await page.$$eval('.trust-strip .trust-items:not([aria-hidden]) .trust-item', (els) => els.map((e) => e.textContent.trim()));
    check('trust strip: free shipping, cash on delivery, easy returns', JSON.stringify(trust) === JSON.stringify(['Free shipping', 'Cash on delivery', 'Easy returns']), JSON.stringify(trust));
    check('banner 2: the Must-Read Trio banner links to box sets', (await page.$eval('.banner-wrap a', (a) => a.getAttribute('href')).catch(() => null)) === '/books?category=Box%20Sets%20%26%20Combos');

    await waitSel(page, '[aria-labelledby="deals-heading"] .book-card');
    check('home: AMAZING DEALS row holds the next 10 deals', (await page.$$('[aria-labelledby="deals-heading"] .book-card')).length === 10);
    for (const [id, label] of [['under', 'Up to ₹299'], ['combos', 'Box Sets & Combos'], ['regional', 'Regional editions']]) {
      check(`home: "${label}" row has books`, (await waitSel(page, `[aria-labelledby="${id}-heading"] .book-card`)) && (await text(page, `#${id}-heading`)) === label);
    }
    await waitSel(page, '[aria-labelledby="all-heading"] .book-card');
    check('home: ALL PRODUCTS shows 8 books with VIEW ALL', (await page.$$('[aria-labelledby="all-heading"] .book-card')).length === 8 && (await page.$('[aria-labelledby="all-heading"] .view-all[href="/books"]')) !== null);
    const headTransform = await page.$eval('#all-heading', (h) => getComputedStyle(h).textTransform);
    check('home: section headings are UPPERCASE and centred', headTransform === 'uppercase' && (await page.$eval('.home-head', (h) => getComputedStyle(h).alignItems)) === 'center');

    check('cards: no Save button on cards', (await page.$('.book-card .save-button')) === null);
    check('cards: every card has a full-width button', (await page.$$('.book-card')).length === (await page.$$('.book-card .btn-card')).length);
    const cardBtn = await page.$eval('.book-card .btn-card:not([aria-disabled])', (b) => ({ bg: getComputedStyle(b).backgroundColor, tt: getComputedStyle(b).textTransform }));
    check('cards: black UPPERCASE button', cardBtn.bg === BLACK && cardBtn.tt === 'uppercase', JSON.stringify(cardBtn));
    check('cards: red discount tag', (await page.$eval('.book-card .cover-tag', (e) => getComputedStyle(e).backgroundColor).catch(() => null)) === RED);
    check('cards: green "% OFF" in the price row', (await page.$eval('.book-card .price-off', (e) => getComputedStyle(e).color).catch(() => null)) === GREEN);
    check('cards: framed with a 1px border', (await page.$eval('.book-card', (e) => getComputedStyle(e).borderTopWidth)) === '1px');
    check('header: Offers removed from navigation', (await page.$('header a[href="/offers"]')) === null);
    check(
      'header: logo and name on the left, search in the middle',
      await page.evaluate(() => {
        const logo = document.querySelector('.brand-logo').getBoundingClientRect();
        const search = document.querySelector('.header-search').getBoundingClientRect();
        return logo.left < 60 && /kitaabaurkona/i.test(document.querySelector('.brand-word').textContent) && Math.abs(search.left + search.width / 2 - window.innerWidth / 2) < 60;
      }),
    );
    check('home: rows alternate cream and white bands', (await page.$$('.band[data-tone="cream"]')).length >= 2 && (await page.$$('.band:not([data-tone])')).length >= 2);
    check('home: a category ribbon links every category', (await page.$$('.ribbon ul:not([aria-hidden]) a[href*="category="]')).length >= 5);
    check('header: no count badge while the cart is empty', (await page.$('.cart-count')) === null);
    const footer = await page.$eval('.site-footer', (f) => f.innerText);
    check('footer: contact details from the owner', footer.includes('Kitaabaurkona@gmail.com') && footer.includes('8690965448') && /udaipur/i.test(footer));
    check('footer: policy links', (await page.$$eval('.footer-links a', (as) => as.map((a) => a.getAttribute('href')))).join() === '/about,/returns,/terms,/privacy,/shipping,/settings');
    await scrollThrough(page);
    await page.screenshot({ path: path.join(SHOTS, 'home-light-1280.png'), fullPage: true });

    // ---------- Add to cart: + count − stepper, cover flies to the cart ----------
    // The first card a visitor sees (the row's off-screen copies are inert); hovering it pauses the row.
    const firstCard = await page.$('[aria-labelledby="deals-heading"] .carousel-slide:not([data-copy]):not([aria-hidden="true"]) .book-card');
    const price = await firstCard.$eval('.price', (e) => e.textContent.trim());
    await firstCard.evaluate((c) => c.scrollIntoView({ block: 'center' }));
    await sleep(300);
    await firstCard.hover();
    await sleep(200);
    const before = await firstCard.$eval('.btn-card', (b) => Math.round(b.getBoundingClientRect().height));
    const yBefore = await page.evaluate(() => window.scrollY);
    await firstCard.$eval('.btn-card', (b) => b.click());
    check('add: a copy of the cover flies towards the cart', await waitSel(page, '.cart-flight img', 300));
    check('add: the header count waits for the cover to land', (await page.$('.cart-count')) === null);
    await sleep(180);
    await page.screenshot({ path: path.join(SHOTS, 'flight-light-1280.png') });
    const landed = await page
      .waitForFunction(() => !document.querySelector('.cart-flight') && document.querySelector('.cart-count')?.textContent.trim() === '1', { timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    check('add: it lands, disappears and the header count becomes 1', landed);
    await sleep(300);
    check('add: the cart panel does not open', (await page.$('.cart-panel')) === null);
    check('add: no pop-up message', (await page.$('.toast')) === null);
    check('add: the page stays where it was', Math.abs((await page.evaluate(() => window.scrollY)) - yBefore) <= 1);
    check('add: header cart button names the count', /Cart, 1 item/.test(await page.$eval('.cart-button', (b) => b.getAttribute('aria-label'))));
    check('add: the button becomes a − 1 + stepper', (await firstCard.$eval('.cart-stepper-number', (e) => e.textContent.trim()).catch(() => null)) === '1');
    check('add: the stepper is the same height as the button (nothing moves)', (await firstCard.$eval('.cart-stepper', (e) => Math.round(e.getBoundingClientRect().height))) === before);
    check('add: the stepper is black like the button', (await firstCard.$eval('.cart-stepper', (e) => getComputedStyle(e).backgroundColor)) === BLACK);
    check('add: focus moves to the stepper', await firstCard.evaluate((c) => c.querySelector('.cart-stepper').contains(document.activeElement)));
    await firstCard.$eval('[data-step="up"]', (b) => b.click());
    const twoLanded = await page
      .waitForFunction(() => document.querySelector('.cart-count')?.textContent.trim() === '2', { timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    check('stepper: + adds one more (card and header show 2)', twoLanded && (await firstCard.$$eval('.cart-stepper-number', (es) => es.at(-1).textContent.trim())) === '2');
    await sleep(300);
    await firstCard.$eval('[data-step="down"]', (b) => b.click());
    await page.waitForFunction(() => document.querySelector('.cart-count')?.textContent.trim() === '1', { timeout: 3000 }).catch(() => {});
    check('stepper: − takes one away at once', (await text(page, '.cart-count')) === '1');
    await sleep(300);
    await firstCard.$eval('[data-step="down"]', (b) => b.click());
    await sleep(300);
    check('stepper: − on the last copy brings back Add to cart', (await firstCard.$('.btn-card')) !== null && (await gone(page, '.cart-count')));
    await firstCard.$eval('.btn-card', (b) => b.click());
    await page.waitForFunction(() => document.querySelector('.cart-count')?.textContent.trim() === '1', { timeout: 3000 }).catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0));

    // ---------- Cart panel ----------
    await page.click('.cart-button');
    check('panel: opens from the header cart button', await waitSel(page, '.cart-panel[role="dialog"]', 3000));
    await sleep(300);
    check('panel: focus moves inside', await page.evaluate(() => document.querySelector('.cart-panel').contains(document.activeElement)));
    check('panel: lists the book with its total', (await page.$$('.cart-panel .line')).length === 1 && (await text(page, '.cart-panel .line-total')) === price);
    check('panel: subtotal matches', (await text(page, '.cart-panel-sum dd')) === price);
    check('panel: Checkout is a black primary button', (await page.$eval('.cart-panel .btn-primary', (b) => getComputedStyle(b).backgroundColor)) === BLACK);
    check('panel: Checkout button shows the total', /^Checkout\s*•\s*₹/i.test(await page.$eval('.cart-panel .btn-primary', (b) => b.textContent.trim())));
    const inc = await page.$('.cart-panel .stepper button:last-child');
    if (inc) {
      await inc.click();
      const two = await page
        .waitForFunction(() => document.querySelector('.cart-count')?.textContent.trim() === '2', { timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      check('panel: + raises the quantity and the header count', two, await text(page, '.cart-count'));
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
    check('panel: header badge goes away', await gone(page, '.cart-count'));
    await page.click('.cart-panel-empty a');
    check('panel: a link inside the panel closes it and navigates', (await gone(page, '.cart-panel')) && new URL(page.url()).pathname === '/books');
    check('visitor flow: no console errors', errors.length === 0, errors.join(' | '));
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
    await waitSel(page, '[aria-labelledby="all-heading"] .book-card');
    await settle();
    const target = await page.$eval('[aria-labelledby="all-heading"]', (s) => Math.round(s.getBoundingClientRect().top + window.scrollY - 200));
    await page.evaluate((y) => window.scrollTo(0, y), target);
    await sleep(300);
    const homeY = await page.evaluate(() => window.scrollY);
    await page.$eval('[aria-labelledby="all-heading"] .book-card-link', (a) => a.click());
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
    await page.$eval('[aria-labelledby="all-heading"] .book-card .btn-card:not([aria-disabled])', (b) => b.click());
    await page.waitForFunction(() => document.querySelector('.cart-count')?.textContent.trim() === '1', { timeout: 4000 }).catch(() => {});
    const beforeCart = await page.evaluate(() => window.scrollY);
    await page.click('.cart-button');
    await waitSel(page, '.cart-panel');
    await sleep(400);
    await page.$$eval('.cart-panel-links button', (bs) => bs.find((b) => /continue shopping/i.test(b.textContent))?.click());
    const panelGone = await gone(page, '.cart-panel');
    const afterPanel = await page.evaluate(() => window.scrollY);
    check('panel: Continue shopping closes it and keeps the place', panelGone && new URL(page.url()).pathname === '/' && Math.abs(afterPanel - beforeCart) <= 2, `gone=${panelGone} ${new URL(page.url()).pathname} ${afterPanel} vs ${beforeCart}`);
    await page.click('.cart-button');
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

  // ---------- Motion: hero, announcement, rows, circles, card photos; menus, search, filters ----------
  {
    const { page, ctx, errors } = await newPage();
    await goto(page, '/');
    await waitSel(page, '.hero-deal-title');
    await page.mouse.move(...NEUTRAL);
    const hero = '.hero-carousel';
    check('hero: starts on the banner', (await activeDot(page, hero)) === 0);
    const offer0 = (await visibleSlides(page, '.announcement-bar'))[0];
    await sleep(4600);
    const offer1 = (await visibleSlides(page, '.announcement-bar'))[0];
    check('announcement bar: slides to the next offer by itself', offer0 && offer1 && offer0 !== offer1, `${offer0} -> ${offer1}`);
    await sleep(1200);
    check('hero: slides on by itself after 5 seconds', (await activeDot(page, hero)) === 1, await activeDot(page, hero));
    const moving = await page.$eval(`${hero} .carousel-track`, (t) => getComputedStyle(t).transitionDuration);
    check('hero: slides sideways in 0.5s', moving === '0.5s', moving);
    await page.hover(hero);
    const held = await activeDot(page, hero);
    await sleep(5600);
    check('hero: pauses while hovered', (await activeDot(page, hero)) === held, await activeDot(page, hero));
    await page.click(`${hero} .carousel-next`);
    await sleep(700);
    const afterArrow = await activeDot(page, hero);
    check('hero: next arrow moves on', afterArrow === (held + 1) % 4, afterArrow);
    await page.mouse.move(...NEUTRAL);
    await sleep(5600);
    check('hero: stops moving once the visitor used it', (await activeDot(page, hero)) === afterArrow, await activeDot(page, hero));
    await page.click(`${hero} .carousel-dot:nth-child(1)`);
    await sleep(700);
    check('hero: dots jump to a slide', (await activeDot(page, hero)) === 0);
    await page.click(`${hero} .carousel-prev`);
    await sleep(900);
    check('hero: going back from the first slide loops to the last', (await activeDot(page, hero)) === 3, await activeDot(page, hero));
    check('hero: still one slide exposed after looping', (await page.$$(`${hero} .carousel-slide:not([aria-hidden="true"])`)).length === 1);

    // Rows and circles
    const deals = '[aria-labelledby="deals-heading"]';
    await page.$eval(deals, (s) => s.scrollIntoView({ block: 'center' }));
    await sleep(600);
    await page.hover(`${deals} .carousel-next`);
    const rowStart = await activeDot(page, deals);
    await page.click(`${deals} .carousel-next`);
    await sleep(700);
    check('deals row: arrow slides one book along', (await activeDot(page, deals)) === rowStart + 1, `${rowStart} -> ${await activeDot(page, deals)}`);
    check('deals row: 4 books visible at 1280px', (await page.$$(`${deals} .carousel-slide:not([aria-hidden="true"])`)).length === 4);

    // Card photo swap on hover (in the still ALL PRODUCTS grid, on a book with 2+ photos)
    await page.$eval('[aria-labelledby="all-heading"]', (s) => s.scrollIntoView({ block: 'start' }));
    await sleep(800);
    const gridCards = await page.$$('[aria-labelledby="all-heading"] .book-card');
    let card = null;
    for (const c of gridCards) if (await c.$('.card-photo-arrow')) card = card ?? c;
    check('cards: the grid has a book with more than one photo to test', card !== null);
    if (card) {
      await card.evaluate((c) => c.scrollIntoView({ block: 'center' }));
      await sleep(300);
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 }).catch(() => {});
      const media = await card.$('.card-media');
      await media.hover();
      // The extra photos are about 1 MB each and only start loading on the first hover.
      const swapped = await card
        .waitForSelector('.card-photo-extra[data-shown]', { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      check('cards: hovering a card fades in its next photo', swapped);
      check('cards: the lift and shadow show on hover', (await card.evaluate((c) => getComputedStyle(c).boxShadow)) !== 'none');
      await page.mouse.move(...NEUTRAL);
      await sleep(700);
      check('cards: leaving the card goes back to the cover', (await card.$('.card-photo-extra[data-shown]')) === null);
    }

    const circlesNext = await page.$('.circles-section .carousel-next');
    if (circlesNext) {
      await page.$eval('.circles-section', (s) => s.scrollIntoView({ block: 'center' }));
      await sleep(500);
      await circlesNext.click();
      await sleep(700);
      check('circles: arrow slides the categories', (await activeDot(page, '.circles-section')) === 1);
    }

    // Nav menus
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    const fiction = (await db.query(`select distinct category from public.books where is_visible and category in ('Romance','Thriller & Mystery','Fantasy','Literary Fiction','Comics & Manga')`)).rows.length;
    const firstMenuButton = await page.$$('.nav-menu-button');
    await firstMenuButton[0].hover();
    check('nav menu: FICTION opens on hover', await waitSel(page, '.nav-menu-panel', 2000));
    check('nav menu: lists the fiction categories', (await page.$$('.nav-menu-panel a[href*="category="]')).length === fiction, fiction);
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, 'nav-menu-light-1280.png'), clip: { x: 0, y: 0, width: 1280, height: 480 } });
    await page.keyboard.press('Escape');
    const menuClosed = await gone(page, '.nav-menu-panel');
    const focusBack = await page
      .waitForFunction(() => document.activeElement?.classList.contains('nav-menu-button'), { timeout: 1500 })
      .then(() => true)
      .catch(() => false);
    const menuState = await page.evaluate(() => ({
      panels: [...document.querySelectorAll('.nav-menu-panel')].map((p) => `${p.closest('.nav-menu')?.querySelector('.nav-menu-button')?.textContent.trim()}:${getComputedStyle(p).opacity}`),
      expanded: [...document.querySelectorAll('.nav-menu-button[aria-expanded="true"]')].map((b) => b.textContent.trim()),
      active: document.activeElement?.textContent.trim().slice(0, 30),
    }));
    check('nav menu: Escape closes it and focus returns to the button', menuClosed && focusBack, `closed=${menuClosed} ${JSON.stringify(menuState)}`);
    await page.keyboard.press('ArrowDown');
    await waitSel(page, '.nav-menu-panel', 2000);
    await sleep(100);
    check('nav menu: Arrow down opens it and focuses the first link', await page.evaluate(() => document.activeElement?.closest('.nav-menu-panel') !== null));
    const firstCategory = await page.$eval('.nav-menu-panel a[href*="category="]', (a) => a.textContent.trim());
    await page.$eval('.nav-menu-panel a[href*="category="]', (a) => a.click());
    await page.waitForFunction(() => location.pathname === '/books', { timeout: 4000 }).catch(() => {});
    check('nav menu: a category opens the filtered Books page and closes the menu', (await gone(page, '.nav-menu-panel')) && new URL(page.url()).searchParams.get('category') === firstCategory);
    const dbCounts = Object.fromEntries(
      (await db.query(`select category, count(*)::int as n from public.books where is_visible group by category`)).rows.map((r) => [r.category, r.n]),
    );
    await waitSel(page, '.book-grid .book-card');
    check('books page: category filter count matches the database', new RegExp(`^${dbCounts[firstCategory]} books?`).test(await text(page, '.page-meta')), await text(page, '.page-meta'));
    check('nav: the open category is marked in the nav row', (await page.$('.nav-menu-button[data-current]')) !== null);
    await goto(page, '/books?category=Self-Help');
    await waitSel(page, '.book-grid .book-card');
    check('nav: SELF-HELP link marked current on its page', (await page.$eval('.header-nav a[href="/books?category=Self-Help"]', (a) => a.getAttribute('aria-current'))) === 'page');

    // Filters reached from URLs
    const under = (await one(`select count(*)::int as n from public.books where is_visible and stock_quantity > 0 and price <= 299`)).n;
    const regional = (await one(`select count(*)::int as n from public.books where is_visible and (title ilike '%tamil%' or title ilike '%bengali%' or title ilike '%malayalam%')`)).n;
    await goto(page, '/books?max=299&stock=1');
    await waitSel(page, '.book-grid .book-card');
    check('books page: "Up to ₹299" filter count matches the database', new RegExp(`^${under} books`).test(await text(page, '.page-meta')), await text(page, '.page-meta'));
    check('books page: every listed price is ₹299 or less', (await page.$$eval('.book-grid .price', (ps) => ps.map((p) => Number(p.textContent.replace(/[^\d.]/g, ''))))).every((n) => n <= 299));
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
    await page.$eval('.footer-links a[href="/returns"]', (a) => a.click());
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
    await page.$eval('.footer-top', (b) => b.scrollIntoView());
    await sleep(200);
    await page.click('.footer-top');
    await page.waitForFunction(() => window.scrollY === 0, { timeout: 3000 }).catch(() => {});
    check('footer: Go to top scrolls back up', (await page.evaluate(() => window.scrollY)) === 0);
    check('motion/menus/filters/pages: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- Phone: side menu, swipe, marquee ----------
  {
    const { page, ctx, errors } = await newPage({ width: 375, height: 812, touch: true });
    await goto(page, '/');
    await waitSel(page, '.hero-deal-title');
    check('phone: carousel arrows hidden (swipe and dots instead)', await page.$eval('.hero-carousel .carousel-next', (b) => getComputedStyle(b).display === 'none'));
    const box = await page.$eval('.hero-carousel .carousel-viewport', (v) => {
      const r = v.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.touchscreen.touchStart(box.x + 100, box.y);
    await page.touchscreen.touchMove(box.x - 40, box.y);
    await page.touchscreen.touchMove(box.x - 120, box.y);
    await page.touchscreen.touchEnd();
    await sleep(800);
    check('phone: swiping the hero moves to the next slide', (await activeDot(page, '.hero-carousel')) === 1, await activeDot(page, '.hero-carousel'));
    check('phone: trust strip scrolls as a marquee', (await page.$eval('.trust-marquee', (m) => getComputedStyle(m).animationName)) === 'marquee');
    check('phone: header shows menu, search, logo and bag', (await page.$('.menu-button')) && (await page.$eval('.header-search-icon', (e) => getComputedStyle(e).display !== 'none')) && (await page.$('.brand-logo')));
    await page.click('.menu-button');
    await waitSel(page, '.drawer');
    check('phone menu: Categories section lists the genres', await waitSel(page, '.drawer nav[aria-label="Categories"] a[href*="category="]', 4000));
    check('phone menu: Help section links the policy pages', (await page.$$('.drawer nav[aria-label="Help"] a')).length === 5);
    await sleep(400);
    await page.screenshot({ path: path.join(SHOTS, 'drawer-categories-light-375.png') });
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
    check('book page: title matches the database', (await text(page, '.detail-title')) === book.title);
    const body = await page.$eval('main', (m) => m.innerText);
    check('book page: no SKU, package size or shipping weight', !/\bSKU\b|Package size|Shipping weight/i.test(body));
    check('book page: Add to cart is the black primary button', (await page.$eval('.detail-buy .btn-primary', (b) => getComputedStyle(b).backgroundColor)) === BLACK);
    check('book page: Buy now and Save are quiet outline buttons', /Buy now/i.test(body) && (await page.$('.buy-secondary .btn-outline[aria-pressed]')) !== null);
    const thumbs = await page.$$('.gallery-thumbs .thumb');
    if (thumbs.length > 1) {
      await thumbs[1].click();
      await sleep(300);
      check('book page: choosing a thumbnail selects it', (await page.$eval('.gallery-thumbs li:nth-child(2) .thumb', (b) => b.getAttribute('aria-pressed'))) === 'true');
    }
    await page.screenshot({ path: path.join(SHOTS, 'book-light-1280.png'), fullPage: true });
    await page.$$eval('.detail-buy .btn-primary', (bs) => bs[0].click());
    await page.waitForFunction(() => document.querySelector('.cart-count')?.textContent.trim() === '1', { timeout: 4000 }).catch(() => {});
    check('book page: Add to cart turns into the stepper, panel stays shut', (await waitSel(page, '.detail-buy .cart-stepper.is-block', 3000)) && (await page.$('.cart-panel')) === null);
    check('book page: the stepper fills the buy row', (await page.$eval('.detail-buy .cart-stepper', (e) => e.getBoundingClientRect().width)) === (await page.$eval('.detail-buy .buy-row', (e) => e.getBoundingClientRect().width)));
    await page.$$eval('.buy-secondary button', (bs) => bs.find((b) => b.textContent.trim() === 'Buy now')?.click());
    await page.waitForFunction(() => location.pathname === '/cart', { timeout: 4000 }).catch(() => {});
    check('book page: Buy now goes to the cart page without adding twice', new URL(page.url()).pathname === '/cart' && (await text(page, '.cart-count')) === '1');
    check('cart page: one line rendered with the shared cart line', await waitSel(page, 'main .line .line-inner'));
    check('cart page: summary has no dark header bar', (await page.$eval('.summary-head', (e) => getComputedStyle(e).backgroundColor)) !== 'rgb(17, 17, 17)');
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
    await waitSel(page, '[aria-labelledby="deals-heading"] .book-card');
    await (await page.$('[aria-labelledby="deals-heading"] .book-card .btn-card')).click();
    await page.waitForFunction(() => document.querySelector('.cart-count')?.textContent.trim() === '1', { timeout: 4000 }).catch(() => {});
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
    check('checkout: Place order is the black primary button', (await page.$$eval('main .btn-primary', (bs) => bs.filter((b) => /Place order/i.test(b.textContent)).map((b) => getComputedStyle(b).backgroundColor))).join() === BLACK);
    await page.screenshot({ path: path.join(SHOTS, 'checkout-light-1280.png'), fullPage: true });
    const before = (await one('select count(*)::int as n from public.orders')).n;
    await page.$$eval('main button[type=submit]', (bs) => bs.find((b) => /Place order/.test(b.textContent))?.click());
    await page.waitForFunction(() => /^\/orders\//.test(location.pathname), { timeout: 8000 }).catch(() => {});
    check('checkout: order saved once and order page opens', /^\/orders\//.test(new URL(page.url()).pathname) && (await one('select count(*)::int as n from public.orders')).n === before + 1);
    check('order page: "pay in cash when it arrives" notice', await page.waitForFunction(() => /Pay in cash when it arrives/i.test(document.body.innerText), { timeout: 5000 }).then(() => true).catch(() => false));
    const placedId = new URL(page.url()).pathname.split('/').pop();
    check('order: saved as a confirmed cash on delivery order', (await one(`select status, payment_method from public.orders where id = $1`, [placedId]))?.status === 'confirmed');
    check('order page: shows the order as Confirmed', (await text(page, '.page-head .status')) === 'Confirmed');
    check('order page: the parcel is being prepared', await page.waitForFunction(() => /Preparing to ship/i.test(document.body.innerText), { timeout: 5000 }).then(() => true).catch(() => false));
    check('order page: the customer can still cancel before pickup', /Cancel order/i.test(await page.$eval('main', (m) => m.innerText)));
    check('order: cart emptied after ordering', await gone(page, '.cart-count', 4000));
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
    check('customer: tracking shows the courier and AWB', await reader.page.waitForFunction(() => /Tracking number/i.test(document.body.innerText) && /On the way/i.test(document.body.innerText), { timeout: 8000 }).then(() => true).catch(() => false));
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
    const { page, ctx } = await newPage({ prefs: { theme: 'system', motion: 'reduce' } });
    await goto(page, '/');
    await waitSel(page, '.cart-button');
    await page.click('.cart-button');
    await waitSel(page, '.cart-panel');
    await sleep(30);
    const transform = await page.$eval('.cart-panel', (e) => getComputedStyle(e).transform);
    check('reduce motion: cart panel is in place immediately', transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)', transform);
    await page.keyboard.press('Escape');
    await gone(page, '.cart-panel');
    await page.mouse.move(...NEUTRAL);
    await waitSel(page, '.hero-deal-title');
    check('reduce motion: sections are shown without waiting to scroll', (await page.$eval('[aria-labelledby="deals-heading"]', (s) => getComputedStyle(s).opacity).catch(() => null)) === '1');
    check('reduce motion: the trust strip stands still', (await page.$eval('.trust-marquee', (m) => getComputedStyle(m).animationName)) === 'none');
    const offer = (await visibleSlides(page, '.announcement-bar'))[0];
    await sleep(5800);
    check('reduce motion: the hero does not move by itself', (await activeDot(page, '.hero-carousel')) === 0, await activeDot(page, '.hero-carousel'));
    check('reduce motion: the announcement bar does not move by itself', (await visibleSlides(page, '.announcement-bar'))[0] === offer);
    await page.click('.hero-carousel .carousel-next');
    await sleep(50);
    check('reduce motion: arrows change slides instantly', (await activeDot(page, '.hero-carousel')) === 1 && (await page.$eval('.hero-carousel .carousel-track', (t) => t.style.transition)) === 'none');
    await ctx.close();
  }

  // ---------- Themes, widths, overflow ----------
  const pages = ['/', '/books', '/books?max=299&stock=1', '/books?collection=regional', '/cart', '/terms', '/about', '/returns', '/shipping', '/privacy', '/nowhere'];
  for (const scheme of ['light', 'dark']) {
    for (const [w, h] of [[320, 640], [375, 812], [768, 1024], [1280, 900]]) {
      const { page, ctx, errors } = await newPage({ width: w, height: h, scheme, touch: w < 768 });
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
        await waitSel(page, '.product-row .book-card');
        await scrollThrough(page);
        await page.screenshot({ path: path.join(SHOTS, `home-${scheme}-${w}.png`), fullPage: true });
        await (await page.$('.product-row .book-card .btn-card')).click();
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
