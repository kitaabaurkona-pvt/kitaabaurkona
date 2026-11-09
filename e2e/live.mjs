// Read-only smoke test against the LIVE Supabase project, as a signed-out visitor.
// Browses home (slider, tiles, shelves, Books menu), the books filters, a book page and
// the cart panel, and fails if any request other than a read reaches Supabase. Run with
// the dev server or a preview build up:
//   node e2e/live.mjs            (BASE=http://localhost:5200 for a preview build)

import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE || 'http://localhost:5199';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${String(detail).slice(0, 300)}`}`);
};
const appears = (page, selector, timeout = 20000) =>
  page
    .waitForSelector(selector, { timeout })
    .then(() => true)
    .catch(() => false);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const writes = [];
  const errors = [];
  page.on('request', (r) => {
    if (r.url().includes('.supabase.co') && !['GET', 'HEAD', 'OPTIONS'].includes(r.method())) {
      writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    }
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|DevTools/.test(m.text())) errors.push(m.text());
  });

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  check('live home: slider shows books from the database', await appears(page, '.slider .slide-title'));
  const slides = await page.$$eval('.slider .slide', (els) => els.length);
  check('live home: slider has 1 to 5 slides', slides >= 1 && slides <= 5, slides);
  check('live home: category tiles filled', await appears(page, '.tile[href*="category="]'));
  check('live home: deals shelf filled', (await page.$$('.shelf .book-card')).length > 0);
  const total = await page.$eval('.home-browse', (e) => e.textContent).catch(() => '');
  check('live home: browse link shows the catalogue size', /Browse all \d+ books/.test(total), total);

  // Scroll the whole page (and every row) so lazy covers load, then look for failures.
  await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await wait(150);
    }
    for (const row of document.querySelectorAll('.shelf, .tiles')) row.scrollLeft = row.scrollWidth;
    await wait(2500);
  });
  const broken = await page.$$eval('img', (imgs) =>
    imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).map((i) => i.getAttribute('src')),
  );
  const pending = await page.$$eval('img', (imgs) => imgs.filter((i) => !i.complete).length);
  console.log(`      covers: ${broken.length} failed, ${pending} still loading`);
  check('live home: no broken cover images', broken.length === 0, broken.join(' '));

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.hover('.books-menu-button');
  check('live books menu: opens with categories', await appears(page, '.books-menu-panel a[href*="category="]', 5000));
  await page.keyboard.press('Escape');

  await page.goto(`${BASE}/books?collection=regional`, { waitUntil: 'networkidle2' });
  check('live books: regional editions filter', await appears(page, '.book-grid .book-card'));
  await page.goto(`${BASE}/books?max=299&stock=1`, { waitUntil: 'networkidle2' });
  await appears(page, '.book-grid .book-card');
  const prices = await page.$$eval('.book-grid .book-card .price', (els) => els.map((e) => Number(e.textContent.replace(/[^\d]/g, ''))));
  check('live books: up to ₹299 shows only books at ₹299 or less', prices.length > 0 && prices.every((p) => p <= 299), prices.join(','));

  await page.goto(`${BASE}/books?stock=1`, { waitUntil: 'networkidle2' });
  check('live books: grid filled', await appears(page, '.book-grid .book-card'));
  await page.$eval('.book-grid .book-card a', (a) => a.click());
  check('live book page: opens', await appears(page, '.detail-title'));
  check('live book page: no SKU or package details', !/\bSKU\b|Package size|Shipping weight/i.test(await page.$eval('main', (m) => m.innerText)));

  await page.$$eval('.detail-buy .btn-primary', (bs) => bs[0]?.click());
  await page.click('.cart-button');
  check('live cart panel: opens with the book', await appears(page, '.cart-panel .line', 10000));
  check('live: no write requests reached Supabase', writes.length === 0, writes.join(', '));
  check('live: no console errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
