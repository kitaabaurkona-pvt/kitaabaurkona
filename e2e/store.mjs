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
// Amber buttons a visitor can actually see (slides that are not showing are aria-hidden).
const amberButtons = (page) =>
  page.$$eval(
    'main .btn, main button',
    (els, amber) => els.filter((e) => !e.closest('[aria-hidden="true"]') && getComputedStyle(e).backgroundColor === amber).length,
    AMBER,
  );

try {
  // ---------- Visitor: Home ----------
  {
    const { page, ctx, errors } = await newPage();
    await goto(page, '/');
    check('home: hero slider renders', await waitSel(page, '.slider .slide-title'));
    const topFive = (
      await db.query(`select title from public.books where is_visible and stock_quantity > 0 order by discount_percent desc, id asc limit 5`)
    ).rows.map((r) => r.title);
    const slideTitles = await page.$$eval('.slide .slide-title', (els) => els.map((e) => e.textContent.trim()));
    check('home: slider shows the 5 biggest in-stock discounts, in order', JSON.stringify(slideTitles) === JSON.stringify(topFive), JSON.stringify(slideTitles));
    check('home: only the first slide is exposed to assistive tech', (await page.$$('.slide[aria-hidden="false"]')).length === 1);
    await waitSel(page, '#deals-heading');
    await waitSel(page, '.shelf .book-card');
    check('home: deals shelf shows the next 10 deals', (await page.$$('[aria-labelledby="deals-heading"] .book-card')).length === 10);
    for (const [id, label] of [['under', 'Up to ₹299'], ['combos', 'Box Sets & Combos'], ['regional', 'Regional editions']]) {
      check(`home: "${label}" shelf has books`, (await waitSel(page, `[aria-labelledby="${id}-heading"] .book-card`)) && (await text(page, `#${id}-heading`)) === label);
    }
    const total = (await one(`select count(*)::int as n from public.books where is_visible`)).n;
    check('home: "Browse all N books" uses the real count', new RegExp(`Browse all ${total} books`).test(await page.$eval('main', (m) => m.innerText)), total);
    check('home: no announcement bar or invented promos', !/free delivery|prepaid|% off on|sale ends|rated|★/i.test(await page.$eval('main', (m) => m.innerText)));
    check('home: exactly one visible amber button (the slide Add to cart)', (await amberButtons(page)) === 1, await amberButtons(page));
    check('cards: no Save button on cards', (await page.$('.book-card .save-button')) === null);
    check('cards: every card has the quiet Add button', (await page.$$('.book-card')).length === (await page.$$('.book-card .btn-quiet')).length);
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
    check('panel: amber Checkout is the only amber button', (await page.$$eval('.cart-panel .btn', (els, a) => els.filter((e) => getComputedStyle(e).backgroundColor === a).map((e) => e.textContent.trim()), AMBER)).join().startsWith('Checkout'));
    check('panel: Checkout button shows the total', /^Checkout\s*•\s*₹/.test(await page.$eval('.cart-panel .btn-primary', (b) => b.textContent.trim())));
    check('panel: Continue browsing link present', (await page.$('.cart-panel-links a[href="/books"]')) !== null);
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

  // ---------- Slider, tiles, shelves, Books menu, header search, filters ----------
  {
    const { page, ctx, errors } = await newPage();
    await goto(page, '/');
    await waitSel(page, '.slider .slide-title');
    const activeDot = () => page.$$eval('.slider-dot', (ds) => ds.findIndex((d) => d.getAttribute('aria-current') === 'true'));
    await page.mouse.move(5, 5);
    check('slider: starts on the first book', (await activeDot()) === 0);
    await sleep(6600);
    check('slider: advances by itself after 6 seconds', (await activeDot()) === 1, await activeDot());
    await page.hover('.slider');
    const held = await activeDot();
    await sleep(6600);
    check('slider: pauses while hovered', (await activeDot()) === held, await activeDot());
    await page.click('.slider-arrow[aria-label="Next book"]');
    const afterArrow = await activeDot();
    check('slider: next arrow moves on', afterArrow === (held + 1) % 5, afterArrow);
    await page.mouse.move(5, 5);
    await sleep(6600);
    check('slider: stops advancing once the visitor used it', (await activeDot()) === afterArrow, await activeDot());
    await page.click('.slider-dot:nth-child(1)');
    check('slider: dots jump to a book', (await activeDot()) === 0);

    // Tiles: counts come from the database
    await waitSel(page, '.tile');
    const dbCounts = Object.fromEntries(
      (await db.query(`select category, count(*)::int as n from public.books where is_visible group by category`)).rows.map((r) => [r.category, r.n]),
    );
    const tiles = await page.$$eval('.tile', (ts) => ts.map((t) => ({ label: t.querySelector('.tile-label').textContent.trim(), meta: t.querySelector('.tile-meta').textContent.trim(), href: t.getAttribute('href') })));
    const categoryTiles = tiles.filter((t) => t.href.includes('category='));
    check('tiles: one tile per category in the database', categoryTiles.length === Object.keys(dbCounts).filter((k) => k !== 'null').length, categoryTiles.length);
    check('tiles: category counts match the database', categoryTiles.every((t) => t.meta.startsWith(`${dbCounts[t.label]} book`)), JSON.stringify(categoryTiles.slice(0, 3)));
    const under = (await one(`select count(*)::int as n from public.books where is_visible and stock_quantity > 0 and price <= 299`)).n;
    const regional = (await one(`select count(*)::int as n from public.books where is_visible and (title ilike '%tamil%' or title ilike '%bengali%' or title ilike '%malayalam%')`)).n;
    check('tiles: "Up to ₹299" count matches the database', tiles.some((t) => t.label === 'Up to ₹299' && t.meta.startsWith(`${under} book`)), under);
    check('tiles: "Regional editions" count matches the database', tiles.some((t) => t.label === 'Regional editions' && t.meta.startsWith(`${regional} book`)), regional);
    const tintBg = await page.$eval('.tile', (t) => getComputedStyle(t).backgroundColor);
    check('tiles: tinted, not amber', tintBg !== AMBER && tintBg !== 'rgba(0, 0, 0, 0)', tintBg);

    // Shelf arrows (desktop, mouse)
    const before = await page.$eval('[aria-labelledby="deals-heading"] .shelf', (l) => l.scrollLeft);
    await page.click('[aria-labelledby="deals-heading"] .shelf-arrow[aria-label$="forward"]');
    await sleep(700);
    const after = await page.$eval('[aria-labelledby="deals-heading"] .shelf', (l) => l.scrollLeft);
    check('shelf: forward arrow scrolls the row', after > before, `${before} -> ${after}`);
    check('shelf: back arrow appears after scrolling', await page.$eval('[aria-labelledby="deals-heading"] .shelf-arrow[aria-label$="back"]', (b) => !b.hidden));
    await page.screenshot({ path: path.join(SHOTS, 'home-tiles-light-1280.png'), fullPage: true });

    // Books menu
    await page.hover('.books-menu-button');
    check('books menu: opens on hover', await waitSel(page, '.books-menu-panel', 2000));
    check('books menu: lists fiction and non-fiction categories', (await page.$$('.books-menu-panel a[href*="category="]')).length === categoryTiles.length);
    await sleep(300); // let the 150ms fade finish before the screenshot
    await page.screenshot({ path: path.join(SHOTS, 'books-menu-light-1280.png') });
    await page.keyboard.press('Escape');
    check('books menu: Escape closes it and focus returns to the button', (await gone(page, '.books-menu-panel')) && (await page.evaluate(() => document.activeElement?.classList.contains('books-menu-button'))));
    await page.keyboard.press('ArrowDown');
    await waitSel(page, '.books-menu-panel', 2000);
    await sleep(100);
    check('books menu: Arrow down opens it and focuses the first link', await page.evaluate(() => document.activeElement?.closest('.books-menu-panel') !== null));
    const firstCategory = await page.$eval('.books-menu-panel a[href*="category="]', (a) => a.textContent.trim());
    await page.$eval('.books-menu-panel a[href*="category="]', (a) => a.click());
    await page.waitForFunction(() => location.pathname === '/books', { timeout: 4000 }).catch(() => {});
    check('books menu: a category opens the filtered Books page and closes the menu', (await gone(page, '.books-menu-panel')) && new URL(page.url()).searchParams.get('category') === firstCategory);
    await waitSel(page, '.book-grid .book-card');
    check('books page: category filter count matches the database', new RegExp(`^${dbCounts[firstCategory]} books?`).test(await text(page, '.page-meta')), await text(page, '.page-meta'));

    // Filters reached from URLs
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
    check('slider/menu/filters: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- Phone: side menu categories ----------
  {
    const { page, ctx } = await newPage({ width: 375, height: 812, touch: true });
    await goto(page, '/');
    await waitSel(page, '.menu-button');
    await page.click('.menu-button');
    await waitSel(page, '.drawer');
    check('phone menu: Categories section lists the genres', await waitSel(page, '.drawer nav[aria-label="Categories"] a[href*="category="]', 4000));
    await sleep(400);
    await page.screenshot({ path: path.join(SHOTS, 'drawer-categories-light-375.png') });
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
    await page.$$eval('.cart-panel a', (as) => as.find((a) => a.textContent.trim().startsWith('Checkout'))?.click());
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
    await page.keyboard.press('Escape');
    await gone(page, '.cart-panel');
    await page.mouse.move(5, 5);
    await waitSel(page, '.slider .slide-title');
    await sleep(6800);
    const dot = await page.$$eval('.slider-dot', (ds) => ds.findIndex((d) => d.getAttribute('aria-current') === 'true'));
    check('reduce motion: the slider does not advance by itself', dot === 0, dot);
    await ctx.close();
  }

  // ---------- Themes, widths, overflow ----------
  const pages = ['/', '/books', '/books?max=299&stock=1', '/books?collection=regional', '/cart', '/terms', '/nowhere'];
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
