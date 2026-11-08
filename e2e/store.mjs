// Browser checks for the storefront. Run the dev server (npm run dev -- --port 5199)
// or a preview build, then: npm run e2e   (BASE=http://localhost:5200 for a preview).
//
// Supabase requests are answered by fake-supabase.mjs: the real schema.sql in PGlite,
// seeded with the public catalogue read live with the anon key from .env.local.
// Screenshots go to e2e/shots/ (gitignored).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createBackend, fetchPublicBooks, handleAuth, handleRest } from './fake-supabase.mjs';

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
const AMBER = 'rgb(234, 168, 0)';
const amberButtons = (page) =>
  page.$$eval('main .btn, main button', (els, amber) => els.filter((e) => getComputedStyle(e).backgroundColor === amber).length, AMBER);

try {
  // ---------- Visitor: Home ----------
  {
    const { page, ctx, errors } = await newPage();
    await goto(page, '/');
    check('home: featured book renders', await waitSel(page, '.featured .featured-title'));
    const top = await one(
      `select title from public.books where is_visible and stock_quantity > 0 order by discount_percent desc, id asc limit 1`,
    );
    check('home: featured is the biggest in-stock discount from the database', (await text(page, '.featured-title')) === top.title, `${await text(page, '.featured-title')} vs ${top.title}`);
    await waitSel(page, '.shelf .book-card');
    check('home: deals shelf shows 10 more books', (await page.$$('.shelf .book-card')).length === 10);
    const total = (await one(`select count(*)::int as n from public.books where is_visible`)).n;
    check('home: "Browse all N books" uses the real count', new RegExp(`Browse all ${total} books`).test(await page.$eval('main', (m) => m.innerText)), total);
    check('home: removed hero, band and second grid are gone', (await page.$('.hero, .band, .book-grid, .hero-search')) === null);
    check('home: exactly one amber button (the featured Add to cart)', (await amberButtons(page)) === 1, await amberButtons(page));
    check('cards: no Save button on cards', (await page.$('.book-card .save-button')) === null);
    check('cards: quiet Add button present', (await page.$$('.book-card .btn-quiet')).length === 10);
    const tagBg = await page.$eval('.book-card .cover-tag', (e) => getComputedStyle(e).backgroundColor).catch(() => null);
    check('cards: discount tag is neutral, not amber', tagBg && tagBg !== AMBER, tagBg);
    check('header: Offers removed from navigation', (await page.$('header a[href="/offers"]')) === null);
    check('footer: slim footer with Terms and Settings', (await page.$('.site-footer a[href="/terms"]')) && (await page.$('.site-footer a[href="/settings"]')) && (await page.$('.footer-grid')) === null);
    check('header: count shows 0 with no subtotal', (await text(page, '.cart-count')) === '0' && (await page.$('.cart-subtotal')) === null);
    await page.screenshot({ path: path.join(SHOTS, 'home-light-1280.png'), fullPage: true });

    // ---------- Add to cart, header count + subtotal ----------
    const firstCard = await page.$('.shelf .book-card');
    const price = await firstCard.$eval('.price', (e) => e.textContent.trim());
    await (await firstCard.$('.btn-quiet')).click();
    await page.waitForFunction(() => document.querySelector('.cart-count')?.textContent.trim() === '1', { timeout: 4000 }).catch(() => {});
    check('add: header count becomes 1', (await text(page, '.cart-count')) === '1');
    const subtotalShown = await page
      .waitForFunction((p) => document.querySelector('.cart-subtotal')?.textContent.trim() === p, { timeout: 5000 }, price)
      .then(() => true)
      .catch(() => false);
    check('add: header shows the subtotal from fresh prices', subtotalShown, `${await text(page, '.cart-subtotal')} vs ${price}`);
    check('add: header cart button names count and subtotal', /Cart, 1 item, subtotal/.test(await page.$eval('.cart-button', (b) => b.getAttribute('aria-label'))));
    check('add: toast offers "View cart"', await waitSel(page, '.toast .toast-action', 3000));
    await page.click('.toast .toast-action');
    check('toast "View cart" opens the cart panel', await waitSel(page, '.cart-panel', 3000));
    await sleep(350);
    await page.keyboard.press('Escape');
    await gone(page, '.cart-panel');

    // ---------- Cart panel ----------
    await page.click('.cart-button');
    check('panel: opens from the header cart button', await waitSel(page, '.cart-panel[role="dialog"]', 3000));
    await sleep(300);
    check('panel: focus moves inside', await page.evaluate(() => document.querySelector('.cart-panel').contains(document.activeElement)));
    check('panel: lists the book with its total', (await page.$$('.cart-panel .line')).length === 1 && (await text(page, '.cart-panel .line-total')) === price);
    check('panel: subtotal matches', (await text(page, '.cart-panel-sum dd')) === price);
    check('panel: amber Checkout is the only amber button', (await page.$$eval('.cart-panel .btn', (els, a) => els.filter((e) => getComputedStyle(e).backgroundColor === a).map((e) => e.textContent.trim()), AMBER)).join() === 'Checkout');
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
    const zero = await page
      .waitForFunction(() => document.querySelector('.cart-count')?.textContent.trim() === '0', { timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    check('panel: header count back to 0', zero, await text(page, '.cart-count'));
    await page.click('.cart-panel-empty a');
    check('panel: a link inside the panel closes it and navigates', (await gone(page, '.cart-panel')) && new URL(page.url()).pathname === '/books');
    check('visitor flow: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- Book page ----------
  {
    const { page, ctx, errors } = await newPage();
    const book = await one(
      `select id, title from public.books where is_visible and stock_quantity > 1 and coalesce(array_length(image_urls, 1), 0) > 1 order by discount_percent desc, id limit 1`,
    );
    await goto(page, `/books/${book.id}`);
    check('book page: title in serif renders', await waitSel(page, '.detail-title'));
    check('book page: title matches the database', (await text(page, '.detail-title')) === book.title);
    const body = await page.$eval('main', (m) => m.innerText);
    check('book page: no SKU, package size or shipping weight', !/\bSKU\b|Package size|Shipping weight/i.test(body));
    check('book page: exactly one amber button (Add to cart)', (await amberButtons(page)) === 1, await amberButtons(page));
    check('book page: Buy now and Save are quiet outline buttons', /Buy now/.test(body) && (await page.$('.buy-secondary .btn-outline[aria-pressed]')) !== null);
    const thumbs = await page.$$('.gallery-thumbs .thumb');
    if (thumbs.length > 1) {
      await thumbs[1].click();
      await sleep(300);
      check('book page: choosing a thumbnail selects it', (await page.$eval('.gallery-thumbs li:nth-child(2) .thumb', (b) => b.getAttribute('aria-pressed'))) === 'true');
    }
    await page.screenshot({ path: path.join(SHOTS, 'book-light-1280.png'), fullPage: true });
    await page.$$eval('.detail-buy .btn-primary', (bs) => bs[0].click());
    await page.waitForFunction(() => document.querySelector('.cart-count')?.textContent.trim() === '1', { timeout: 4000 }).catch(() => {});
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
    await waitSel(page, '.shelf .book-card');
    await (await page.$('.shelf .book-card .btn-quiet')).click();
    await sleep(300);
    await page.click('.cart-button');
    await waitSel(page, '.cart-panel');
    await sleep(300);
    await page.$$eval('.cart-panel a', (as) => as.find((a) => a.textContent.trim() === 'Checkout')?.click());
    await page.waitForFunction(() => location.pathname === '/checkout', { timeout: 5000 }).catch(() => {});
    check('panel Checkout opens the checkout page', new URL(page.url()).pathname === '/checkout');
    await waitSel(page, '#ship-name');
    await page.waitForFunction(() => document.querySelector('#ship-name')?.value.length > 0, { timeout: 5000 }).catch(() => {});
    check('checkout: delivery details prefilled from the profile', (await page.$eval('#ship-name', (e) => e.value)) === 'Asha Rao');
    await page.type('#ship-city', 'Udaipur');
    await page.select('#ship-state', 'Rajasthan');
    await page.type('#ship-pincode', '313001');
    check('checkout: Place order is the only amber button', (await amberButtons(page)) === 1, await amberButtons(page));
    await page.screenshot({ path: path.join(SHOTS, 'checkout-light-1280.png'), fullPage: true });
    const before = (await one('select count(*)::int as n from public.orders')).n;
    await page.$$eval('main button[type=submit]', (bs) => bs.find((b) => /Place order/.test(b.textContent))?.click());
    await page.waitForFunction(() => /^\/orders\//.test(location.pathname), { timeout: 8000 }).catch(() => {});
    check('checkout: order saved once and order page opens', /^\/orders\//.test(new URL(page.url()).pathname) && (await one('select count(*)::int as n from public.orders')).n === before + 1);
    check('order page: "awaiting payment" notice', await page.waitForFunction(() => /awaiting payment/i.test(document.body.innerText), { timeout: 5000 }).then(() => true).catch(() => false));
    check('order: cart emptied after ordering', await page.waitForFunction(() => document.querySelector('.cart-count')?.textContent.trim() === '0', { timeout: 4000 }).then(() => true).catch(() => false));
    await page.screenshot({ path: path.join(SHOTS, 'order-light-1280.png'), fullPage: true });

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
    await ctx.close();
  }

  // ---------- Themes, widths, overflow ----------
  const pages = ['/', '/books', '/cart', '/terms', '/nowhere'];
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
        await waitSel(page, '.shelf .book-card');
        await sleep(600);
        await page.screenshot({ path: path.join(SHOTS, `home-${scheme}-${w}.png`), fullPage: true });
        await (await page.$('.shelf .book-card .btn-quiet')).click();
        await sleep(300);
        await page.click('.cart-button');
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
