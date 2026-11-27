// Browser checks for the "coming soon" gate on the live store: until GoKwik checkout is
// ready, only accounts that already exist (made before ACCOUNTS_MADE_BEFORE) and admins
// can use the store; sign-up is closed; sign-in, password help and the policy pages stay
// open. Builds the store with --mode coming-soon into e2e/shots/coming-soon-build
// (gitignored), serves it with the real security headers and clicks through in Chrome.
// Supabase is fake-supabase.mjs (the real schema.sql in PGlite). The account's creation
// time is set per check by rewriting Auth's answers.
// Run: node e2e/coming-soon.mjs      Screenshots go to e2e/shots/.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createBackend, fetchPublicBooks, handleAuth, handleRest } from './fake-supabase.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = path.join(ROOT, 'e2e', 'shots');
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${String(detail).slice(0, 300)}`}`);
};
const section = (title) => console.log(`\n-- ${title}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range, range' };

const OLD_ACCOUNT = '2026-10-01T10:00:00Z';
const NEW_ACCOUNT = '2026-12-05T10:00:00Z';

const PORT = 5208;
const BASE = `http://localhost:${PORT}`;
console.log('Building the store with the coming-soon gate on…');
const outDir = path.join(SHOTS, 'coming-soon-build');
const built = spawnSync(process.execPath, [VITE, 'build', '--mode', 'coming-soon', '--outDir', outDir, '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8' });
if (built.status !== 0) {
  console.error(built.stdout, built.stderr);
  process.exit(1);
}
const preview = spawn(process.execPath, [VITE, 'preview', '--outDir', outDir, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
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
const bookId = (await db.query('select id from public.books order by id limit 1')).rows[0]?.id;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
async function newPage({ createdAt = OLD_ACCOUNT, width = 1280, height = 900 } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
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
    if (url.pathname.startsWith('/functions/v1/')) return req.respond({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"ok":true,"data":{}}' });
    let r;
    if (url.pathname.startsWith('/auth/v1/')) {
      r = handleAuth({ url, headers: req.headers(), body: req.postData() });
      // When the account was made decides whether it may enter.
      if (r.status === 200 && r.body) {
        const value = JSON.parse(r.body);
        if (value.user) value.user.created_at = createdAt;
        else if (value.id && value.aud) value.created_at = createdAt;
        r = { ...r, body: JSON.stringify(value) };
      }
    } else {
      r = await handleRest(db, { method: req.method(), url, headers: req.headers(), body: req.postData() });
    }
    return req.respond({ status: r.status, headers: { ...CORS, 'content-type': 'application/json', ...(r.headers || {}) }, body: r.body ?? '' });
  });
  return { page, ctx, errors };
}
const goto = (page, p) => page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' });
const waitFor = (page, fn, ms = 8000, ...args) => page.waitForFunction(fn, { timeout: ms }, ...args).then(() => true).catch(() => false);
const waitSel = (page, sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
const comingSoon = (page, ms) => waitFor(page, () => document.querySelector('h1')?.textContent === 'Opening soon', ms);
const storeShown = (page, ms = 10000) => waitFor(page, () => !!document.querySelector('a[href^="/books/"]') && !/Opening soon/.test(document.body.innerText), ms);
async function typeInto(page, selector, value) {
  await page.focus(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type(selector, value);
}
async function logIn(page, email, password) {
  await goto(page, '/sign-in');
  await waitSel(page, '#email');
  await typeInto(page, '#email', email);
  await typeInto(page, '#password', password);
  await page.click('button[type=submit]');
}

try {
  section('Signed out');
  {
    const { page, ctx, errors } = await newPage();
    for (const p of ['/', '/books', `/books/${bookId}`, '/offers', '/cart', '/checkout', '/orders', '/no-such-page']) {
      await goto(page, p);
      check(`${p} shows "Opening soon"`, await comingSoon(page), await page.evaluate(() => document.body.innerText.slice(0, 200)));
    }
    await goto(page, '/');
    await comingSoon(page);
    check('no store content behind the page', (await page.$('a[href^="/books/"]')) === null);
    await page.screenshot({ path: path.join(SHOTS, 'coming-soon-desktop.png') });
    check('...with a working Log in link', (await page.$eval('a.coming-soon-login', (a) => a.getAttribute('href')).catch(() => null)) === '/sign-in');
    await page.click('a.coming-soon-login');
    check('Log in opens the sign-in page', await waitFor(page, () => location.pathname === '/sign-in' && !!document.querySelector('#email')));
    check('the sign-in page has no Sign up link', (await page.$('a[href="/sign-up"]')) === null);
    await goto(page, '/sign-up');
    check('/sign-up goes to the sign-in page', await waitFor(page, () => location.pathname === '/sign-in' && !!document.querySelector('#email')));
    for (const p of ['/terms', '/privacy', '/returns', '/shipping', '/about']) {
      await goto(page, p);
      check(`${p} stays open`, await waitFor(page, () => document.body.innerText.length > 200 && !/Opening soon/.test(document.body.innerText)), await page.evaluate(() => document.body.innerText.slice(0, 200)));
    }
    await goto(page, '/forgot-password');
    check('/forgot-password stays open', await waitFor(page, () => !!document.querySelector('#email') && !/Opening soon/.test(document.body.innerText)));
    check('no script errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  section('An account made before the gate');
  {
    const { page, ctx, errors } = await newPage({ createdAt: OLD_ACCOUNT });
    await logIn(page, 'reader@example.com', 'reader-pass-1');
    check('logging in opens the store', await storeShown(page));
    await goto(page, '/books');
    check('the catalogue is shown', await storeShown(page));
    await goto(page, `/books/${bookId}`);
    check('a book page is shown', await waitFor(page, () => !!document.querySelector('h1') && document.querySelector('h1').textContent !== 'Opening soon'));
    await goto(page, '/account');
    check('My Account is shown', await waitFor(page, () => location.pathname === '/account' && !/Opening soon/.test(document.body.innerText) && document.body.innerText.length > 100));
    check('no script errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  section('An account made after the gate');
  {
    const { page, ctx, errors } = await newPage({ createdAt: NEW_ACCOUNT });
    await logIn(page, 'reader@example.com', 'reader-pass-1');
    check('logging in still shows "Opening soon"', await comingSoon(page));
    check('...saying the store is not open to new accounts', /not open to new accounts/.test(await page.evaluate(() => document.body.innerText)));
    await goto(page, '/books');
    check('the catalogue stays hidden', await comingSoon(page));
    await page.screenshot({ path: path.join(SHOTS, 'coming-soon-new-account.png') });
    await waitFor(page, () => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Log out'));
    const logOut = await page.$$eval('button', (els) => { const b = els.find((e) => e.textContent === 'Log out'); if (!b) return 'missing'; b.click(); return 'clicked'; });
    const loggedOut = logOut !== 'missing' && (await waitFor(page, () => !!document.querySelector('a.coming-soon-login')));
    check('Log out works', loggedOut, `${logOut} :: ${await page.evaluate(() => document.body.innerText.slice(0, 300))}`);
    check('no script errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  section('Admins');
  {
    const { page, ctx, errors } = await newPage({ createdAt: NEW_ACCOUNT });
    await logIn(page, 'admin@example.com', 'admin-pass-1');
    check('an admin gets in whenever the account was made', await storeShown(page));
    check('no script errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  section('Phone widths');
  for (const width of [320, 375]) {
    const { page, ctx } = await newPage({ width, height: 760 });
    await goto(page, '/');
    await comingSoon(page);
    if (width === 375) await page.screenshot({ path: path.join(SHOTS, 'coming-soon-375.png') });
    check(`"Opening soon" at ${width}px: no sideways scrolling`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await ctx.close();
  }
} finally {
  await browser.close();
  preview.kill();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
