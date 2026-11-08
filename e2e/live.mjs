// Read-only smoke test against the LIVE Supabase project, as a signed-out visitor.
// Browses home, books, a book page and the cart panel, and fails if any request other
// than a read reaches Supabase. Run with the dev server or a preview build up:
//   node e2e/live.mjs            (BASE=http://localhost:5200 for a preview build)

import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE || 'http://localhost:5199';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${String(detail).slice(0, 300)}`}`);
};

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
  check('live home: featured book from the database', await page.waitForSelector('.featured-title', { timeout: 20000 }).then(() => true).catch(() => false));
  check('live home: deals shelf filled', (await page.$$('.shelf .book-card')).length > 0);
  const total = await page.$eval('.home-browse', (e) => e.textContent).catch(() => '');
  check('live home: browse link shows the catalogue size', /Browse all \d+ books/.test(total), total);

  await page.goto(`${BASE}/books?stock=1`, { waitUntil: 'networkidle2' });
  check('live books: grid filled', await page.waitForSelector('.book-grid .book-card', { timeout: 20000 }).then(() => true).catch(() => false));
  await page.$eval('.book-grid .book-card a', (a) => a.click());
  check('live book page: opens', await page.waitForSelector('.detail-title', { timeout: 20000 }).then(() => true).catch(() => false));
  check('live book page: no SKU or package details', !/\bSKU\b|Package size|Shipping weight/i.test(await page.$eval('main', (m) => m.innerText)));

  await page.$$eval('.detail-buy .btn-primary', (bs) => bs[0]?.click());
  await page.click('.cart-button');
  check('live cart panel: opens with the book', await page.waitForSelector('.cart-panel .line', { timeout: 10000 }).then(() => true).catch(() => false));
  check('live: no write requests reached Supabase', writes.length === 0, writes.join(', '));
  check('live: no console errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
