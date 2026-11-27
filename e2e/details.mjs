// Browser checks for "Your details": a customer who has not saved their name, mobile and
// delivery address is sent there once after logging in, the details are saved on their
// own account, and from then on checkout and My Account start from them.
// Builds the store into e2e/shots/details-build (gitignored), serves it with the real
// security headers and clicks through in Chrome. Supabase is fake-supabase.mjs (the real
// schema.sql in PGlite).
// Run: node e2e/details.mjs      Screenshots go to e2e/shots/.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createBackend, fetchPublicBooks, handleAuth, handleRest, USERS } from './fake-supabase.mjs';

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

const PORT = 5208;
const BASE = `http://localhost:${PORT}`;
console.log('Building the store…');
const outDir = path.join(SHOTS, 'details-build');
const built = spawnSync(process.execPath, [VITE, 'build', '--outDir', outDir, '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8' });
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

// Two new customers who signed up with only a name (no mobile or address yet).
const NEW = { 'new1@example.com': '33333333-3333-4333-8333-333333333333', 'new2@example.com': '44444444-4444-4444-8444-444444444444' };
const db = await createBackend({ schemaPath: path.join(ROOT, 'supabase', 'schema.sql'), books: await fetchPublicBooks(path.join(ROOT, '.env.local')) });
// Added after the fake backend has given its own accounts saved details.
for (const [email, id] of Object.entries(NEW)) {
  USERS[email] = { id, password: 'new-pass-1', meta: { full_name: 'Meera Joshi' } };
  await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, USERS[email].meta]);
}
const row = async (id) => (await db.query('select full_name, phone, address, city, state, pincode from public.users where id = $1', [id])).rows[0];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
async function newPage({ width = 1280, height = 900 } = {}) {
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
    if (url.pathname.startsWith('/functions/v1/')) return req.respond({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"ok":true,"data":{"deliverable":true,"cod":true}}' });
    const input = { method: req.method(), url, headers: req.headers(), body: req.postData() };
    const r = url.pathname.startsWith('/auth/v1/') ? handleAuth(input) : await handleRest(db, input);
    return req.respond({ status: r.status, headers: { ...CORS, 'content-type': 'application/json', ...(r.headers || {}) }, body: r.body ?? '' });
  });
  return { page, ctx, errors };
}
const goto = (page, p) => page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' });
const waitFor = (page, fn, ms = 8000, ...args) => page.waitForFunction(fn, { timeout: ms }, ...args).then(() => true).catch(() => false);
const waitSel = (page, sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
const at = (page, p, ms = 10000) => waitFor(page, (want) => location.pathname === want, ms, p);
const value = (page, sel) => page.$eval(sel, (e) => e.value);
async function typeInto(page, selector, text) {
  await page.$eval(selector, (e) => e.select?.());
  await page.keyboard.press('Backspace');
  await page.type(selector, text);
}
async function logIn(page, email, password, from = '/sign-in') {
  await goto(page, from);
  await waitSel(page, '#email');
  await typeInto(page, '#email', email);
  await typeInto(page, '#password', password);
  await page.click('button[type=submit]');
}
async function fillDetails(page) {
  await typeInto(page, '#ship-phone', '9812300001');
  await typeInto(page, '#ship-address', '22 Fateh Sagar Road, Near Moti Magri');
  await typeInto(page, '#ship-city', 'Udaipur');
  await page.select('#ship-state', 'Rajasthan');
  await typeInto(page, '#ship-pincode', '313004');
}

try {
  section('A new customer logs in');
  {
    const { page, ctx, errors } = await newPage();
    const id = NEW['new1@example.com'];
    await logIn(page, 'new1@example.com', 'new-pass-1');
    check('they are sent to "Your details"', (await at(page, '/details')) && (await waitSel(page, '#ship-name')));
    check('...with the name from sign-up already filled in', (await value(page, '#ship-name')) === 'Meera Joshi');
    await page.screenshot({ path: path.join(SHOTS, 'details-new-1280.png'), fullPage: true });
    await goto(page, '/books');
    check('other store pages wait until the details are saved', await at(page, '/details'));
    await goto(page, '/terms');
    check('the policy pages stay open', (await waitFor(page, () => location.pathname === '/terms' && document.body.innerText.length > 300)));
    await goto(page, '/books');
    await at(page, '/details');
    await waitSel(page, '#ship-name');
    await page.click('.details-form button[type=submit]');
    check('saving with the mobile missing is refused', (await waitFor(page, () => /valid 10-digit mobile/.test(document.body.innerText))) && (await page.evaluate(() => document.activeElement?.id)) === 'ship-phone');
    check('...and nothing is saved', (await row(id)).city === null);
    await fillDetails(page);
    await page.click('.details-form button[type=submit]');
    check('saving goes on to the page they were opening', await at(page, '/books'));
    const saved = await row(id);
    check('the details are saved on their own account', JSON.stringify(saved) === JSON.stringify({ full_name: 'Meera Joshi', phone: '9812300001', address: '22 Fateh Sagar Road, Near Moti Magri', city: 'Udaipur', state: 'Rajasthan', pincode: '313004' }), JSON.stringify(saved));
    await goto(page, '/account');
    check('My Account shows them, without asking again', (await at(page, '/account')) && (await waitFor(page, () => /22 Fateh Sagar Road, Near Moti Magri, Udaipur, Rajasthan 313004/.test(document.body.innerText))));
    check('no script errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  section('The same customer next time');
  {
    const { page, ctx, errors } = await newPage();
    await logIn(page, 'new1@example.com', 'new-pass-1');
    check('logging in again goes straight to the store', (await at(page, '/')) && !(await page.evaluate(() => location.pathname === '/details')));
    await sleep(800);
    check('...and stays there', await page.evaluate(() => location.pathname === '/'));
    await goto(page, '/checkout');
    await waitSel(page, 'main');
    await goto(page, '/account');
    await waitFor(page, () => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Edit'));
    await page.$$eval('button', (bs) => bs.find((b) => b.textContent === 'Edit').click());
    await waitSel(page, '#acc-city');
    check('My Account edit starts from the saved city, state and PIN code', JSON.stringify(await page.evaluate(() => ['#acc-city', '#acc-state', '#acc-pincode'].map((s) => document.querySelector(s).value))) === JSON.stringify(['Udaipur', 'Rajasthan', '313004']));
    await typeInto(page, '#acc-pincode', '12');
    await page.$$eval('button[type=submit]', (bs) => bs.find((b) => /Save details/.test(b.textContent)).click());
    check('an incomplete PIN code is refused on My Account too', await waitFor(page, () => /valid 6-digit PIN/.test(document.body.innerText)));
    await typeInto(page, '#acc-pincode', '313001');
    await page.$$eval('button[type=submit]', (bs) => bs.find((b) => /Save details/.test(b.textContent)).click());
    check('a changed PIN code is saved', await waitFor(page, () => /Udaipur, Rajasthan 313001/.test(document.body.innerText)));
    check('...on the account', (await row(NEW['new1@example.com'])).pincode === '313001');
    check('no script errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  section('A returning customer with saved details');
  {
    const { page, ctx, errors } = await newPage();
    await logIn(page, 'reader@example.com', 'reader-pass-1');
    check('is never sent to "Your details"', await at(page, '/'));
    await sleep(800);
    check('...even a moment later', await page.evaluate(() => location.pathname === '/'));
    check('no script errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  section('Signing out from "Your details"');
  {
    const { page, ctx } = await newPage({ width: 375, height: 760 });
    await logIn(page, 'new2@example.com', 'new-pass-1');
    await at(page, '/details');
    await waitSel(page, '#ship-name');
    check('"Your details" at 375px: no sideways scrolling', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(SHOTS, 'details-new-375.png'), fullPage: true });
    await page.$$eval('button', (bs) => bs.find((b) => b.textContent === 'Sign out').click());
    check('Sign out works there', await at(page, '/sign-in'));
    await goto(page, '/');
    check('signed out, the store opens normally', (await at(page, '/')) && (await waitSel(page, 'h1')));
    await ctx.close();
  }
} finally {
  await browser.close();
  preview.kill();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
