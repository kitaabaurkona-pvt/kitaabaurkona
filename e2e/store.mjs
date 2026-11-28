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
import { asRole, createBackend, fetchPublicBooks, handleAuth, handleRest, SERVICE_TOKEN, USERS } from './fake-supabase.mjs';
import { createHandler } from '../supabase/functions/shipping/handler.js';
import { createXpressbees } from '../supabase/functions/shipping/xpressbees.js';
import { createDelhivery } from '../supabase/functions/shipping/delhivery.js';
import { pdfTexts } from '../supabase/functions/shipping/labeldata.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { SEARCH_HINTS } from '../src/utils/searchHints.js';
import { templateCsv } from '../src/utils/csvTemplate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://localhost:5199';
const ADMIN_BASE = process.env.ADMIN_BASE || 'http://localhost:5198';
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
  if (p === '/api/reverseshipments') {
    return json(200, { status: true, data: { order_id: 1, shipment_id: 2, awb_number: String(14344940400000 + XB_CALLS.length), courier_id: '8', courier_name: 'Express Reverse', status: 'booked', label: 'https://xb-files.s3.amazonaws.com/labels/r.pdf' } });
  }
  if (p === '/api/ndr') return json(200, { status: true, data: [] });
  return json(404, { status: false, message: 'Not found' });
}
// A stand-in Delhivery answering like its live API (shapes seen on track.delhivery.com).
const DL_CALLS = [];
async function fakeDelhivery(url, init = {}) {
  const u = new URL(url);
  const p = u.pathname;
  DL_CALLS.push(p);
  const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  if (p === '/c/api/pin-codes/json/') return json(200, { delivery_codes: [{ postal_code: { pin: Number(u.searchParams.get('filter_codes')), cod: 'Y', pre_paid: 'Y', pickup: 'Y', remarks: '' } }] });
  if (p === '/api/kinko/v1/invoice/charges/.json') return json(200, [{ total_amount: u.searchParams.get('md') === 'S' ? 116.14 : 140.5, charge_COD: 40 }]);
  if (p === '/api/cmu/create.json') {
    const sh = JSON.parse(new URLSearchParams(init.body).get('data')).shipments[0];
    return json(200, { success: true, packages: [{ status: 'Success', waybill: String(5021310000000 + DL_CALLS.length), refnum: sh.order, remarks: [] }] });
  }
  if (p === '/api/p/packing_slip') return json(200, { packages: [{ pdf_download_link: 'https://s3-ap-southeast-1.amazonaws.com/pdfs/e2e-label.pdf' }], packages_found: 1 });
  if (p === '/fm/request/new/') {
    const b = JSON.parse(init.body);
    return json(201, { pickup_id: 4323300, pickup_date: b.pickup_date, pickup_time: b.pickup_time, expected_package_count: b.expected_package_count });
  }
  if (p === '/api/v1/packages/json/') return json(200, { Success: false, Error: 'Data does not exists for provided Waybill(s)' });
  if (p === '/api/backend/clientwarehouse/create/') {
    const b = JSON.parse(init.body);
    return json(200, { data: { name: b.name, active: true, message: 'A new client warehouse has been created in HQ(Delhivery).' }, success: true, error: '' });
  }
  return json(404, {});
}
const shippingDb = createClient('https://fake.supabase.co', SERVICE_TOKEN, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: inProcessFetch } });
// Xpressbees' own label PDF, as the label-data action downloads it (made here, never fetched).
const xbLabelPdf = await (async () => {
  const d = await PDFDocument.create();
  const pg = d.addPage([288, 432]);
  pg.drawText('Routing Code: E/S-90/1C/028', { x: 10, y: 280, font: await d.embedFont(StandardFonts.Helvetica), size: 10 });
  return d.save();
})();
const shippingFunction = createHandler({
  db: shippingDb,
  fetchFile: async () => xbLabelPdf,
  cronSecret: 'e2e-cron-secret-0123456789abcdef',
  allowedOrigins: [new URL(BASE).origin, new URL(ADMIN_BASE).origin],
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
  makeDelhivery: () => createDelhivery({ baseUrl: 'https://track.delhivery.com', token: 'e2e-delhivery-token', fetchImpl: fakeDelhivery }),
});

// A stand-in for the Hostinger photo storage (hostinger/photos/upload.php): it asks the
// fake Supabase whether the caller is an admin, like the real file does.
const PHOTO_ORIGIN = 'https://kitaabaurkonaphotos.bizwitheet.com';
const photoLog = { uploads: 0, refused: 0, deleted: [] };
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
async function photoHost(req, url) {
  const cors = { 'access-control-allow-origin': new URL(ADMIN_BASE).origin, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'Origin' };
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
  if (req.method() === 'GET' && url.pathname.startsWith('/files/')) return req.respond({ status: 200, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' }, body: TINY_PNG });
  if (req.method() === 'POST' && url.pathname === '/upload.php') {
    const json = (status, value) => req.respond({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(value) });
    const admin = await handleRest(db, { method: 'POST', url: new URL('https://fake.supabase.co/rest/v1/rpc/is_admin'), headers: req.headers(), body: '{}' });
    if (admin.status !== 200 || admin.body !== 'true') {
      photoLog.refused += 1;
      return json(403, { error: 'admin' });
    }
    if (String(req.headers()['content-type'] ?? '').startsWith('application/json')) {
      const body = JSON.parse(req.postData() || '{}');
      photoLog.deleted.push(...(body.urls ?? []));
      return json(200, { deleted: (body.urls ?? []).length });
    }
    photoLog.uploads += 1;
    return json(201, { url: `${PHOTO_ORIGIN}/files/2026/11/${crypto.randomBytes(16).toString('hex')}.webp` });
  }
  return req.respond({ status: 404, body: '' });
}

// A stand-in for Supabase Storage: uploads of customers' return photos and the
// short-lived links admins open them with. Uploads must go to the caller's own folder,
// as the bucket's policy in schema.sql asks.
const storedPhotos = new Map();
function storageHost(req, url) {
  const json = (status, value) => req.respond({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ''));
  if (req.method() === 'POST' && p === '/object/sign/return-photos') {
    const body = JSON.parse(req.postData() || '{}');
    return json(200, (body.paths ?? []).map((name) => (storedPhotos.has(name) ? { path: name, signedURL: `/object/sign/return-photos/${name}?token=t`, error: null } : { path: name, signedURL: null, error: 'Not found' })));
  }
  if (req.method() === 'GET' && p.startsWith('/object/sign/return-photos/')) {
    const name = p.slice('/object/sign/return-photos/'.length);
    return storedPhotos.has(name) ? req.respond({ status: 200, headers: { ...CORS, 'content-type': 'image/png' }, body: TINY_PNG }) : req.respond({ status: 404, headers: CORS, body: '' });
  }
  if (req.method() === 'POST' && p.startsWith('/object/return-photos/')) {
    const name = p.slice('/object/return-photos/'.length);
    let sub = null;
    try {
      sub = JSON.parse(Buffer.from(String(req.headers().authorization ?? '').split('.')[1] ?? '', 'base64url').toString()).sub;
    } catch {
      sub = null;
    }
    if (!sub || name.split('/')[0] !== sub) return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    storedPhotos.set(name, true);
    return json(200, { Key: `return-photos/${name}`, Id: crypto.randomUUID() });
  }
  return json(404, { statusCode: '404', error: 'not_found', message: 'Not found' });
}

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
    if (url.origin === PHOTO_ORIGIN) return photoHost(req, url);
    if (!url.hostname.endsWith('.supabase.co')) return req.continue();
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
    if (url.pathname.startsWith('/storage/v1/')) return storageHost(req, url);
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
// The admin panel is its own site (npm run build:admin + preview:admin, or dev:admin).
const gotoA = (page, p) => page.goto(`${ADMIN_BASE}${p}`, { waitUntil: 'domcontentloaded' });
const onAdminPath = (page, want, ms = 8000) =>
  page
    .waitForFunction((p) => location.pathname === p, { timeout: ms }, want)
    .then(() => true)
    .catch(() => false);
async function adminSignIn(page, email = 'admin@example.com', password = 'admin-pass-1') {
  await gotoA(page, '/sign-in');
  await waitSel(page, '#email');
  await page.type('#email', email);
  await page.type('#password', password);
  await page.click('button[type=submit]');
  if (email === 'admin@example.com') await onAdminPath(page, '/admin');
}
const waitSel = (page, sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
const gone = (page, sel, ms = 3000) => page.waitForSelector(sel, { hidden: true, timeout: ms }).then(() => true).catch(() => false);
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => null);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const BLACK = 'rgb(0, 0, 0)';
// The header cart button names the count ("Cart, 2 items"); it waits for a flying cover.
const cartLabel = (page) => page.$eval('.cart-button', (b) => b.getAttribute('aria-label')).catch(() => null);
const waitCart = (page, n, ms = 3000) =>
  page
    .waitForFunction((want) => [...document.querySelectorAll('.cart-button, .bottom-nav-cart')].some((b) => b.getAttribute('aria-label') === want), { timeout: ms }, `Cart, ${n} ${n === 1 ? 'item' : 'items'}`)
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
    check('home: "₹299 & under" shows up to 6 books, all ₹299 or less', cheap.length >= 1 && cheap.length <= 6 && cheap.every((n) => n <= 299), cheap.join(','));
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
      .waitForFunction(() => !document.querySelector('.cart-flight') && [...document.querySelectorAll('.cart-button, .bottom-nav-cart')].some((b) => b.getAttribute('aria-label') === 'Cart, 1 item'), { timeout: 3000 })
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

  // ---------- Bottom navigation ----------
  {
    const { page, ctx, errors } = await newPage();
    await goto(page, '/books?stock=1');
    await waitSel(page, '.book-grid .book-card');
    check('desktop nav: visible while the header is on screen', await page.waitForSelector('.bottom-nav', { visible: true }).then(Boolean));
    await page.evaluate(() => window.scrollTo(0, 1400));
    check('desktop nav: still visible after scrolling', await page.waitForSelector('.bottom-nav', { visible: true }).then(Boolean));
    const card = await page.evaluateHandle(() => [...document.querySelectorAll('.book-grid .book-card')].find((c) => { const t = c.getBoundingClientRect().top; return t > 120 && t < 520 && c.querySelector('.btn-card:not([aria-disabled])'); }));
    await card.$eval('.btn-card', (b) => b.click());
    check('desktop nav: the cover flies to it', await waitSel(page, '.cart-flight img', 300));
    check('desktop nav: its count waits for the cover, then shows 1', (await page.$eval('.bottom-nav-cart', (b) => b.getAttribute('aria-label'))) === 'Cart, 0 items' && (await page.waitForFunction(() => document.querySelector('.bottom-nav-cart')?.getAttribute('aria-label') === 'Cart, 1 item', { timeout: 3000 }).then(() => true).catch(() => false)));
    await sleep(400);
    await page.screenshot({ path: path.join(SHOTS, 'bottom-nav-1280.png') });
    await page.click('.bottom-nav-cart');
    check('desktop nav: opens the cart panel', await waitSel(page, '.cart-panel', 3000));
    await page.keyboard.press('Escape');
    await gone(page, '.cart-panel');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    check('desktop nav: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
    const phone = await newPage({ width: 390, height: 844, touch: true });
    await goto(phone.page, '/books');
    await waitSel(phone.page, '.book-grid .book-card');
    await phone.page.evaluate(() => window.scrollTo(0, 1600));
    await sleep(600);
    check('phone: bottom nav appears after the header scrolls away', (await phone.page.$eval('.site-header', (h) => h.getBoundingClientRect().bottom)) < 0 && await phone.page.waitForSelector('.bottom-nav', { visible: true }).then(Boolean));
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
    await page.$eval('.cart-button, .bottom-nav-cart', (b) => b.click());
    await waitSel(page, '.cart-panel');
    await sleep(400);
    await page.$$eval('.cart-panel-links button', (bs) => bs.find((b) => /continue shopping/i.test(b.textContent))?.click());
    const panelGone = await gone(page, '.cart-panel');
    const afterPanel = await page.evaluate(() => window.scrollY);
    check('panel: Continue shopping closes it and keeps the place', panelGone && new URL(page.url()).pathname === '/' && Math.abs(afterPanel - beforeCart) <= 2, `gone=${panelGone} ${new URL(page.url()).pathname} ${afterPanel} vs ${beforeCart}`);
    await page.waitForSelector('.cart-button, .bottom-nav-cart', { timeout: 3000 }).catch(() => {});
    await page.$eval('.bottom-nav-cart', (b) => b.click()).catch(() => page.$eval('.cart-button', (b) => b.click()));
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
    // The copies stay tappable (a swipe can leave one under the finger), but screen readers and Tab skip them.
    const genreCopies = await page.evaluate(() => ({
      hiddenSets: document.querySelectorAll('#genre-rail .genre-set[aria-hidden="true"]').length,
      copyTabs: [...document.querySelectorAll('#genre-rail .genre-set[aria-hidden="true"] a')].map((a) => a.tabIndex),
      realTabs: [...document.querySelectorAll('#genre-rail a')].filter((a) => !a.closest('[aria-hidden="true"]')).map((a) => a.tabIndex),
    }));
    check('genre row: copies follow the tiles, hidden from the keyboard and screen readers', genreCopies.hiddenSets >= 1 && genreCopies.copyTabs.length > 0 && genreCopies.copyTabs.every((t) => t === -1) && genreCopies.realTabs.filter((t) => t >= 0).length === 5, JSON.stringify(genreCopies));
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
    check('checkout: city, state and PIN code come from the saved details', JSON.stringify(await page.evaluate(() => ['#ship-city', '#ship-state', '#ship-pincode'].map((s) => document.querySelector(s).value))) === JSON.stringify(['Udaipur', 'Rajasthan', '313001']));
    await page.$eval('#ship-pincode', (e) => e.select());
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
    // Another book is already in the cart: Order now must not pull it into the order.
    const cartBook = await one(`select id, title from public.books where is_visible and stock_quantity > 2 and id <> $1 order by id asc limit 1`, [orderBook.id]);
    await goto(page, `/books/${cartBook.id}`);
    await waitSel(page, '.buy-stack .btn-outline');
    await page.$eval('.buy-stack .btn-outline', (b) => b.click());
    await waitCart(page, 1, 4000);
    await goto(page, `/books/${orderBook.id}`);
    await waitSel(page, '.buy-stack .order-now');
    await page.click('.buy-stack .order-now');
    await page.waitForFunction(() => location.pathname === '/checkout', { timeout: 5000 }).catch(() => {});
    const orderTitle = (await one(`select title from public.books where id = $1`, [orderBook.id])).title.split(' by ')[0].slice(0, 20);
    const onCheckout = await page.waitForFunction((t) => location.pathname === '/checkout' && document.querySelector('main')?.innerText.includes(t), { timeout: 6000 }, orderTitle).then(() => true).catch(() => false);
    check('Order now: a signed-in shopper lands on checkout with the book in the order', onCheckout, orderTitle);
    const cartTitle = cartBook.title.slice(0, 20);
    const orderRows = () => page.$$eval('.checkout-lines > div', (rows) => rows.map((r) => r.innerText));
    const moreRows = () => page.$$eval('.checkout-more li', (rows) => rows.map((r) => r.innerText));
    await waitSel(page, '.checkout-more li');
    let rows = await orderRows();
    check('Order now: the order holds only the book ordered', rows.length === 1 && rows[0].includes(orderTitle) && !rows[0].includes(cartTitle), JSON.stringify(rows));
    check('Order now: the other cart book is offered under "Also in your cart"', (await moreRows()).some((r) => r.includes(cartTitle)));
    check('Order now: the summary counts one item', /Items\s*1(?!\d)/.test(await text(page, '.summary-rows')));
    await page.click('.checkout-more li button');
    await page.waitForFunction(() => document.querySelectorAll('.checkout-lines > div').length === 2, { timeout: 3000 }).catch(() => {});
    rows = await orderRows();
    check('Order now: "Add to this order" brings the cart book in', rows.length === 2 && rows.some((r) => r.includes(cartTitle)) && (await page.$('.checkout-more')) === null && /Items\s*2(?!\d)/.test(await text(page, '.summary-rows')), JSON.stringify(rows));
    await page.click('.checkout-lines button');
    await page.waitForFunction(() => document.querySelectorAll('.checkout-lines > div').length === 1, { timeout: 3000 }).catch(() => {});
    check('Order now: Remove takes it back out of the order', (await orderRows()).length === 1 && (await moreRows()).length === 1);
    check('Order now: checkout does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    // City, state and PIN code are already filled in from the saved details.
    await waitSel(page, '.pin-check[data-state="ok"]', 6000);
    await page.screenshot({ path: path.join(SHOTS, 'checkout-order-now-light-1280.png'), fullPage: true });
    const ordersBefore = (await one('select count(*)::int as n from public.orders')).n;
    await page.$$eval('main button[type=submit]', (bs) => bs.find((b) => /Place order/.test(b.textContent))?.click());
    await page.waitForFunction(() => /^\/orders\//.test(location.pathname), { timeout: 8000 }).catch(() => {});
    const buyOrderId = new URL(page.url()).pathname.split('/').pop();
    const buyItems = (await one(`select count(*)::int as n, min(book_id::text) as book from public.order_items where order_id = $1`, [buyOrderId]).catch(() => null)) ?? {};
    check('Order now: the order saved has only that book', (await one('select count(*)::int as n from public.orders')).n === ordersBefore + 1 && buyItems.n === 1 && buyItems.book === String(orderBook.id), JSON.stringify(buyItems));
    check('Order now: the other book stays in the cart after ordering', await waitCart(page, 1, 4000));
    check('signed-in flow: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- The admin site: sign-in only, admins only, and no shop ----------
  {
    const { page, ctx, errors } = await newPage();
    await gotoA(page, '/');
    check('admin site: a visitor lands on the sign-in page', (await onAdminPath(page, '/sign-in')) && (await text(page, '.auth-title')) === 'Admin log in');
    check('admin site: no shop header, cart, footer or sign-up', (await page.$('.site-header')) === null && (await page.$('.cart-button')) === null && (await page.$('.site-footer')) === null && !/Sign up/i.test(await page.$eval('body', (b) => b.innerText)));
    check('admin site: it tells search engines to stay away', (await page.$eval('meta[name="robots"]', (m) => m.content).catch(() => '')) === 'noindex, nofollow' && (await page.title()).includes('Admin'));
    for (const p of ['/books', '/cart', '/checkout', '/sign-up', '/account']) {
      await gotoA(page, p);
      check(`admin site: ${p} is not a page here (back to sign-in)`, await onAdminPath(page, '/sign-in', 5000));
    }
    await gotoA(page, '/admin/orders');
    check('admin site: the panel is closed to visitors', (await onAdminPath(page, '/sign-in', 5000)) && (await page.$('.ap-nav')) === null);

    // A customer account can prove who it is, but does not get in.
    await page.type('#email', 'reader@example.com');
    await page.type('#password', 'reader-pass-1');
    await page.click('button[type=submit]');
    check('admin site: a customer is refused, with the reason', await page.waitForFunction(() => /not an admin/i.test(document.querySelector('.auth-error')?.textContent ?? ''), { timeout: 8000 }).then(() => true).catch(() => false));
    check('admin site: the refused customer is signed out again', await page.evaluate(() => Object.keys(localStorage).filter((k) => /^sb-.*-auth-token$/.test(k)).every((k) => !localStorage.getItem(k))));
    await gotoA(page, '/admin');
    check('admin site: the refused customer still cannot open the panel', (await onAdminPath(page, '/sign-in', 5000)) && (await page.$('.ap-nav')) === null);

    await page.type('#email', 'admin@example.com');
    await page.type('#password', 'wrong-password');
    await page.click('button[type=submit]');
    check('admin site: a wrong password is refused', await page.waitForFunction(() => (document.querySelector('.auth-error')?.textContent ?? '').length > 0 && location.pathname === '/sign-in', { timeout: 8000 }).then(() => true).catch(() => false));

    // An admin gets in, and lands on the page first asked for.
    await gotoA(page, '/admin/orders');
    await onAdminPath(page, '/sign-in', 5000);
    await page.type('#email', 'admin@example.com');
    await page.type('#password', 'admin-pass-1');
    await page.click('button[type=submit]');
    check('admin site: an admin signs in and lands on the page asked for', await onAdminPath(page, '/admin/orders'));
    page.on('dialog', (d) => d.accept()); // "Leave site? Changes you made may not be saved"
    const retype = async (handle, value) => {
      await handle.evaluate((el) => el.select());
      await page.keyboard.press('Backspace');
      await handle.type(value);
    };
    const nav = (label) => page.$$eval('.ap-side .ap-nav-link', (as, t) => as.find((a) => a.textContent.trim() === t)?.click(), label);
    check('admin site: the menu shows who is signed in', (await text(page, '.ap-side .ap-user')) === 'admin@example.com' && (await page.$('.site-header')) === null);
    check('admin site: every section is in the menu', (await page.$$eval('.ap-side .ap-nav a', (as) => as.map((a) => a.textContent.trim()).join('|'))) === 'Home|Books|Bulk upload|Process orders|Non-delivery report (NDR)|Return/Exchange requests|RTO & returns|Track orders|Place order|Shipping');
    check('admin site: "Open the store" goes to the live store', (await page.$$eval('.ap-side-foot a', (as) => as.map((a) => a.href))).includes('https://www.kitaabaurkona.com/'));

    await gotoA(page, '/admin');
    check('admin home: order, book and shipping numbers load', await page.waitForFunction(() => document.querySelectorAll('.ap-stat-value').length >= 11 && !document.querySelector('.skeleton'), { timeout: 8000 }).then(() => true).catch(() => false));
    check('admin site: light grey page and a black main button', await page.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(243, 244, 246)' && getComputedStyle(document.querySelector('.ap .btn-primary')).backgroundColor === 'rgb(17, 17, 17)'));
    await page.screenshot({ path: path.join(SHOTS, 'admin-site-dashboard-1280.png'), fullPage: true });

    // ---- Books: list, search, quick edit ----
    await nav('Books');
    check('admin books: the catalogue is listed with covers', (await waitSel(page, '.ap-book-row', 8000)) && /\d+ books/.test(await text(page, '.ap-pager .page-meta')) && (await page.$$('.ap-book-row img.ap-thumb')).length > 0);
    await page.screenshot({ path: path.join(SHOTS, 'admin-site-books-1280.png') });
    const target = await one(`select id, title, sku, price, mrp, stock_quantity, description, image_urls from public.books where is_visible and cardinality(image_urls) between 1 and 8 order by title limit 1`);
    await page.type('#admin-book-search', target.sku);
    check('admin books: search by SKU finds the book', await page.waitForFunction((t) => document.querySelectorAll('.ap-book-row').length === 1 && document.querySelector('.ap-book-row .ap-book-name')?.textContent.includes(t), { timeout: 6000 }, target.title.slice(0, 20)).then(() => true).catch(() => false));
    const stockInput = await page.$(`#quick-${target.id}-stock`);
    await retype(stockInput, String(target.stock_quantity + 3));
    check('admin books: a quick edit shows the save bar', (await waitSel(page, '.ap-savebar', 3000)) && /1 book changed/.test(await text(page, '.ap-savebar p')));
    const priceInput = await page.$(`#quick-${target.id}-price`);
    await retype(priceInput, String(Number(target.mrp) + 50));
    await page.$$eval('.ap-savebar button', (bs) => bs.find((b) => /Save changes/.test(b.textContent))?.click());
    check('admin books: a price above the MRP is refused in the list', await page.waitForFunction(() => /cannot be more than the MRP/.test(document.querySelector('.ap-savebar .notice')?.textContent ?? ''), { timeout: 4000 }).then(() => true).catch(() => false) && Number((await one(`select price from public.books where id = $1`, [target.id])).price) === Number(target.price));
    await retype(priceInput, String(Number(target.price)));
    await page.$$eval('.ap-savebar button', (bs) => bs.find((b) => /Save changes/.test(b.textContent))?.click());
    const quickSaved = await page.waitForFunction(() => !document.querySelector('.ap-savebar'), { timeout: 6000 }).then(() => true).catch(() => false);
    const quickStock = (await one(`select stock_quantity from public.books where id = $1`, [target.id])).stock_quantity;
    check('admin books: a quick edit is saved to the database', quickSaved && quickStock === target.stock_quantity + 3, JSON.stringify({ quickSaved, quickStock, want: target.stock_quantity + 3, bar: await text(page, '.ap-savebar') }));
    await db.query(`update public.books set stock_quantity = $2 where id = $1`, [target.id, target.stock_quantity]);

    // ---- Book editor: description and a new photo ----
    const photoA = path.join(SHOTS, 'e2e-photo-a.png');
    fs.writeFileSync(photoA, TINY_PNG);
    await page.$eval('.ap-book-row .ap-book-name', (a) => a.click());
    check('admin editor: opens from the book name', (await onAdminPath(page, `/admin/books/${target.id}`)) && (await waitSel(page, '#book-description', 8000)));
    check('admin editor: shows the current photos, cover first', (await page.$$('.ap-photo')).length === target.image_urls.length && (await page.$eval('.ap-photo .ap-photo-cover', (e) => e.textContent).catch(() => '')) === 'Cover');
    await page.$eval('#book-description', (el) => el.select());
    await page.keyboard.press('Backspace');
    await page.type('#book-description', 'Written by the browser test. Line one.');
    const uploadsBefore = photoLog.uploads;
    await (await page.$('.ap-photo-add input[type=file]')).uploadFile(photoA);
    check('admin editor: a photo is shrunk and uploaded to the photo storage', await page.waitForFunction((n) => document.querySelectorAll('.ap-photo').length === n && !/Uploading/.test(document.querySelector('.ap-photos').innerText), { timeout: 10000 }, target.image_urls.length + 1).then(() => true).catch(() => false) && photoLog.uploads === uploadsBefore + 1);
    // Make the new (last) photo the cover.
    await page.$$eval('.ap-photo-tools button', (bs) => bs.filter((b) => /the cover/.test(b.getAttribute('aria-label') ?? '')).pop()?.click());
    await page.screenshot({ path: path.join(SHOTS, 'admin-site-editor-1280.png'), fullPage: true });
    await page.$$eval('.ap-savebar button', (bs) => bs.find((b) => /Save changes/.test(b.textContent))?.click());
    const savedOk = await page.waitForFunction(() => /All changes saved/.test(document.querySelector('.ap-savebar p')?.textContent ?? ''), { timeout: 8000 }).then(() => true).catch(() => false);
    const afterSave = await one(`select description, image_urls from public.books where id = $1`, [target.id]);
    check('admin editor: description and photos are saved, new photo as cover', savedOk && afterSave.description === 'Written by the browser test. Line one.' && afterSave.image_urls.length === target.image_urls.length + 1 && afterSave.image_urls[0].startsWith(`${PHOTO_ORIGIN}/files/`) && afterSave.image_urls[1] === target.image_urls[0], JSON.stringify(afterSave));
    // Remove it again: after saving, the photo is deleted from the storage.
    const newPhoto = afterSave.image_urls[0];
    await page.$$eval('.ap-photo-tools button', (bs) => bs.find((b) => b.getAttribute('aria-label') === 'Remove photo 1')?.click());
    await page.$$eval('.ap-savebar button', (bs) => bs.find((b) => /Save changes/.test(b.textContent))?.click());
    const removedOk = await page.waitForFunction(() => /All changes saved/.test(document.querySelector('.ap-savebar p')?.textContent ?? ''), { timeout: 8000 }).then(() => true).catch(() => false);
    await new Promise((r) => setTimeout(r, 800));
    check('admin editor: a removed photo is deleted from the photo storage', removedOk && photoLog.deleted.includes(newPhoto) && JSON.stringify((await one(`select image_urls from public.books where id = $1`, [target.id])).image_urls) === JSON.stringify(target.image_urls));

    // Replace the cover in one step: the new photo takes the old one's place.
    const saveEditor = async () => {
      await page.$$eval('.ap-savebar button', (bs) => bs.find((b) => /Save changes/.test(b.textContent))?.click());
      const ok = await page.waitForFunction(() => /All changes saved/.test(document.querySelector('.ap-savebar p')?.textContent ?? ''), { timeout: 8000 }).then(() => true).catch(() => false);
      await new Promise((r) => setTimeout(r, 800));
      return ok;
    };
    const replaceCover = async () => {
      const before = photoLog.uploads;
      await (await page.$('.ap-photo .ap-photo-replace input[type=file]')).uploadFile(photoA);
      return page.waitForFunction(() => !/Uploading/.test(document.querySelector('.ap-photos').innerText), { timeout: 10000 }).then(() => photoLog.uploads === before + 1).catch(() => false);
    };
    check('admin editor: every photo has a Replace button', (await page.$$('.ap-photo .ap-photo-replace input[type=file]')).length === target.image_urls.length);
    const replacedUpload = await replaceCover();
    const replacedSaved = await saveEditor();
    const replaced = (await one(`select image_urls from public.books where id = $1`, [target.id])).image_urls;
    check('admin editor: Replace swaps the cover in place and keeps the other photos', replacedUpload && replacedSaved && replaced.length === target.image_urls.length && replaced[0].startsWith(`${PHOTO_ORIGIN}/files/`) && JSON.stringify(replaced.slice(1)) === JSON.stringify(target.image_urls.slice(1)) && (await page.$eval('.ap-photo .ap-photo-cover', (e) => e.textContent).catch(() => '')) === 'Cover', JSON.stringify(replaced));
    await replaceCover();
    await saveEditor();
    const replacedAgain = (await one(`select image_urls from public.books where id = $1`, [target.id])).image_urls;
    check('admin editor: replacing a stored photo deletes the old file from the photo storage', replacedAgain[0] !== replaced[0] && replacedAgain[0].startsWith(`${PHOTO_ORIGIN}/files/`) && photoLog.deleted.includes(replaced[0]) && !photoLog.deleted.includes(target.image_urls[0]));
    await db.query(`update public.books set image_urls = $2 where id = $1`, [target.id, target.image_urls]);
    await db.query(`update public.books set description = $2 where id = $1`, [target.id, target.description]);

    // ---- Add a book ----
    await gotoA(page, '/admin/books');
    await waitSel(page, '.ap-book-row', 8000);
    await page.$$eval('.ap-head-actions a', (as) => as.find((a) => /Add book/.test(a.textContent))?.click());
    check('admin add book: an empty editor opens', (await onAdminPath(page, '/admin/books/new')) && (await waitSel(page, '#book-title', 8000)));
    await page.$$eval('.ap-savebar button[type=submit]', (bs) => bs[0]?.click());
    check('admin add book: missing details are marked', await page.waitForFunction(() => document.querySelectorAll('.ap-field-error').length >= 4 && document.activeElement?.id === 'book-title', { timeout: 4000 }).then(() => true).catch(() => false));
    await page.type('#book-title', 'The Browser Test Book');
    await page.type('#book-author', 'Test Author');
    await page.type('#book-description', 'A book added from the admin panel.');
    await page.select('#book-category', 'Romance');
    await page.type('#book-price', '150');
    await page.type('#book-mrp', '200');
    check('admin add book: the discount is shown', /save 25%/i.test((await text(page, '.ap-discount')) ?? ''));
    await page.type('#book-stock_quantity', '2');
    await page.type('#book-sku', 'E2E-NEW-1');
    await page.$eval('#more-details', (d) => d.setAttribute('open', ''));
    await page.type('#book-cost_price', '90');
    await page.$$eval('.ap-savebar button[type=submit]', (bs) => bs[0]?.click());
    const added = await page.waitForFunction(() => /^\/admin\/books\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 8000 }).then(() => true).catch(() => false);
    const newBook = await one(`select b.*, i.cost_price from public.books b left join public.book_internal i on i.book_id = b.id where b.sku = 'E2E-NEW-1'`);
    check('admin add book: the book is saved with its details and cost price', added && newBook && newBook.title === 'The Browser Test Book' && newBook.product_code === 'E2E-NEW-1' && newBook.attributes.author === 'Test Author' && newBook.category === 'Romance' && Number(newBook.price) === 150 && Number(newBook.cost_price) === 90 && newBook.is_visible === true, JSON.stringify({ added, newBook, bar: await text(page, '.ap-savebar'), errs: await page.$$eval('.ap-field-error', (es) => es.map((e) => e.id + ':' + e.textContent)) }));
    await gotoA(page, '/admin/books/new');
    await waitSel(page, '#book-title', 8000);
    await page.type('#book-title', 'Duplicate');
    await page.type('#book-price', '1');
    await page.type('#book-mrp', '1');
    await page.type('#book-stock_quantity', '1');
    await page.type('#book-sku', 'E2E-NEW-1');
    await page.$$eval('.ap-savebar button[type=submit]', (bs) => bs[0]?.click());
    check('admin add book: a SKU already in use is refused', await page.waitForFunction(() => /already/.test(document.querySelector('#book-sku-error')?.textContent ?? ''), { timeout: 6000 }).then(() => true).catch(() => false) && (await one(`select count(*)::int as n from public.books where sku = 'E2E-NEW-1'`)).n === 1);
    await db.query(`delete from public.books where sku = 'E2E-NEW-1'`);

    // ---- Bulk upload with photos and the template ----
    await gotoA(page, '/admin/books');
    await waitSel(page, '.ap-book-row', 8000);
    await nav('Bulk upload');
    check('admin bulk upload: the page opens with the steps and the template button', (await waitSel(page, '.ap-steps', 8000)) && (await page.$$eval('.ap-head-actions button', (bs) => bs.some((b) => /Download template/.test(b.textContent)))));
    const template = path.join(SHOTS, 'e2e-template.csv');
    fs.writeFileSync(template, templateCsv());
    await (await page.$('.dropzone input[type=file]')).uploadFile(template);
    check('admin bulk upload: the template example row is skipped, not added', await page.waitForFunction(() => /example row/.test(document.body.innerText) && !/Upload \d+ book/.test(document.body.innerText), { timeout: 8000 }).then(() => true).catch(() => false));
    await page.$$eval('.ap-files button', (bs) => bs.forEach((b) => b.click()));

    const csv = path.join(SHOTS, 'e2e-upload.csv');
    fs.writeFileSync(csv, '"Product Code","Sku Id","Name","Selling Price","MRP","Quantity","Visibility","Image 1","attr_Author"\n"E2E-ADMIN-1","E2E-ADMIN-SKU-1","The Admin Site Test Book","199","299","4","true","Cover-A.png","Bulk Author"\n"E2E-ADMIN-2","E2E-ADMIN-SKU-2","Second Test Book","99","149","1","true","",""\n');
    const files = { 'cover-a.png': TINY_PNG, 'E2E-ADMIN-SKU-2.png': TINY_PNG, 'E2E-ADMIN-SKU-2-2.png': TINY_PNG, 'stray.png': TINY_PNG };
    const photoPaths = Object.entries(files).map(([name, data]) => {
      const file = path.join(SHOTS, name);
      fs.writeFileSync(file, data);
      return file;
    });
    await (await page.$('.dropzone input[type=file]')).uploadFile(csv, ...photoPaths);
    const uploadButton = await page.waitForFunction(() => [...document.querySelectorAll('button')].find((b) => /^Upload 2 books$/.test(b.textContent.trim())), { timeout: 8000 }).catch(() => null);
    check('admin bulk upload: the CSV and photos are read, matched and checked', Boolean(uploadButton) && /2 books get new photos/.test(await page.$eval('body', (b) => b.innerText)));
    check('admin bulk upload: a photo that matches no book is pointed out', /stray\.png/.test(await page.$eval('body', (b) => b.innerText)));
    await page.screenshot({ path: path.join(SHOTS, 'admin-site-bulk-1280.png'), fullPage: true });
    const uploadsBeforeBulk = photoLog.uploads;
    if (uploadButton) await uploadButton.click();
    const bulkDone = await page.waitForFunction(() => /Uploaded 2 books/.test(document.body.innerText), { timeout: 15000 }).then(() => true).catch(() => false);
    const b1 = await one(`select price, image_urls, attributes from public.books where sku = 'E2E-ADMIN-SKU-1'`);
    const b2 = await one(`select image_urls from public.books where sku = 'E2E-ADMIN-SKU-2'`);
    check('admin bulk upload: books and their photos reach the catalogue', bulkDone && Number(b1?.price) === 199 && b1.attributes.author === 'Bulk Author' && b1.image_urls.length === 1 && b2?.image_urls.length === 2 && [...b1.image_urls, ...b2.image_urls].every((u) => u.startsWith(`${PHOTO_ORIGIN}/files/`)) && photoLog.uploads === uploadsBeforeBulk + 3, JSON.stringify({ b1, b2, uploads: photoLog.uploads - uploadsBeforeBulk }));
    // Uploading a row again without photos keeps the photos the book has.
    fs.writeFileSync(csv, '"Product Code","Sku Id","Name","Selling Price","MRP","Quantity"\n"E2E-ADMIN-2","E2E-ADMIN-SKU-2","Second Test Book","89","149","1"\n');
    await (await page.$('.dropzone input[type=file]')).uploadFile(csv);
    const again = await page.waitForFunction(() => [...document.querySelectorAll('button')].find((b) => /^Upload 1 book$/.test(b.textContent.trim())), { timeout: 8000 }).catch(() => null);
    check('admin bulk upload: a row without photos keeps the current photos', Boolean(again) && /keep the photos they already have/.test(await page.$eval('body', (b) => b.innerText)));
    if (again) await again.click();
    await page.waitForFunction(() => /Uploaded 1 book/.test(document.body.innerText), { timeout: 8000 }).catch(() => null);
    const b2again = await one(`select price, image_urls from public.books where sku = 'E2E-ADMIN-SKU-2'`);
    check('admin bulk upload: and they are still there after the upload', Number(b2again?.price) === 89 && JSON.stringify(b2again?.image_urls) === JSON.stringify(b2?.image_urls));
    await db.query(`delete from public.books where product_code in ('E2E-ADMIN-1', 'E2E-ADMIN-2')`);
    for (const f of [csv, template, photoA, ...photoPaths]) fs.rmSync(f, { force: true });

    for (const [label, sel] of [['Process orders', '.ap-underline-tabs'], ['Track orders', '.ap-underline-tabs'], ['Non-delivery report (NDR)', 'main .panel'], ['Shipping', '#ship-warehouse_name']]) {
      await nav(label);
      check(`admin site: ${label} opens`, await waitSel(page, sel, 8000));
      await page.screenshot({ path: path.join(SHOTS, `admin-site-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}-1280.png`), fullPage: true });
    }

    // ---- Phone width: slide-out menu, no sideways scrolling ----
    await page.setViewport({ width: 375, height: 800 });
    await gotoA(page, '/admin');
    await waitSel(page, '.ap-stat-value', 8000);
    check('admin site at 375px: no sideways scrolling on Home', (await overflow(page)) <= 0, await overflow(page));
    await page.screenshot({ path: path.join(SHOTS, 'admin-site-dashboard-375.png'), fullPage: true });
    await page.click('.ap-top button[aria-label="Open menu"]');
    check('admin site at 375px: the menu slides out', await waitSel(page, '.ap-drawer .ap-nav-link', 3000));
    await page.screenshot({ path: path.join(SHOTS, 'admin-site-menu-375.png') });
    await page.$$eval('.ap-drawer .ap-nav-link', (as) => as.find((a) => a.textContent.trim() === 'Books')?.click());
    check('admin site at 375px: choosing a section closes the menu', (await onAdminPath(page, '/admin/books')) && (await gone(page, '.ap-drawer', 3000)));
    await waitSel(page, '.ap-book-row', 8000);
    check('admin site at 375px: no sideways scrolling on Books', (await overflow(page)) <= 0, await overflow(page));
    await page.screenshot({ path: path.join(SHOTS, 'admin-site-books-375.png'), fullPage: true });
    await gotoA(page, `/admin/books/${target.id}`);
    await waitSel(page, '#book-title', 8000);
    check('admin site at 375px: no sideways scrolling in the editor', (await overflow(page)) <= 0, await overflow(page));
    await page.screenshot({ path: path.join(SHOTS, 'admin-site-editor-375.png'), fullPage: true });
    await page.setViewport({ width: 1280, height: 900 });

    await page.$$eval('.ap-side .ap-nav-link', (bs) => bs.find((b) => /Sign out/.test(b.textContent))?.click());
    check('admin site: Sign out returns to the sign-in page', await onAdminPath(page, '/sign-in'));
    await gotoA(page, '/admin/books');
    check('admin site: after signing out the panel is closed again', (await onAdminPath(page, '/sign-in', 5000)) && (await page.$('.ap-book-row')) === null);
    check('admin site: the photo storage never refused the signed-in admin', photoLog.refused === 0);
    await page.setViewport({ width: 375, height: 800 });
    check('admin sign-in at 375px: no sideways scrolling', (await overflow(page)) <= 0);
    await page.screenshot({ path: path.join(SHOTS, 'admin-site-sign-in-375.png'), fullPage: true });
    check('admin site: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- The store has no admin panel any more ----------
  {
    const { page, ctx, errors } = await newPage();
    await goto(page, '/sign-in');
    await waitSel(page, '#email');
    await page.type('#email', 'admin@example.com');
    await page.type('#password', 'admin-pass-1');
    await page.click('button[type=submit]');
    await page.waitForFunction(() => location.pathname === '/', { timeout: 8000 }).catch(() => {});
    for (const p of ['/admin', '/admin/orders', '/admin/bulk-upload']) {
      await goto(page, p);
      check(`store: ${p} is not found, even for an admin`, await page.waitForFunction(() => /not found|doesn.t exist|404/i.test(document.querySelector('main')?.innerText ?? '') && !document.querySelector('.ap-nav'), { timeout: 8000 }).then(() => true).catch(() => false));
    }
    await goto(page, '/account');
    check('store: an admin gets a link to the admin site', await page.waitForFunction(() => [...document.querySelectorAll('main a')].some((a) => /Open admin panel/.test(a.textContent) && a.href === 'https://kitaabaurkona.vercel.app/'), { timeout: 8000 }).then(() => true).catch(() => false));
    check('store: no test-site bar', (await page.$('.test-site-bar')) === null);
    check('store without admin: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- Admin: shipping settings, booking a parcel, manifest; customer tracking ----------
  {
    const { page, ctx, errors } = await newPage();
    await adminSignIn(page);
    await gotoA(page, '/admin/shipping');
    check('admin shipping: settings load', await waitSel(page, '#ship-warehouse_name'));
    check('admin shipping: warns that nothing is booked without a warehouse name', /Nothing is booked with Xpressbees until its warehouse name/i.test(await page.$eval('main', (m) => m.innerText)));
    check('admin shipping: a carrier for new orders can be chosen (Xpressbees by default)', (await page.$eval('#ship-default_carrier', (s) => s.value).catch(() => '')) === 'xpressbees');
    check('admin shipping: no Delhivery pickup form before its warehouse is set', (await page.$('#dl-pickup-date')) === null);
    await page.type('#ship-warehouse_name', 'Kitaabaurkona Udaipur');
    await page.$$eval('main button[type=submit]', (bs) => bs.find((b) => /Save settings/.test(b.textContent))?.click());
    const savedWarehouse = await page
      .waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Shipping settings saved'), { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    check('admin shipping: settings save', savedWarehouse && (await one(`select warehouse_name from public.shipping_settings`)).warehouse_name === 'Kitaabaurkona Udaipur');
    await gotoA(page, '/admin/orders/failed-deliveries');
    check('admin failed deliveries: the list loads from the courier', await page.waitForFunction(() => /No failed delivery attempts/i.test(document.body.innerText), { timeout: 6000 }).then(() => true).catch(() => false));
    await gotoA(page, '/admin/shipping');
    await waitSel(page, '#ship-warehouse_name');
    await page.screenshot({ path: path.join(SHOTS, 'admin-shipping-light-1280.png'), fullPage: true });

    const xbOrder = (await one(`select id from public.orders where payment_method = 'cod' and status in ('confirmed', 'paid') order by created_at desc limit 1`)).id;
    // Process orders lists single-book orders unless Clubbed is chosen (as on ShopDeck).
    const itemsOf = async (id) => ((await one(`select item_count from public.orders where id = $1`, [id])).item_count > 1 ? '&items=clubbed' : '');
    const xbItems = await itemsOf(xbOrder);
    await gotoA(page, `/admin/orders?pay=cod${xbItems}`);
    check('admin orders: summary numbers show orders to ship', await page.waitForFunction(() => [...document.querySelectorAll('.ap-stat')].some((c) => /Total non-dispatched orders/.test(c.textContent) && /[1-9]/.test(c.querySelector('.ap-stat-value')?.textContent ?? '')), { timeout: 6000 }).then(() => true).catch(() => false));
    check('admin orders: the order is listed as on time with a ship-by date', await page.waitForFunction(() => /On time/i.test(document.querySelector('.ap-orders-table')?.innerText ?? ''), { timeout: 6000 }).then(() => true).catch(() => false));
    await page.type('#orders-q', '0000000');
    check('admin orders: a search with no match says so', await page.waitForFunction(() => /No orders match these filters/.test(document.body.innerText), { timeout: 6000 }).then(() => true).catch(() => false));
    await page.select('#orders-by', 'phone');
    await page.$eval('#orders-q', (i) => { i.select(); });
    await page.keyboard.press('Backspace');
    await page.type('#orders-q', '9876543210');
    check('admin orders: search by phone finds the order', await page.waitForFunction(() => document.querySelectorAll('.ap-orders-table tbody tr').length >= 1 && /phone/.test(location.search), { timeout: 6000 }).then(() => true).catch(() => false));
    await page.click('.ap-order-link');
    check('admin orders: the order opens in a side panel', await waitSel(page, '.ap-sheet', 4000));
    await page.waitForFunction(() => /Parcel: Queued/i.test(document.querySelector('.ap-sheet')?.innerText ?? ''), { timeout: 6000 }).catch(() => {});
    await page.screenshot({ path: path.join(SHOTS, 'admin-orders-sheet-1280.png') });
    check('admin orders: the customer is marked as a repeat customer', /Repeat · \d/.test(await page.$eval('.ap-orders-table', (t) => t.innerText).catch(() => '')));
    await page.$$eval('.ap-sheet button', (bs) => bs.find((b) => /Edit address/.test(b.textContent))?.click());
    check('admin orders: the address can be edited before booking', await waitSel(page, '.ap-sheet input[id^="addr-city-"]', 3000));
    await page.$eval('.ap-sheet input[id^="addr-address-"]', (i) => i.select());
    await page.keyboard.press('Backspace');
    await page.type('.ap-sheet input[id^="addr-address-"]', '14 Lake Palace Road');
    await page.$$eval('.ap-sheet button', (bs) => bs.find((b) => /Save address/.test(b.textContent))?.click());
    check(
      'admin orders: the new address is saved on the order',
      (await page.waitForFunction(() => /14 Lake Palace Road/.test(document.querySelector('.ap-sheet address')?.textContent ?? ''), { timeout: 6000 }).then(() => true).catch(() => false)) &&
        (await one(`select shipping_address from public.orders where id = $1`, [xbOrder])).shipping_address === '14 Lake Palace Road',
    );
    await page.type('.ap-sheet textarea', 'Call before delivery');
    await page.$$eval('.ap-sheet button', (bs) => bs.find((b) => /Save note/.test(b.textContent))?.click());
    check(
      'admin orders: a note is saved on the order',
      (await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('Note saved')), { timeout: 6000 }).then(() => true).catch(() => false)) &&
        (await one(`select note from public.order_fulfilment where order_id = $1`, [xbOrder]))?.note === 'Call before delivery',
    );
    const readerNotes = await asRole(db, { role: 'authenticated', sub: USERS['reader@example.com'].id }, (tx) => tx.query(`select count(*)::int as n from public.order_fulfilment`));
    check('admin orders: customers cannot read the admin notes', readerNotes.rows[0].n === 0);
    check('admin orders: the COD order shows its queued parcel', await page.waitForFunction(() => /Parcel: Queued/i.test(document.body.innerText), { timeout: 6000 }).then(() => true).catch(() => false));
    await page.$$eval('.parcel-admin button', (bs) => bs.find((b) => /Change courier/.test(b.textContent))?.click());
    check('admin orders: courier prices load for the parcel', await waitSel(page, '.parcel-admin select', 6000));
    await page.$$eval('.parcel-admin button', (bs) => bs.find((b) => /Book now/.test(b.textContent))?.click());
    check('admin orders: Book now books it with an AWB', await page.waitForFunction(() => /Pickup scheduled/i.test(document.body.innerText) && /AWB \d+/.test(document.body.innerText), { timeout: 8000 }).then(() => true).catch(() => false));
    check('admin orders: the label link points to the courier file host', /^https:\/\/xb-files\.s3\.amazonaws\.com\//.test(await page.$eval('.parcel-admin a[href*="labels"]', (a) => a.href).catch(() => '')));
    check('admin orders: the address is locked once the parcel is booked', (await one(`select count(*)::int as n from public.shipments where order_id = $1 and status = 'booked'`, [xbOrder])).n === 1 && !(await page.$$eval('.ap-sheet button', (bs) => bs.some((b) => /Edit address/.test(b.textContent)))));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.ap-sheet'), { timeout: 3000 }).catch(() => {});
    check('admin orders: the row offers our own label once booked', await page.waitForFunction(() => [...document.querySelectorAll('.ap-orders-table tbody button')].some((b) => b.textContent.trim() === 'Label'), { timeout: 6000 }).then(() => true).catch(() => false));
    check('admin orders: the note shows on the row', /Call before delivery/.test(await page.$eval('.ap-orders-table', (t) => t.innerText).catch(() => '')));

    // Documents (downloaded PDFs), then Print -> Pack -> Handover
    const DL = path.join(SHOTS, 'downloads');
    fs.rmSync(DL, { recursive: true, force: true });
    fs.mkdirSync(DL, { recursive: true });
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, browserContextId: ctx.id, eventsEnabled: true });
    const waitPdf = async (prefix) => {
      for (let i = 0; i < 60; i += 1) {
        const name = fs.readdirSync(DL).find((n) => n.startsWith(prefix) && n.endsWith('.pdf'));
        if (name) {
          const bytes = fs.readFileSync(path.join(DL, name));
          if (bytes.length > 1000 && bytes.subarray(0, 4).toString() === '%PDF') return name;
        }
        await sleep(250);
      }
      return null;
    };
    const printSelected = async (kind) => {
      await waitSel(page, 'tbody .pick input[type=checkbox]', 6000);
      if (!(await page.$eval('tbody .pick input[type=checkbox]', (i) => i.checked))) await page.click('tbody .pick input[type=checkbox]');
      await page.$$eval('.ap-bulkbar button', (bs) => bs.find((b) => /^Print/.test(b.textContent.trim()))?.click());
      await page.$$eval('.ap-menu-list button', (bs, k) => bs.find((b) => b.textContent.trim() === k)?.click(), kind);
    };
    check('admin orders: a booked order can be selected at Print', await waitSel(page, 'tbody .pick input[type=checkbox]', 3000));
    await printSelected('Invoices');
    check('admin orders: invoices need the seller details first', await page.waitForFunction(() => /Fill in the invoice details first/.test(document.querySelector('.ap-card-notice')?.textContent ?? ''), { timeout: 6000 }).then(() => true).catch(() => false));
    await db.query(`update public.shipping_settings set invoice_business_name = 'KITAABAURKONA', invoice_address = '59, Test Road, Udaipur', invoice_phone = '9000000001', invoice_gstin = '08ABCDE1234F1Z5', invoice_pan = 'ABCDE1234F', invoice_state = 'Rajasthan'`);
    await printSelected('Invoices');
    const invoicePdf = await waitPdf('invoice-KAK-');
    const invoiceRow = await one(`select invoice_number from public.order_invoices where order_id = $1`, [xbOrder]);
    check('admin orders: an invoice PDF downloads with a KAK/yy-yy/00001 number', Boolean(invoicePdf) && /^KAK\/\d{2}-\d{2}\/\d{5}$/.test(invoiceRow?.invoice_number ?? ''), `${invoicePdf} ${invoiceRow?.invoice_number} files=${fs.readdirSync(DL).join(',')} notice=${await page.$eval('.ap-card-notice', (n) => n.textContent).catch(() => '-')} toasts=${await page.$$eval('.toast', (ts) => ts.map((t) => t.textContent).join(' | '))}`);
    await printSelected('Picking list');
    check('admin orders: a picking list PDF downloads', Boolean(await waitPdf('picking-list-')));
    await printSelected('Packing slips');
    check('admin orders: packing slips download', Boolean(await waitPdf('packing-slips-')));
    await printSelected('Labels');
    const labelPdf = await waitPdf('label-KB-');
    check(
      'admin orders: printing the label downloads it and moves the order to Pack',
      Boolean(labelPdf) &&
        (await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /1 label downloaded/.test(t.textContent)), { timeout: 6000 }).then(() => true).catch(() => false)) &&
        (await (async () => {
          for (let i = 0; i < 20; i += 1) {
            if ((await one(`select label_printed_at from public.order_fulfilment where order_id = $1`, [xbOrder]))?.label_printed_at != null) return true;
            await sleep(200);
          }
          return false;
        })()),
      labelPdf,
    );
    {
      const bytes = new Uint8Array(fs.readFileSync(path.join(DL, labelPdf)));
      const doc = await PDFDocument.load(bytes);
      const { width, height } = doc.getPage(0).getSize();
      const words = (await pdfTexts(bytes)).join(' ');
      check('admin orders: the label is a 4 x 6 inch page', doc.getPageCount() === 1 && Math.round(width) === 288 && Math.round(height) === 432, `${width} x ${height}`);
      check('admin orders: the label carries the courier, its routing code, the AWB and both addresses', /XPRESSBEES/.test(words) && words.includes('ROUTING CODE: E/S-90/1C/028') && /SHIP DATE/.test(words) && /FROM:/.test(words) && /PIN \d{6}/.test(words) && /(COD|PREPAID)/.test(words), words.slice(0, 400));
      fs.copyFileSync(path.join(DL, labelPdf), path.join(SHOTS, 'label-4x6.pdf'));
    }
    check('admin orders: the label keeps the same invoice number', (await one(`select count(*)::int as n from public.order_invoices where order_id = $1`, [xbOrder])).n === 1);
    await gotoA(page, `/admin/orders?stage=pack${xbItems}`);
    check('admin orders: the Pack step lists the order and counts it', await page.waitForFunction(() => /1\s*In Pack/.test(document.querySelector('.ap-sum-stages')?.innerText ?? '') && document.querySelector('.ap-segment-stage button[aria-pressed="true"]')?.textContent === 'Pack' && document.querySelectorAll('.ap-orders-table tbody tr').length === 1, { timeout: 6000 }).then(() => true).catch(() => false));
    await page.$$eval('.ap-orders-table button', (bs) => bs.find((b) => b.textContent.trim() === 'Handover')?.click());
    check(
      'admin orders: the row Handover button moves the packed order to Handover',
      (await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Packed: KB-/.test(t.textContent)), { timeout: 6000 }).then(() => true).catch(() => false)) &&
        (await one(`select packed_at from public.order_fulfilment where order_id = $1`, [xbOrder]))?.packed_at != null,
    );
    await gotoA(page, `/admin/orders?stage=handover${xbItems}`);
    await waitSel(page, 'tbody .pick input[type=checkbox]', 6000);
    await page.click('tbody .pick input[type=checkbox]');
    const manifestTab = new Promise((resolve) => ctx.once('targetcreated', (t) => resolve(t)));
    await page.$$eval('.ap-bulkbar button', (bs) => bs.find((b) => /Print & lock manifest for 1 parcel/.test(b.textContent))?.click());
    const mTarget = await Promise.race([manifestTab, sleep(5000).then(() => null)]);
    const mOpened = Boolean(mTarget);
    const mPage = mTarget ? await mTarget.page() : null;
    if (mPage) await mPage.waitForFunction(() => location.href !== 'about:blank', { timeout: 8000 }).catch(() => {});
    if (mPage) await mPage.close().catch(() => {});
    await page.bringToFront();
    check(
      'admin orders: Print & lock manifest makes the Xpressbees manifest and marks the order handed over',
      mOpened &&
        (await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /1 order handed over/.test(t.textContent)), { timeout: 8000 }).then(() => true).catch(() => false)) &&
        (await one(`select handed_over_at from public.order_fulfilment where order_id = $1`, [xbOrder]))?.handed_over_at != null,
      JSON.stringify({ tab: mOpened, toasts: await page.$$eval('.toast, .notice', (ts) => ts.map((t) => t.textContent)).catch(() => []), row: await one(`select f.*, o.status from public.orders o left join public.order_fulfilment f on f.order_id = o.id where o.id = $1`, [xbOrder]) }),
    );
    const xbNumber = (await one(`select order_number from public.orders where id = $1`, [xbOrder])).order_number;
    await gotoA(page, `/admin/orders?stage=handover${xbItems}`);
    check('admin orders: a handed-over order leaves Process orders', await page.waitForFunction((n) => (document.querySelector('.state') || document.querySelector('.ap-orders-table')) && !document.querySelector('.skeleton') && ![...document.querySelectorAll('.ap-order-link')].some((a) => a.textContent.replace(/\D/g, '').replace(/^0+/, '') === n), { timeout: 6000 }, String(xbNumber)).then(() => true).catch(() => false));
    await gotoA(page, `/admin/orders/track?q=${xbNumber}`);
    check('admin orders: handed-over parcels can still go on a manifest from Track orders', await waitSel(page, 'tbody .pick input[type=checkbox]', 6000));
    await page.click('tbody .pick input[type=checkbox]');
    check('admin orders: manifest button appears', /Xpressbees manifest for 1 order/i.test(await page.$eval('main', (m) => m.innerText)));
    await gotoA(page, '/admin/orders?dup=yes');
    check('admin orders: the possible-duplicates filter loads', await page.waitForFunction(() => document.querySelector('.ap-orders-table, .state') && !document.querySelector('.skeleton'), { timeout: 6000 }).then(() => true).catch(() => false));
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

  // ---------- Admin: a second order shipped with Delhivery instead ----------
  {
    const book = await one(`select id from public.books where is_visible and stock_quantity >= 2 order by id limit 1`);
    await db.query(`update public.shipping_settings set auto_book = false`);
    const placed = await asRole(db, { role: 'authenticated', sub: USERS['reader@example.com'].id }, (tx) =>
      tx.query(`select public.create_order($1::jsonb, $2::jsonb, 'cod') as id`, [
        JSON.stringify([{ book_id: book.id, quantity: 1 }]),
        JSON.stringify({ name: 'Asha Rao', phone: '9876543210', address: '12 MG Road', city: 'Udaipur', state: 'Rajasthan', pincode: '313001' }),
      ]),
    );
    const dlOrder = placed.rows[0].id;

    const { page, ctx, errors } = await newPage();
    await adminSignIn(page);
    await gotoA(page, '/admin/shipping');
    await waitSel(page, '#ship-delhivery_warehouse_name');
    await page.type('#ship-delhivery_warehouse_name', 'Kitaabaurkona DL');
    await page.$$eval('main button[type=submit]', (bs) => bs.find((b) => /Save settings/.test(b.textContent))?.click());
    await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Shipping settings saved'), { timeout: 5000 }).catch(() => {});
    check('admin shipping: the Delhivery warehouse name saves', (await one(`select delhivery_warehouse_name from public.shipping_settings`)).delhivery_warehouse_name === 'Kitaabaurkona DL');
    check('admin shipping: the contact email is filled in from the settings', (await page.$eval('#ship-pickup_email', (i) => i.value).catch(() => '')) === 'kitaabaurkona@gmail.com');
    check('admin shipping: the invoice details show what was saved', (await page.$eval('#inv-invoice_gstin', (i) => i.value).catch(() => '')) === '08ABCDE1234F1Z5');
    await page.$eval('#inv-invoice_gstin', (i) => i.select());
    await page.keyboard.press('Backspace');
    await page.type('#inv-invoice_gstin', '08abcde1234f1z9');
    await page.$$eval('main button[type=submit]', (bs) => bs.find((b) => /Save invoice details/.test(b.textContent))?.click());
    check(
      'admin shipping: invoice details save (GSTIN in capitals)',
      (await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Invoice details saved/.test(t.textContent)), { timeout: 6000 }).then(() => true).catch(() => false)) &&
        (await one(`select invoice_gstin from public.shipping_settings`)).invoice_gstin === '08ABCDE1234F1Z9',
    );
    await page.$$eval('.toast button', (bs) => bs.forEach((b) => b.click()));
    await page.$$eval('main button', (bs) => bs.find((b) => /Register pickup address with Delhivery/.test(b.textContent))?.click());
    check(
      'admin shipping: the pickup address is registered with Delhivery from the page',
      await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Pickup address registered with Delhivery as "Kitaabaurkona DL"/.test(t.textContent)), { timeout: 6000 }).then(() => true).catch(() => false) &&
        DL_CALLS.includes('/api/backend/clientwarehouse/create/'),
    );
    check('admin shipping: buttons are not left busy after registering', await page.$$eval('main button[aria-busy="true"]', (bs) => bs.length === 0));

    await gotoA(page, '/admin/orders?pay=cod');
    await waitSel(page, '.ap-order-link', 6000);
    await page.click('.ap-order-link');
    check('admin orders: a new order waits with Xpressbees selected', await page.waitForFunction(() => [...document.querySelectorAll('.parcel-admin button')].some((b) => /Ship with Delhivery instead/.test(b.textContent)), { timeout: 6000 }).then(() => true).catch(() => false));
    await page.$$eval('.parcel-admin button', (bs) => bs.find((b) => /Ship with Delhivery instead/.test(b.textContent))?.click());
    check('admin orders: the admin moves it to Delhivery', await page.waitForFunction(() => [...document.querySelectorAll('.parcel-admin button')].some((b) => /Book now with Delhivery/.test(b.textContent)), { timeout: 6000 }).then(() => true).catch(() => false));
    check('admin orders: the parcel is a Delhivery parcel now', (await one(`select carrier from public.shipments where order_id = $1 and kind = 'forward'`, [dlOrder])).carrier === 'delhivery');
    await page.$$eval('.parcel-admin button', (bs) => bs.find((b) => /Change courier/.test(b.textContent))?.click());
    check('admin orders: Delhivery Surface and Express with prices', await page.waitForFunction(() => [...document.querySelectorAll('.parcel-admin select option')].map((o) => o.textContent).join('|').includes('Delhivery Surface'), { timeout: 6000 }).then(() => true).catch(() => false));
    await page.$$eval('.parcel-admin button', (bs) => bs.find((b) => /Book now with Delhivery/.test(b.textContent))?.click());
    check('admin orders: Book now books it with Delhivery', await page.waitForFunction(() => /Delhivery Surface · AWB 50213/.test(document.body.innerText), { timeout: 8000 }).then(() => true).catch(() => false));
    check('admin orders: the booked Delhivery parcel can be selected at Print', (await page.$$('tbody .pick input[type=checkbox]')).length >= 1);
    const opened = new Promise((resolve) => ctx.once('targetcreated', (t) => resolve(t)));
    await page.$$eval('.parcel-admin button', (bs) => bs.find((b) => /Open shipping label/.test(b.textContent))?.click());
    const target = await Promise.race([opened, sleep(5000).then(() => null)]);
    const labelPage = target ? await target.page() : null;
    if (labelPage) await labelPage.waitForFunction(() => location.href !== 'about:blank', { timeout: 5000 }).catch(() => {});
    check('admin orders: Open shipping label opens the Delhivery label', Boolean(labelPage) && /s3-ap-southeast-1\.amazonaws\.com\/pdfs\/e2e-label\.pdf/.test(labelPage.url()), labelPage?.url());
    if (labelPage) await labelPage.close();
    await page.keyboard.press('Escape');
    await page.screenshot({ path: path.join(SHOTS, 'admin-orders-delhivery-light-1280.png'), fullPage: true });
    await gotoA(page, '/admin/orders/track?tab=shipped');
    check('admin track orders: the shipped Xpressbees order is listed', await page.waitForFunction(() => document.querySelectorAll('.ap-orders-table tbody tr').length >= 1 && /Shipped/.test(document.querySelector('.ap-orders-table')?.innerText ?? ''), { timeout: 6000 }).then(() => true).catch(() => false));
    await db.query(`insert into public.order_fulfilment (order_id, label_printed_at, packed_at) values ($1, now(), null) on conflict (order_id) do update set label_printed_at = now(), packed_at = null, handed_over_at = null`, [dlOrder]);
    await gotoA(page, '/admin/orders?stage=pack');
    await waitSel(page, '.ap-stage-bar .btn', 6000);
    await page.$$eval('.ap-stage-bar .btn', (bs) => bs.find((b) => /Move All to Handover/.test(b.textContent))?.click());
    check('admin orders: Move all to Handover moves every packed order', (await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /moved to Handover/.test(t.textContent)), { timeout: 6000 }).then(() => true).catch(() => false)) && (await one(`select packed_at from public.order_fulfilment where order_id = $1`, [dlOrder]))?.packed_at != null);
    await gotoA(page, '/admin/orders?stage=handover&carrier=delhivery');
    await waitSel(page, 'tbody .pick input[type=checkbox]', 6000);
    await page.click('tbody .pick input[type=checkbox]');
    await page.$$eval('.ap-bulkbar button', (bs) => bs.find((b) => /Print & lock manifest for 1 parcel/.test(b.textContent))?.click());
    check('admin orders: handing over a Delhivery parcel opens its pickup form', (await waitSel(page, '.ap-pickup #dl-pickup-date', 6000)) && (await one(`select handed_over_at from public.order_fulfilment where order_id = $1`, [dlOrder]))?.handed_over_at != null);
    await page.screenshot({ path: path.join(SHOTS, 'admin-orders-handover-1280.png'), fullPage: true });
    await gotoA(page, '/admin/orders/track?carrier=delhivery');
    check('admin orders: the shipping partner filter shows only the Delhivery order', await page.waitForFunction(() => { const rows = document.querySelectorAll('.ap-orders-table tbody tr'); return rows.length === 1 && /Delhivery/.test(rows[0].innerText); }, { timeout: 6000 }).then(() => true).catch(() => false), await page.$eval('main', (m) => m.innerText.replace(/\s+/g, ' ').slice(-280)).catch((e) => e.message));

    // Failed AWB orders: a booking that failed is booked again with Regenerate.
    {
      const spare = await one(`select id from public.books where is_visible and stock_quantity >= 1 order by stock_quantity desc limit 1`);
      const failedOrder = (
        await asRole(db, { role: 'authenticated', sub: USERS['reader@example.com'].id }, (tx) =>
          tx.query(`select public.create_order($1::jsonb, $2::jsonb, 'cod') as id`, [
            JSON.stringify([{ book_id: spare.id, quantity: 1 }]),
            JSON.stringify({ name: 'Asha Rao', phone: '9876543210', address: '12 MG Road', city: 'Udaipur', state: 'Rajasthan', pincode: '313001' }),
          ]),
        )
      ).rows[0].id;
      await db.query(`update public.shipments set status = 'failed', last_error = 'Test: courier refused', carrier = 'xpressbees' where order_id = $1 and kind = 'forward'`, [failedOrder]);
      const failedNumber = (await one(`select order_number from public.orders where id = $1`, [failedOrder])).order_number;
      // Clicks a button in the failed order's row (found by its order number).
      const inRow = (label) =>
        page.evaluate(
          (n, text) => {
            const row = [...document.querySelectorAll('.ap-orders-table tbody tr')].find((r) => [...r.querySelectorAll('.ap-order-link')].some((a) => a.textContent.replace(/\D/g, '').replace(/^0+/, '') === n));
            const button = [...(row?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === text);
            button?.click();
            return Boolean(button);
          },
          String(failedNumber),
          label,
        );
      await gotoA(page, '/admin/orders?tab=awb_failed');
      check(
        'admin orders: the Failed AWB tab lists the failed booking with its count',
        await page
          .waitForFunction((n) => [...document.querySelectorAll('.ap-orders-table .ap-order-link')].some((a) => a.textContent.replace(/\D/g, '').replace(/^0+/, '') === n) && /Failed AWB orders \([1-9]/.test(document.querySelector('.ap-underline-tabs')?.innerText ?? ''), { timeout: 6000 }, String(failedNumber))
          .then(() => true)
          .catch(() => false),
      );
      await page.screenshot({ path: path.join(SHOTS, 'admin-orders-failed-awb-1280.png'), fullPage: true });
      await inRow('Notes');
      check('admin orders: Notes opens a pop-up', await waitSel(page, '.ap-dialog textarea', 4000));
      await page.type('.ap-dialog textarea', 'Courier refused once');
      await page.$$eval('.ap-dialog button', (bs) => bs.find((b) => /Save note/.test(b.textContent))?.click());
      check(
        'admin orders: the pop-up saves the note and closes',
        (await page.waitForFunction(() => !document.querySelector('.ap-dialog'), { timeout: 6000 }).then(() => true).catch(() => false)) &&
          (await one(`select note from public.order_fulfilment where order_id = $1`, [failedOrder]))?.note === 'Courier refused once',
      );
      await inRow('Regenerate');
      check(
        'admin orders: Regenerate books the failed parcel again',
        (await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /1 parcel booked again/.test(t.textContent)), { timeout: 8000 }).then(() => true).catch(() => false)) &&
          (await one(`select status from public.shipments where order_id = $1 and kind = 'forward' and status <> 'cancelled'`, [failedOrder]))?.status === 'booked',
      );
      await gotoA(page, `/admin/orders?group=sku&q=${failedNumber}`);
      check('admin orders: Group By SKU ID shows the orders under their SKU', await page.waitForFunction(() => /SKU ID:/.test(document.querySelector('.ap-group-row')?.innerText ?? ''), { timeout: 6000 }).then(() => true).catch(() => false));
      // Call status: the Edit link under the customer opens ShopDeck's pop-up.
      await inRow('Edit');
      check('admin orders: Edit under the customer opens the call status pop-up', await waitSel(page, '.ap-dialog #call-status', 4000));
      await page.select('.ap-dialog #call-status', 'completed');
      await page.type('.ap-dialog #call-remarks', 'Asked to deliver after 5 pm');
      await page.$$eval('.ap-dialog button', (bs) => bs.find((b) => b.textContent.trim() === 'Save')?.click());
      check(
        'admin orders: the call status and remarks are saved and shown on the row',
        (await page.waitForFunction(() => /Call Status: Completed/.test(document.querySelector('.ap-orders-table')?.innerText ?? ''), { timeout: 6000 }).then(() => true).catch(() => false)) &&
          JSON.stringify(await one(`select call_status, call_remarks from public.order_fulfilment where order_id = $1`, [failedOrder])) === JSON.stringify({ call_status: 'completed', call_remarks: 'Asked to deliver after 5 pm' }),
      );
      await gotoA(page, `/admin/orders?call=completed&q=${failedNumber}`);
      check('admin orders: the Call Status filter finds it', await page.waitForFunction(() => document.querySelectorAll('.ap-orders-table tbody tr').length === 1, { timeout: 6000 }).then(() => true).catch(() => false));

      // Hover text, as on ShopDeck.
      await page.hover('.ap-orders-table .ap-kv .ap-hint');
      check('admin orders: hovering FSP explains it', await page.waitForFunction(() => document.querySelector('.ap-tooltip')?.textContent === 'Final Selling Price', { timeout: 3000 }).then(() => true).catch(() => false));
      await page.hover('.ap-summary .ap-stat-flip');
      check('admin orders: hovering a summary card says what it counts', await page.waitForFunction(() => getComputedStyle(document.querySelector('.ap-summary .ap-stat-about')).visibility === 'visible', { timeout: 3000 }).then(() => true).catch(() => false));
      await page.mouse.move(5, 5);

      await inRow('Cancel');
      check('admin orders: Cancel warns first', await page.waitForFunction(() => /You are about to cancel this order/.test(document.querySelector('.ap-dialog')?.innerText ?? ''), { timeout: 4000 }).then(() => true).catch(() => false));
      await page.$$eval('.ap-dialog button', (bs) => bs.find((b) => b.textContent.trim() === 'Cancel Order')?.click());
      check(
        'admin orders: then asks for the reason, with ShopDeck’s 11 reasons',
        await page.waitForFunction(() => /Select reason for cancellation/.test(document.querySelector('.ap-dialog')?.innerText ?? '') && document.querySelectorAll('.ap-dialog .ap-reason').length === 11, { timeout: 4000 }).then(() => true).catch(() => false),
      );
      await page.$$eval('.ap-dialog button', (bs) => bs.find((b) => b.textContent.trim() === 'Submit')?.click());
      check('admin orders: a reason is required', /Choose the reason/.test(await page.$eval('.ap-dialog', (d) => d.innerText).catch(() => '')) && (await one(`select status from public.orders where id = $1`, [failedOrder])).status !== 'cancelled');
      await page.$$eval('.ap-dialog .ap-reason', (bs) => bs.find((b) => b.textContent.trim() === 'Customer cancelled the order')?.click());
      await waitSel(page, '.ap-dialog #cancel-customer-reason', 3000);
      await page.select('.ap-dialog #cancel-customer-reason', 'Ordered by Mistake');
      await page.type('.ap-dialog #cancel-remarks', 'Called the customer');
      await page.screenshot({ path: path.join(SHOTS, 'admin-orders-cancel-reason-1280.png') });
      await page.$$eval('.ap-dialog button', (bs) => bs.find((b) => b.textContent.trim() === 'Submit')?.click());
      check(
        'admin orders: the row Cancel cancels the order with its reasons',
        (await page.waitForFunction(() => !document.querySelector('.ap-dialog'), { timeout: 6000 }).then(() => true).catch(() => false)) &&
          (await one(`select status from public.orders where id = $1`, [failedOrder])).status === 'cancelled' &&
          JSON.stringify(await one(`select cancel_reason, cancel_customer_reason, cancel_remarks from public.order_fulfilment where order_id = $1`, [failedOrder])) ===
            JSON.stringify({ cancel_reason: 'Customer cancelled the order', cancel_customer_reason: 'Ordered by Mistake', cancel_remarks: 'Called the customer' }),
      );
      const readerReasons = await asRole(db, { role: 'authenticated', sub: USERS['reader@example.com'].id }, (tx) => tx.query(`select count(*)::int as n from public.order_fulfilment where cancel_reason is not null`));
      check('admin orders: customers cannot read the cancel reasons', readerReasons.rows[0].n === 0);
      const cancelRow = await one(`select cancelled_at, cancelled_by, cancelled_from from public.orders where id = $1`, [failedOrder]);
      check(
        'admin orders: the cancellation records when, by the seller, from the Print step',
        cancelRow.cancelled_at != null && cancelRow.cancelled_by === 'seller' && cancelRow.cancelled_from === 'print',
        JSON.stringify(cancelRow),
      );
      await gotoA(page, `/admin/orders?tab=cancelled&q=${failedNumber}`);
      check(
        'admin orders: the Cancelled tab shows who cancelled, from which step, and the refund',
        await page
          .waitForFunction(() => {
            const row = document.querySelector('.ap-cancelled-table tbody tr')?.innerText ?? '';
            return /By seller/.test(row) && /Reason:\s*Customer cancelled the order/.test(row) && /Customer reason:\s*Ordered by Mistake/.test(row) && /Earlier state:\s*Print/.test(row) && /Not applicable/i.test(row);
          }, { timeout: 6000 })
          .then(() => true)
          .catch(() => false),
        await page.$eval('main', (m) => m.innerText.replace(/\s+/g, ' ').slice(-400)).catch((e) => e.message),
      );
      await page.screenshot({ path: path.join(SHOTS, 'admin-orders-cancelled-1280.png'), fullPage: true });
      await page.$$eval('.ap-tip button', (bs) => bs.find((b) => b.textContent.trim() === 'Download')?.click());
      check('admin orders: Download makes a spreadsheet of the cancelled orders', await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /1 cancelled order downloaded/.test(t.textContent)), { timeout: 6000 }).then(() => true).catch(() => false));
    }

    // Place order: an order taken by phone, entered in the admin panel's five steps.
    {
      const pick = await one(`select id, sku, price, stock_quantity from public.books where stock_quantity >= 2 and price > 10 order by stock_quantity desc limit 1`);
      const sellAt = Math.floor(Number(pick.price)) - 5;
      const clickText = (selector, text) => page.$$eval(selector, (bs, t) => bs.find((b) => b.textContent.trim() === t)?.click(), text);
      await gotoA(page, '/admin/orders/new');
      check('place order: the first step asks for the customer', await waitSel(page, '#po-phone', 8000));
      await clickText('.ap-po-actions button', 'Next');
      check('place order: missing customer details are pointed out', await page.waitForFunction(() => document.querySelectorAll('.ap-field-error').length >= 5, { timeout: 4000 }).then(() => true).catch(() => false));
      await page.type('#po-phone', '9123456780');
      await page.type('#po-name', 'Phone Order Test');
      await clickText('#po-payment button', 'COD');
      await page.type('#po-pincode', '313001');
      await page.type('#po-city', 'Udaipur');
      await page.select('#po-state', 'Rajasthan');
      await page.type('#po-house', '5');
      await page.type('#po-street', 'Lake Road');
      await page.waitForFunction(() => /Delivery available/.test(document.querySelector('.ap-pin')?.textContent ?? ''), { timeout: 6000 }).catch(() => {});
      await page.screenshot({ path: path.join(SHOTS, 'admin-place-order-1-1280.png'), fullPage: true });
      await clickText('.ap-po-actions button', 'Next');
      check('place order: step 2 searches the books', await waitSel(page, '#po-book-search', 4000));
      await page.type('#po-book-search', pick.sku);
      await page.waitForFunction(() => [...document.querySelectorAll('.ap-po-results button')].some((b) => b.textContent.trim() === 'Add'), { timeout: 6000 }).catch(() => {});
      await clickText('.ap-po-results button', 'Add');
      await waitSel(page, `#po-price-${pick.id}`, 4000);
      await page.$eval(`#po-price-${pick.id}`, (i) => i.select());
      await page.keyboard.press('Backspace');
      await page.type(`#po-price-${pick.id}`, String(sellAt));
      await page.screenshot({ path: path.join(SHOTS, 'admin-place-order-2-1280.png'), fullPage: true });
      await clickText('.ap-po-actions button', 'Next');
      check('place order: step 3 offers both couriers', await page.waitForFunction(() => document.querySelectorAll('.ap-po-courier input[type=radio]').length === 2, { timeout: 4000 }).then(() => true).catch(() => false));
      await page.click('.ap-po-courier input[value="xpressbees"]');
      await clickText('.ap-po-actions button', 'Next');
      check('place order: the review shows the cash to collect', await page.waitForFunction((n) => new RegExp(`Cash to collect ₹${n}`).test(document.querySelector('main')?.innerText ?? ''), { timeout: 4000 }, String(sellAt)).then(() => true).catch(() => false));
      await clickText('.ap-po-actions button', 'Place order');
      check('place order: the order is placed and its number shown', await page.waitForFunction(() => /Order KB-\d+ placed/.test(document.querySelector('.ap-po-done')?.innerText ?? ''), { timeout: 8000 }).then(() => true).catch(() => false));
      await page.screenshot({ path: path.join(SHOTS, 'admin-place-order-5-1280.png'), fullPage: true });
      const placedRow = await one(`select o.*, (select unit_price from public.order_items i where i.order_id = o.id) as unit_price, (select carrier from public.shipments s where s.order_id = o.id and s.kind = 'forward') as carrier from public.orders o where o.origin = 'admin' order by o.created_at desc limit 1`);
      check(
        'place order: saved as a confirmed COD order from the admin panel, at the chosen price, with no customer account',
        placedRow && placedRow.status === 'confirmed' && placedRow.payment_method === 'cod' && placedRow.user_id === null && Number(placedRow.unit_price) === sellAt && placedRow.shipping_address === '5, Lake Road' && placedRow.carrier === 'xpressbees',
        JSON.stringify(placedRow && { status: placedRow.status, user: placedRow.user_id, price: placedRow.unit_price, address: placedRow.shipping_address, carrier: placedRow.carrier }),
      );
      check('place order: the book leaves stock', (await one(`select stock_quantity from public.books where id = $1`, [pick.id])).stock_quantity === pick.stock_quantity - 1);
      const sneaky = await asRole(db, { role: 'authenticated', sub: USERS['reader@example.com'].id }, (tx) =>
        tx.query(`select public.admin_place_order($1::jsonb, $2::jsonb, 'cod')`, [JSON.stringify([{ book_id: pick.id, quantity: 1 }]), JSON.stringify({ name: 'X Y', phone: '9123456780', address: '5, Lake Road', city: 'Udaipur', state: 'Rajasthan', pincode: '313001' })]).then(() => 'placed', (e) => e.code),
      );
      check('place order: customers cannot place orders this way', sneaky === '42501', sneaky);
      await clickText('.ap-po-done a', 'Open in Process orders');
      check('place order: the new order is in Process orders, marked as from the admin panel', await page.waitForFunction(() => /Admin panel/.test(document.querySelector('.ap-orders-table')?.innerText ?? ''), { timeout: 6000 }).then(() => true).catch(() => false));
    }

    // Returns: an undelivered parcel coming back (RTO) and a customer's return pickup.
    const rtoOrder = (await one(`select o.id from public.orders o join public.shipments s on s.order_id = o.id and s.kind = 'forward' where o.status = 'shipped' and s.carrier <> 'delhivery' order by o.created_at desc limit 1`))?.id;
    const stockOfOrder = async (id) => (await one(`select b.stock_quantity as n from public.order_items i join public.books b on b.id = i.book_id where i.order_id = $1 limit 1`, [id]))?.n;
    await db.query(`update public.shipments set status = 'rto' where order_id = $1 and kind = 'forward'`, [rtoOrder]);
    const rtoStock = await stockOfOrder(rtoOrder);
    await db.query(`update public.orders set status = 'delivered' where id = $1`, [dlOrder]);
    await db.query(`insert into public.shipments (order_id, kind, status, carrier) values ($1, 'reverse', 'delivered', 'delhivery')`, [dlOrder]);
    const returnStock = await stockOfOrder(dlOrder);
    await gotoA(page, '/admin/orders/returns');
    check('admin returns: the RTO parcel and the customer return are listed', await page.waitForFunction(() => document.querySelectorAll('.ap-orders-table tbody tr').length === 2, { timeout: 6000 }).then(() => true).catch(() => false));
    const receive = async (section) => {
      await page.$$eval(`section[aria-labelledby="${section}"] tbody button`, (bs) => bs.find((b) => b.textContent.trim() === 'Received back')?.click());
      await page.waitForFunction((s) => [...document.querySelectorAll(`section[aria-labelledby="${s}"] tbody button`)].some((b) => /^Yes, add/.test(b.textContent.trim())), { timeout: 4000 }, section).catch(() => {});
      await page.$$eval(`section[aria-labelledby="${section}"] tbody button`, (bs) => bs.find((b) => /^Yes, add/.test(b.textContent.trim()))?.click());
      return page.waitForFunction((s) => /Received back/.test(document.querySelector(`section[aria-labelledby="${s}"] .ap-badge`)?.textContent ?? ''), { timeout: 6000 }, section).then(() => true).catch(() => false);
    };
    check(
      'admin returns: Received back cancels the RTO order and puts its book back in stock',
      (await receive('rto-heading')) && (await one(`select status from public.orders where id = $1`, [rtoOrder])).status === 'cancelled' && (await stockOfOrder(rtoOrder)) === rtoStock + 1,
    );
    const rtoCancel = await one(`select cancelled_by, cancelled_from from public.orders where id = $1`, [rtoOrder]);
    check('admin returns: the RTO cancellation is recorded as from Shipped', rtoCancel.cancelled_by === 'seller' && rtoCancel.cancelled_from === 'shipped', JSON.stringify(rtoCancel));
    check(
      'admin returns: Received back puts a customer return back in stock once',
      (await receive('returns-heading')) && (await stockOfOrder(dlOrder)) === returnStock + 1 && (await one(`select return_received_at from public.order_fulfilment where order_id = $1`, [dlOrder]))?.return_received_at != null,
    );
    await page.screenshot({ path: path.join(SHOTS, 'admin-returns-1280.png'), fullPage: true });

    await gotoA(page, '/admin/shipping');
    check('admin shipping: the Delhivery pickup form counts the booked parcel', await page.waitForFunction(() => /1 Delhivery parcel is booked/.test(document.body.innerText) && document.querySelector('#dl-pickup-count')?.value === '1', { timeout: 6000 }).then(() => true).catch(() => false));
    await page.$$eval('main button[type=submit]', (bs) => bs.find((b) => /Request Delhivery pickup/.test(b.textContent))?.click());
    check('admin shipping: a Delhivery pickup is requested', await page.waitForFunction(() => /Delhivery pickup 4323300 requested/.test(document.querySelector('.toast')?.textContent ?? ''), { timeout: 6000 }).then(() => true).catch(() => false));
    await page.screenshot({ path: path.join(SHOTS, 'admin-shipping-delhivery-light-1280.png'), fullPage: true });
    await page.setViewport({ width: 375, height: 800 });
    await sleep(150);
    check('admin shipping at 375px: no sideways scrolling', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(SHOTS, 'admin-shipping-delhivery-375.png'), fullPage: true });
    await gotoA(page, '/admin/orders/track?pay=cod');
    await page.waitForFunction(() => /AWB/.test(document.body.innerText), { timeout: 6000 }).catch(() => {});
    check('admin orders at 375px: no sideways scrolling', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), await page.evaluate(() => [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && ![...e.children].some((c) => c.getBoundingClientRect().right > window.innerWidth + 1)).slice(0, 8).map((e) => e.tagName + '.' + e.className + ':' + Math.round(e.getBoundingClientRect().right)).join(' ')));
    await page.screenshot({ path: path.join(SHOTS, 'admin-orders-delhivery-375.png'), fullPage: true });
    check('Delhivery admin flow: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
    await db.query(`update public.shipping_settings set auto_book = true`);
  }

  // ---------- Return and exchange requests: customer asks, admin decides ----------
  {
    const reader = await newPage();
    await goto(reader.page, '/sign-in');
    await waitSel(reader.page, '#email');
    await reader.page.type('#email', 'reader@example.com');
    await reader.page.type('#password', 'reader-pass-1');
    await reader.page.click('button[type=submit]');
    await reader.page.waitForFunction(() => location.pathname === '/', { timeout: 8000 }).catch(() => {});
    const book = await one(`select id, sku, price from public.books where is_visible and stock_quantity >= 5 order by stock_quantity desc limit 1`);
    const placed = await asRole(db, { role: 'authenticated', sub: USERS['reader@example.com'].id }, (tx) =>
      tx.query(`select public.create_order($1::jsonb, $2::jsonb, 'cod') as id`, [
        JSON.stringify([{ book_id: book.id, quantity: 2 }]),
        JSON.stringify({ name: 'Asha Rao', phone: '9876543210', address: '12 MG Road', city: 'Udaipur', state: 'Rajasthan', pincode: '313001' }),
      ]),
    );
    const retOrder = placed.rows[0].id;
    await db.query(`update public.orders set status = 'shipped' where id = $1`, [retOrder]);
    await db.query(`update public.orders set status = 'delivered' where id = $1`, [retOrder]);
    await db.query(`update public.shipments set status = 'delivered' where order_id = $1 and kind = 'forward'`, [retOrder]);

    await goto(reader.page, `/orders/${retOrder}`);
    check('returns: a delivered order offers Return or exchange', await reader.page.waitForFunction(() => [...document.querySelectorAll('main a')].some((a) => a.textContent.trim() === 'Return or exchange'), { timeout: 8000 }).then(() => true).catch(() => false));
    await reader.page.$$eval('main a', (as) => as.find((a) => a.textContent.trim() === 'Return or exchange')?.click());
    check('returns: the form opens', await waitSel(reader.page, '#return-reason', 8000));
    await reader.page.$eval('.return-line-qty select', (s) => {
      s.value = '1';
      s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await reader.page.select('#return-reason', 'Damaged Product');
    await reader.page.$$eval('.return-form button[type=submit]', (bs) => bs[0].click());
    check('returns: a damaged book needs a photo before sending', await reader.page.waitForFunction(() => /Add a photo that shows the problem/.test(document.querySelector('.return-form')?.innerText ?? ''), { timeout: 4000 }).then(() => true).catch(() => false));
    const photo = path.join(SHOTS, 'e2e-return-photo.png');
    fs.writeFileSync(photo, TINY_PNG);
    await (await reader.page.$('#return-photo-input')).uploadFile(photo);
    const uploaded = await reader.page.waitForFunction(() => document.querySelectorAll('.return-photo').length === 1 && !document.querySelector('.return-photo[aria-busy]'), { timeout: 8000 }).then(() => true).catch(() => false);
    check("returns: the photo uploads to the customer's own folder", uploaded && [...storedPhotos.keys()].some((k) => k.startsWith(`${USERS['reader@example.com'].id}/`)), [...storedPhotos.keys()].join(','));
    await reader.page.type('#return-remark', 'The cover arrived torn');
    await reader.page.type('#return-upi', 'asha@okbank');
    await reader.page.screenshot({ path: path.join(SHOTS, 'return-form-1280.png'), fullPage: true });
    await reader.page.$$eval('.return-form button[type=submit]', (bs) => bs[0].click());
    check('returns: sending the request returns to the order', await reader.page.waitForFunction((id) => location.pathname === `/orders/${id}`, { timeout: 8000 }, retOrder).then(() => true).catch(() => false));
    const asked = await one(`select * from public.return_requests where order_id = $1`, [retOrder]);
    check('returns: the request is saved with one copy, the photo and the UPI ID', asked && asked.stage === 'new' && asked.items[0].quantity === 1 && asked.photos.length === 1 && asked.refund_upi === 'asha@okbank' && asked.remark === 'The cover arrived torn', JSON.stringify(asked && { stage: asked.stage, items: asked.items, photos: asked.photos }));
    check('returns: the order page shows the request as Requested', await reader.page.waitForFunction(() => /Return request R-\d+/.test(document.querySelector('main')?.innerText ?? '') && document.querySelector('.return-status')?.textContent.trim() === 'Requested', { timeout: 6000 }).then(() => true).catch(() => false));
    await reader.page.screenshot({ path: path.join(SHOTS, 'return-requested-1280.png'), fullPage: true });

    const { page, ctx, errors } = await newPage();
    await adminSignIn(page);
    await gotoA(page, '/admin/orders/return-requests');
    check('admin returns: the request is under New Request', await page.waitForFunction(() => document.querySelectorAll('.ap-returns-table tbody tr').length >= 1 && /Damaged Product/.test(document.querySelector('.ap-returns-table')?.innerText ?? ''), { timeout: 8000 }).then(() => true).catch(() => false));
    check('admin returns: the summary and tab counts are shown', /Customer Return Request %/.test(await page.$eval('main', (m) => m.innerText)) && /New Request \(1\)/.test(await page.$eval('.ap-underline-tabs', (t) => t.innerText)));
    await page.screenshot({ path: path.join(SHOTS, 'admin-return-requests-new-1280.png'), fullPage: true });
    await page.$$eval('.ap-returns-table button', (bs) => bs.find((b) => /View All 1 File/.test(b.textContent))?.click());
    check("admin returns: the customer's photo opens", await page.waitForFunction(() => document.querySelector('.ap-dialog .ap-return-photo img')?.complete && document.querySelector('.ap-dialog .ap-return-photo img').naturalWidth > 0, { timeout: 6000 }).then(() => true).catch(() => false));
    await page.keyboard.press('Escape');
    await gone(page, '.ap-dialog');
    await page.$$eval('.ap-returns-table button', (bs) => bs.find((b) => b.textContent.trim() === 'Approve')?.click());
    await page.waitForFunction(() => [...document.querySelectorAll('.ap-dialog button')].some((b) => b.textContent.trim() === 'Approve'), { timeout: 4000 }).catch(() => {});
    await page.screenshot({ path: path.join(SHOTS, 'admin-return-approve-1280.png') });
    await page.$$eval('.ap-dialog button', (bs) => bs.find((b) => b.textContent.trim() === 'Approve')?.click());
    check('admin returns: approving books the return pickup', await page.waitForFunction(() => /approved: pickup booked/.test(document.querySelector('.toast')?.textContent ?? ''), { timeout: 8000 }).then(() => true).catch(() => false), await page.$eval('.toast', (t) => t.textContent).catch(() => 'no toast'));
    const reverse = await one(`select * from public.shipments where order_id = $1 and kind = 'reverse' and status <> 'cancelled'`, [retOrder]);
    check('admin returns: the pickup is booked with an AWB, and the request is Ongoing', reverse?.status === 'booked' && reverse.awb_number && (await one(`select stage from public.return_requests where id = $1`, [asked.id])).stage === 'ongoing', JSON.stringify(reverse && { status: reverse.status, awb: reverse.awb_number }));
    await page.$$eval('.ap-underline-tabs button', (bs) => bs.find((b) => /^Ongoing/.test(b.textContent.trim()))?.click());
    check('admin returns: Ongoing shows the return pickup', await page.waitForFunction((awb) => (document.querySelector('.ap-returns-table')?.innerText ?? '').includes(awb), { timeout: 6000 }, reverse?.awb_number ?? 'none').then(() => true).catch(() => false));
    await page.screenshot({ path: path.join(SHOTS, 'admin-return-requests-ongoing-1280.png'), fullPage: true });

    if (reverse) await db.query(`update public.shipments set status = 'in_transit' where id = $1`, [reverse.id]);
    await gotoA(page, '/admin/orders/return-requests?tab=settlement_pending');
    check('admin returns: once picked up, it waits under Settlement Pending', await page.waitForFunction(() => [...document.querySelectorAll('.ap-returns-table button')].some((b) => b.textContent.trim() === 'Paid Offline'), { timeout: 8000 }).then(() => true).catch(() => false));
    check('admin returns: a COD order offers no GoKwik refund', !(await page.$$eval('.ap-returns-table button', (bs) => bs.some((b) => b.textContent.trim() === 'Send Refund'))));
    await page.$$eval('.ap-returns-table button', (bs) => bs.find((b) => b.textContent.trim() === 'Paid Offline')?.click());
    await waitSel(page, '#refund-ref', 4000);
    check("admin returns: Paid Offline shows the customer's UPI ID", /asha@okbank/.test(await page.$eval('.ap-dialog', (d) => d.innerText).catch(() => '')));
    await page.type('#refund-ref', 'UTR629717944373');
    await page.$$eval('.ap-dialog button[type=submit]', (bs) => bs[0].click());
    const refunded = await page.waitForFunction(() => /marked paid offline/.test(document.querySelector('.toast')?.textContent ?? ''), { timeout: 6000 }).then(() => true).catch(() => false);
    const closedRow = await one(`select stage, outcome, refund_ref from public.return_requests where id = $1`, [asked.id]);
    check('admin returns: the refund is recorded and the request closed', refunded && closedRow.stage === 'closed' && closedRow.outcome === 'passed' && closedRow.refund_ref === 'UTR629717944373', JSON.stringify(closedRow));
    await gotoA(page, '/admin/orders/return-requests?tab=closed');
    check('admin returns: Closed Requests shows it as Approved and Passed', await page.waitForFunction(() => /approved/i.test(document.querySelector('.ap-returns-table')?.innerText ?? '') && /Passed/i.test(document.querySelector('.ap-returns-table')?.innerText ?? ''), { timeout: 6000 }).then(() => true).catch(() => false));
    await page.screenshot({ path: path.join(SHOTS, 'admin-return-requests-closed-1280.png'), fullPage: true });
    await page.setViewport({ width: 375, height: 800 });
    await sleep(200);
    check('admin returns at 375px: no sideways scrolling', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), await page.evaluate(() => [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && ![...e.children].some((c) => c.getBoundingClientRect().right > window.innerWidth + 1)).slice(0, 8).map((e) => e.tagName + '.' + e.className + ':' + Math.round(e.getBoundingClientRect().right)).join(' ')));
    await page.screenshot({ path: path.join(SHOTS, 'admin-return-requests-375.png'), fullPage: true });

    await goto(reader.page, `/orders/${retOrder}`);
    check('returns: the customer sees the refund', await reader.page.waitForFunction(() => document.querySelector('.return-status')?.textContent.trim() === 'Refunded', { timeout: 6000 }).then(() => true).catch(() => false));
    await reader.page.setViewport({ width: 375, height: 800 });
    await goto(reader.page, `/orders/${retOrder}/return`);
    check('returns: a returned order cannot be returned again', await reader.page.waitForFunction(() => /already returned or exchanged/.test(document.querySelector('main')?.innerText ?? ''), { timeout: 6000 }).then(() => true).catch(() => false));
    check('returns at 375px: no sideways scrolling', await reader.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    check('returns (customer): no console errors', reader.errors.length === 0, reader.errors.join(' | '));
    check('returns (admin): no console errors', errors.length === 0, errors.join(' | '));
    await reader.ctx.close();
    await ctx.close();
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
