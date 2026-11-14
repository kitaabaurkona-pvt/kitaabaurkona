// Browser checks for page speed and for "the page went blank". Builds the site into
// e2e/shots/speed-build (gitignored), serves it with vite preview and loads pages in
// Chrome. Supabase is fake-supabase.mjs (the real schema.sql in PGlite, seeded with the
// public catalogue); the image host is never contacted (its requests are answered here
// with a 1x1 picture and counted).
// Run: node e2e/speed.mjs

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createBackend, fetchPublicBooks, handleAuth, handleRest } from './fake-supabase.mjs';
import { coverHash } from '../src/utils/coverHash.js';
import { coverList } from '../src/utils/coverList.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5206;
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BUILD = path.join(ROOT, 'e2e', 'shots', 'speed-build');
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const IMAGE_HOST = 'd2lxx579h3vopi.cloudfront.net';
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${String(detail).slice(0, 300)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range, range' };

const built = spawnSync(process.execPath, [VITE, 'build', '--outDir', BUILD, '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8' });
if (built.status !== 0) {
  console.error(built.stdout, built.stderr);
  process.exit(1);
}
const preview = spawn(process.execPath, [VITE, 'preview', '--outDir', BUILD, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 50; i++) {
  try {
    await fetch(BASE);
    break;
  } catch {
    await sleep(200);
  }
}

const books = await fetchPublicBooks(path.join(ROOT, '.env.local'));
const db = await createBackend({ schemaPath: path.join(ROOT, 'supabase', 'schema.sql'), books });
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

// options: apiDelay (ms before the catalogue answers), missing (a page's script file is
// gone, as after a release) and healed (it is back after a reload), breakCovers (small
// covers fail to load).
async function newPage({ width = 390, height = 800, apiDelay = 0, missing = null, healed = true, breakCovers = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height, isMobile: width < 700, hasTouch: width < 700 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  const seen = { imageHost: [], covers: [], errors: [], loads: 0, stale: false };
  page.on('pageerror', (e) => seen.errors.push(String(e).slice(0, 160)));
  page.on('load', () => {
    seen.loads += 1;
    if (healed) seen.stale = false;
  });
  await page.evaluateOnNewDocument(() => {
    window.__shift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shift += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const url = new URL(req.url());
    if (url.hostname === IMAGE_HOST) {
      seen.imageHost.push(url.pathname);
      return req.respond({ status: 200, headers: { 'content-type': 'image/png' }, body: PIXEL });
    }
    if (url.pathname.startsWith('/images/covers/')) {
      seen.covers.push(url.pathname);
      if (breakCovers) return req.abort('failed');
    }
    if (seen.stale && missing && missing.test(url.pathname)) return req.respond({ status: 404, headers: { 'content-type': 'text/plain' }, body: 'not found' });
    if (!url.hostname.endsWith('.supabase.co')) return req.continue();
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
    if (url.pathname.startsWith('/functions/v1/')) return req.respond({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"ok":true,"data":{}}' });
    if (apiDelay) await sleep(apiDelay);
    const input = { method: req.method(), url, headers: req.headers(), body: req.postData() };
    const r = url.pathname.startsWith('/rest/v1/') ? await handleRest(db, input) : handleAuth(input);
    return req.respond({ status: r.status, headers: { ...CORS, 'content-type': 'application/json', ...(r.headers || {}) }, body: r.body ?? '' }).catch(() => {});
  });
  return { page, ctx, seen };
}
const goto = (page, p, waitUntil = 'networkidle0') => page.goto(`${BASE}${p}`, { waitUntil, timeout: 30000 });
const waitFor = (page, fn, ms = 8000, ...args) => page.waitForFunction(fn, { timeout: ms }, ...args).then(() => true).catch(() => false);
const scrollDown = (page) =>
  page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
  });
const cardImages = (page) => page.$$eval('.book-card img', (imgs) => imgs.map((i) => ({ src: new URL(i.currentSrc || i.src).pathname, host: new URL(i.currentSrc || i.src).host, natural: i.naturalWidth })));

try {
  // ---------- Files and settings ----------
  const coverDir = path.join(ROOT, 'public', 'images', 'covers');
  const firstImages = [...new Set(books.map((b) => b.image_urls?.[0]).filter(Boolean))];
  check('every listed small cover has both of its files', [...coverList].every((h) => fs.existsSync(path.join(coverDir, `${h}.webp`)) && fs.existsSync(path.join(coverDir, `${h}-360.webp`))));
  const without = firstImages.filter((url) => !coverList.has(coverHash(url)));
  check('every book in the shop has a small cover (run `npm run covers` after adding books)', without.length === 0, `${without.length} without, e.g. ${without[0]}`);
  const largest = Math.max(...fs.readdirSync(coverDir).filter((f) => f.endsWith('-360.webp')).map((f) => fs.statSync(path.join(coverDir, f)).size));
  check('no small cover is over 80 KB', largest < 80 * 1024, `${Math.round(largest / 1024)} KB`);

  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const cacheOf = (source) => vercel.headers.find((h) => h.source === source)?.headers.find((x) => x.key === 'Cache-Control')?.value ?? '';
  check('script, style, font and picture files are kept by the browser', ['/assets/(.*)', '/images/(.*)', '/banners/(.*)'].every((s) => /max-age=86400/.test(cacheOf(s)) && /stale-while-revalidate/.test(cacheOf(s))));
  check('the page itself is never kept (a release shows at once)', !vercel.headers.some((h) => h.source === '/(.*)' && h.headers.some((x) => x.key === 'Cache-Control')));
  check('a missing script file answers "not found", not the web page', vercel.rewrites.length === 1 && vercel.rewrites[0].source === '/((?!assets/).*)' && new RegExp(`^${vercel.rewrites[0].source}$`).test('/books/x') && !new RegExp(`^${vercel.rewrites[0].source}$`).test('/assets/Books-old.js'));
  check('security headers are still the first rule, for every address', vercel.headers[0].source === '/(.*)' && vercel.headers[0].headers.some((h) => h.key === 'Content-Security-Policy'));
  const html = fs.readFileSync(path.join(BUILD, 'index.html'), 'utf8');
  check('the two main fonts are fetched with the page', (html.match(/rel="preload" as="font"/g) ?? []).length === 2 && /dm-sans-latin-wght-normal/.test(html) && /bricolage-grotesque-latin-wght-normal/.test(html));
  check('the database connection is opened early', /rel="preconnect" href="https:\/\/[a-z0-9]+\.supabase\.co" crossorigin/.test(html));

  // ---------- Home ----------
  {
    const { page, ctx, seen } = await newPage({ apiDelay: 1500 });
    await goto(page, '/', 'domcontentloaded');
    const heroEarly = await waitFor(page, () => document.querySelectorAll('.hero-books .hero-book img').length === 3 && [...document.querySelectorAll('.hero-books .hero-book img')].every((i) => i.complete && i.naturalWidth > 0), 1200);
    check('home: the three hero covers show before the catalogue answers', heroEarly);
    check('home: each hero cover names its book', (await page.$$eval('.hero-books .hero-book img', (imgs) => imgs.map((i) => i.alt))).join('|') === 'A Dawn of Onyx|Everything I Know About Love|Heartstopper: Volume 5');
    await waitFor(page, () => document.querySelectorAll('.book-card').length >= 8, 8000);
    await scrollDown(page);
    await sleep(500);
    const imgs = await cardImages(page);
    check('home: every book cover is a small picture from the site itself', imgs.length >= 8 && imgs.every((i) => i.host === new URL(BASE).host && i.natural > 0 && i.natural <= 720) && seen.imageHost.length === 0, JSON.stringify({ imageHost: seen.imageHost.length, sample: imgs[0] }));
    check('home: nothing jumps while it loads', (await page.evaluate(() => window.__shift)) < 0.1, await page.evaluate(() => window.__shift));
    check('home: no script errors', seen.errors.length === 0, seen.errors.join(' | '));
    await ctx.close();
  }
  {
    // One request for the shelf and the hero together, one for the budget shelf.
    const { page, ctx } = await newPage();
    const calls = [];
    page.on('request', (r) => {
      if (/supabase\.co\/rest\/v1\/books/.test(r.url()) && r.method() === 'GET') calls.push(r.url());
    });
    await goto(page, '/');
    check('home: the catalogue is asked twice, not three times', calls.length === 2, calls.length);
    await ctx.close();
  }
  {
    // A hero book that is no longer sold disappears once the catalogue has answered.
    await db.query(`update public.books set is_visible = false where id = 'fd249dd4-5f1c-43fa-8052-dab6cf224bbc'`);
    const { page, ctx } = await newPage();
    await goto(page, '/');
    check('home: a hero book that is no longer sold is taken out', (await page.$$eval('.hero-books .hero-book img', (imgs) => imgs.map((i) => i.alt))).join('|') === 'A Dawn of Onyx|Heartstopper: Volume 5');
    await db.query(`update public.books set is_visible = true where id = 'fd249dd4-5f1c-43fa-8052-dab6cf224bbc'`);
    await ctx.close();
  }

  // ---------- All books ----------
  {
    const { page, ctx, seen } = await newPage();
    await goto(page, '/books');
    await waitFor(page, () => document.querySelectorAll('.book-card').length >= 12);
    const shift = await page.evaluate(() => window.__shift);
    check('books: the page does not jump while it loads', shift < 0.1, shift);
    await scrollDown(page);
    await sleep(500);
    const imgs = await cardImages(page);
    check('books: every cover is a small picture from the site itself', imgs.length >= 12 && imgs.every((i) => i.host === new URL(BASE).host && i.natural > 0 && i.natural <= 720) && seen.imageHost.length === 0, JSON.stringify({ imageHost: seen.imageHost.slice(0, 2), n: imgs.length }));
    check('books: a phone downloads the 360-pixel copies', seen.covers.length > 0 && seen.covers.filter((p) => p.endsWith('-360.webp')).length >= seen.covers.length * 0.8, JSON.stringify(seen.covers.slice(0, 3)));

    // The book's own page keeps its original photos.
    await page.$$eval('.book-card a.card-media-link', (as) => as[2].click());
    await waitFor(page, () => /^\/books\/[0-9a-f-]{36}$/.test(location.pathname) && document.querySelector('.gallery-slide img'));
    const photo = await page.$eval('.gallery-slide img', (i) => new URL(i.currentSrc || i.src).host);
    check("book page: the book's own photos are still the originals", photo === IMAGE_HOST, photo);
    await ctx.close();
  }
  {
    // A book whose first picture has changed since the covers were made, and small covers
    // that cannot be loaded: both fall back to the original picture.
    const changed = (await one(`select id from public.books where is_visible and stock_quantity > 0 order by title limit 1`)).id;
    await db.query(`update public.books set image_urls = array['https://${IMAGE_HOST}/new/changed-cover.png'] where id = $1`, [changed]);
    const { page, ctx, seen } = await newPage({ breakCovers: true });
    await goto(page, '/books');
    await waitFor(page, () => document.querySelectorAll('.book-card').length >= 12);
    await scrollDown(page);
    await sleep(800);
    const imgs = await cardImages(page);
    check('a book with a new picture shows that picture, not an old small copy', seen.imageHost.includes('/new/changed-cover.png'));
    check('if small covers cannot be loaded, the original pictures are shown instead', imgs.length >= 12 && imgs.filter((i) => i.host === IMAGE_HOST).length >= imgs.length * 0.7 && (await page.$$eval('.book-card .cover-fallback', (f) => f.length)) === 0, JSON.stringify({ original: imgs.filter((i) => i.host === IMAGE_HOST).length, n: imgs.length }));
    await ctx.close();
  }

  // ---------- The page must never go blank ----------
  for (const healed of [true, false]) {
    const { page, ctx, seen } = await newPage({ width: 1280, height: 900, missing: /\/assets\/Books-.*\.js$/, healed });
    await goto(page, '/');
    seen.stale = true;
    seen.loads = 0;
    await page.$$eval('a[href="/books"]', (as) => as[0].click());
    if (healed) {
      check('tab open across a release: opening a page reloads once and shows it', (await waitFor(page, () => location.pathname === '/books' && document.querySelectorAll('.book-card').length >= 12, 10000)) && seen.loads === 1, `loads ${seen.loads}`);
    } else {
      const shown = await waitFor(page, () => [...document.querySelectorAll('main button')].some((b) => /Reload page/.test(b.textContent)), 10000);
      check('page file still missing after the reload: a message with Reload, never a blank page', shown && seen.loads === 1 && (await page.$('header')) !== null && (await page.$('footer')) !== null, `loads ${seen.loads}`);
      // The rest of the site keeps working from there.
      seen.stale = false;
      await page.$$eval('header a[href="/"]', (as) => as[0].click());
      check('...and the other pages still open from there', await waitFor(page, () => location.pathname === '/' && document.querySelectorAll('.hero-books img').length === 3, 6000));
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  preview.kill();
  await db.close();
  fs.rmSync(BUILD, { recursive: true, force: true });
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
