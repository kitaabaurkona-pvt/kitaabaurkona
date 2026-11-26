// Browser checks for mobile number login (GoKwik KwikPass). Builds the store with a test
// KwikPass merchant id into e2e/shots/kwikpass-build (gitignored), serves it with the real
// security headers (vite preview) and logs in through the sign-in page in Chrome.
//
// Nothing real is called in the main checks: Supabase is fake-supabase.mjs (the real
// schema.sql in PGlite, with Auth's admin API), GoKwik's script is a stand-in that records
// what the site asks of it and answers like GoKwik's guide says, and the real `kwikpass`
// Edge Function handler runs in this process with test keys. One check loads GoKwik's REAL
// scripts (sandbox and production) under our security policy, without sending any OTP.
// Run: node e2e/kwikpass-ui.mjs      Screenshots go to e2e/shots/.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import * as jose from 'jose';
import { createClient } from '@supabase/supabase-js';
import { createBackend, fetchPublicBooks, handleAuth, handleAuthAdmin, handleRest, SERVICE_TOKEN } from './fake-supabase.mjs';
import { createHandler } from '../supabase/functions/kwikpass/handler.js';
import { createAccounts } from '../supabase/functions/kwikpass/accounts.js';
import { createTokenReader } from '../supabase/functions/kwikpass/token.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = path.join(ROOT, 'e2e', 'shots');
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const MID = 'testkpmid1';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${String(detail).slice(0, 300)}`}`);
};
const section = (title) => console.log(`\n-- ${title}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range, range' };

// ---------- The sites: the store (KwikPass production) and the test shop ----------
async function buildAndServe(outDir, port, args, env) {
  const built = spawnSync(process.execPath, [VITE, 'build', ...args, '--outDir', outDir, '--emptyOutDir'], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (built.status !== 0) {
    console.error(built.stdout, built.stderr);
    process.exit(1);
  }
  const server = spawn(process.execPath, [VITE, 'preview', '--outDir', outDir, '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://localhost:${port}`);
      break;
    } catch {
      await sleep(200);
    }
  }
  return server;
}
const PORT = 5206;
const STAGING_PORT = 5207;
const BASE = `http://localhost:${PORT}`;
const STAGING_BASE = `http://localhost:${STAGING_PORT}`;
console.log('Building the store and the test shop with mobile number login on…');
const preview = await buildAndServe(path.join(SHOTS, 'kwikpass-build'), PORT, [], { VITE_KWIKPASS_MID: MID, VITE_KWIKPASS_ENV: 'production' });
const stagingPreview = await buildAndServe(path.join(SHOTS, 'kwikpass-staging-build'), STAGING_PORT, ['--mode', 'staging'], { VITE_KWIKPASS_MID: MID, VITE_KWIKPASS_ENV: 'production' });

// ---------- Fake Supabase, and the real kwikpass function in this process ----------
const db = await createBackend({ schemaPath: path.join(ROOT, 'supabase', 'schema.sql'), books: await fetchPublicBooks(path.join(ROOT, '.env.local')) });
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const answer = async (input) => (input.url.pathname.startsWith('/rest/v1/') ? handleRest(db, input) : ((await handleAuthAdmin(db, input)) ?? handleAuth(input)));
const inProcessFetch = async (target, init = {}) => {
  const url = new URL(typeof target === 'string' ? target : target.url);
  const r = await answer({ method: init.method || 'GET', url, headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body });
  return new Response(r.body ?? '', { status: r.status, headers: { 'content-type': 'application/json', ...(r.headers || {}) } });
};
const service = createClient('https://fake.supabase.co', SERVICE_TOKEN, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: inProcessFetch } });
const newKey = () => jose.base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
const PROD_KEY = newKey();
const SANDBOX_KEY = newKey();
const kwikpass = createHandler({
  db: service,
  accounts: createAccounts(service),
  tokens: createTokenReader({ keys: { production: PROD_KEY, sandbox: SANDBOX_KEY }, jose }),
  origins: [BASE, STAGING_BASE],
  log: { info() {}, warn() {}, error() {} },
});
const kpToken = (claims, key = PROD_KEY) => new jose.EncryptJWT(claims).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setIssuedAt().encrypt(jose.base64url.decode(key));

// GoKwik's KwikPass script, replaced by one that records what the site asks of it and
// answers as GoKwik's guide says. window.__kpTokens (set by the test) holds the token
// GoKwik would give for each number; OTP 1234 is right, 0000 wrong, 9999 makes it fail.
const FAKE_SDK = `window.__kp = window.__kp || { sends: [], verifies: [], logouts: 0 };
window.__kp.merchantInfoAtLoad = JSON.parse(JSON.stringify(window.merchantInfo || null));
window.__KP_LOGIN_SDK_INSTANCE__ = {
  async kpSendOTP(phone) {
    window.__kp.sends.push(phone);
    if (phone === '7000000001') return { status: 429, message: 'Too many OTP requests. Please try after some time.' };
    return { status: 200, body: { data: {} }, message: 'OTP sent successfully' };
  },
  async kpVerifyOTP(input) {
    window.__kp.verifies.push(input);
    if (input.otp === '9999') return undefined;
    if (input.otp !== '1234') return { status: 400, message: 'OTP is invalid. Please try again.' };
    return { status: 200, body: { data: { email: '', token: 't', coreToken: 'c', kpToken: (window.__kpTokens || {})[input.phone] || '' } } };
  },
  handleKPLogout() { window.__kp.logouts += 1; },
  handleKpSSOButton() {},
};`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
async function newPage({ width = 1280, height = 900, sdk = 'fake', tokens = {} } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.evaluateOnNewDocument((t) => {
    window.__kpTokens = t;
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push({ directive: e.violatedDirective, blocked: e.blockedURI || 'inline' }));
  }, tokens);
  const errors = [];
  const sdkRequests = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|DevTools/.test(m.text())) errors.push(m.text());
  });
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const url = new URL(req.url());
    if (/gokwik\.(co|io|in)$/.test(url.hostname)) {
      if (url.pathname.endsWith('/kp-custom-merchant.js')) sdkRequests.push(url.href);
      if (sdk === 'real') return req.continue();
      if (sdk === 'blocked') return req.abort('failed');
      if (url.pathname.endsWith('/kp-custom-merchant.js')) return req.respond({ status: 200, headers: { 'content-type': 'application/javascript' }, body: FAKE_SDK });
      return req.abort('failed');
    }
    if (!url.hostname.endsWith('.supabase.co')) return req.continue();
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS });
    if (url.pathname.startsWith('/functions/v1/kwikpass')) {
      const res = await kwikpass(new Request(url.href, { method: req.method(), headers: req.headers(), body: req.postData() }));
      return req.respond({ status: res.status, headers: { ...CORS, 'content-type': 'application/json' }, body: await res.text() });
    }
    if (url.pathname.startsWith('/functions/v1/')) return req.respond({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"ok":true,"data":{}}' });
    const r = await answer({ method: req.method(), url, headers: req.headers(), body: req.postData() });
    return req.respond({ status: r.status, headers: { ...CORS, 'content-type': 'application/json', ...(r.headers || {}) }, body: r.body ?? '' });
  });
  return { page, ctx, errors, sdkRequests };
}
let siteBase = BASE;
const goto = (page, p) => page.goto(`${siteBase}${p}`, { waitUntil: 'domcontentloaded' });
const waitSel = (page, sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
const waitFor = (page, fn, ms = 8000, ...args) => page.waitForFunction(fn, { timeout: ms }, ...args).then(() => true).catch(() => false);
const text = (page) => page.evaluate(() => document.body.innerText);
const clickText = (page, selector, pattern) => page.$$eval(selector, (els, p) => els.find((e) => new RegExp(p).test(e.textContent))?.click(), pattern);
async function typeInto(page, selector, value) {
  await page.focus(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type(selector, value);
  const typed = await page.$eval(selector, (input) => input.value);
  if (typed !== value) throw new Error(`${selector} holds "${typed}", not "${value}"`);
}
async function sendOtp(page, phone) {
  await waitSel(page, '#mobile');
  await typeInto(page, '#mobile', phone);
  await page.click('button[type=submit]');
}
async function enterOtp(page, otp) {
  await waitSel(page, '#otp');
  await typeInto(page, '#otp', otp);
  await page.click('button[type=submit]');
}

try {
  const tokens = {
    9812345678: await kpToken({ phone: '9812345678' }),
    9123456780: await kpToken({ data: { phone_number: '+91 91234 56780' } }),
    9000000002: await kpToken({ phone: { value: '9000000002', country_code: '+1' } }),
  };

  section('The sign-in page');
  {
    const { page, ctx, errors, sdkRequests } = await newPage({ tokens });
    await goto(page, '/sign-in');
    check('the mobile number tab is shown first', await waitFor(page, () => document.querySelector('.auth-tab[aria-selected="true"]')?.textContent === 'Mobile number'));
    check('...with the +91 number box', await waitSel(page, '#mobile'));
    check("GoKwik's production script is loaded on the live store build", await waitFor(page, () => window.__kp?.merchantInfoAtLoad, 8000) && sdkRequests[0] === 'https://pdp.gokwik.co/kwikpass/plugin/build/kp-custom-merchant.js', JSON.stringify(sdkRequests));
    const info = await page.evaluate(() => window.__kp.merchantInfoAtLoad);
    check('merchant details are on the page before the script runs', info?.mid === MID && info?.environment === 'production' && info?.type === 'merchantInfo', JSON.stringify(info));
    await clickText(page, '.auth-tab', '^Email$');
    check('the Email tab shows the email form', (await waitSel(page, '#email', 3000)) && (await page.$('#mobile')) === null);
    await clickText(page, '.auth-tab', '^Mobile number$');
    await sendOtp(page, '12345');
    check('a short number is caught before GoKwik is asked', (await waitFor(page, () => /valid 10-digit mobile number/.test(document.body.innerText), 3000)) && (await page.evaluate(() => window.__kp.sends.length)) === 0);
    await sendOtp(page, '7000000001');
    check("GoKwik's own error message is shown as it is", await waitFor(page, () => /Too many OTP requests/.test(document.body.innerText), 4000));
    await sendOtp(page, '9812345678');
    check('Send OTP asks GoKwik for that number (10 digits)', (await waitSel(page, '#otp', 5000)) && (await page.evaluate(() => window.__kp.sends.at(-1))) === '9812345678');
    check('the OTP step names the number and offers to change it', /OTP sent to \+91 9812345678/.test(await text(page)) && /Change/.test(await text(page)));
    check('Resend OTP waits a minute first', /Resend OTP in \d+s/.test(await text(page)));
    await page.screenshot({ path: path.join(SHOTS, 'kwikpass-otp-step-1280.png'), fullPage: true });
    await enterOtp(page, '12');
    check('a short OTP is caught before GoKwik is asked', (await waitFor(page, () => /Enter the 4-digit OTP/.test(document.body.innerText), 3000)) && (await page.evaluate(() => window.__kp.verifies.length)) === 0);
    await enterOtp(page, '0000');
    check("a wrong OTP shows GoKwik's message and stays on the OTP step", (await waitFor(page, () => /OTP is invalid/.test(document.body.innerText), 4000)) && !!(await page.$('#otp')));
    await enterOtp(page, '9999');
    check('if GoKwik fails, a plain message offers email instead', await waitFor(page, () => /log in with your email/.test(document.body.innerText), 4000));
    await clickText(page, '.otp-sent button', 'Change');
    check('Change goes back to the number', (await waitSel(page, '#mobile', 3000)) && (await page.$eval('#mobile', (i) => i.value)) === '9812345678');
    check('no script errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  section('Logging in');
  let userId;
  {
    const { page, ctx, errors } = await newPage({ tokens });
    await goto(page, '/sign-in');
    await sendOtp(page, '9812345678');
    await enterOtp(page, '1234');
    check('the right OTP logs in and leaves the sign-in page', await waitFor(page, () => location.pathname === '/', 10000));
    check('GoKwik was asked to check the number and OTP as typed', JSON.stringify(await page.evaluate(() => window.__kp.verifies.at(-1))) === JSON.stringify({ phone: '9812345678', otp: '1234' }));
    const row = await one(`select l.user_id::text, l.environment, u.phone from public.phone_logins l join public.users u on u.id = l.user_id where l.phone = '9812345678'`);
    userId = row?.user_id;
    check('a new account was made for the verified number (production)', row?.environment === 'production' && row?.phone === '9812345678', JSON.stringify(row));
    await goto(page, '/account');
    await waitFor(page, () => /Your details/.test(document.body.innerText), 8000);
    const body = await text(page);
    check('My Account shows the mobile number and no made-up email', /9812345678/.test(body) && !/mobile\.kitaabaurkona\.com/.test(body) && !/^Email$/m.test(body));
    await page.screenshot({ path: path.join(SHOTS, 'kwikpass-account-1280.png'), fullPage: true });
    await clickText(page, 'button', '^Sign out$');
    check('signing out also logs out of KwikPass', (await waitFor(page, () => location.pathname === '/sign-in', 8000)) && (await page.evaluate(() => window.__kp.logouts)) === 1);
    check('no script errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  section('Logging in again, and other numbers');
  {
    const { page, ctx } = await newPage({ tokens });
    await goto(page, '/sign-in');
    await sendOtp(page, '9812345678');
    await enterOtp(page, '1234');
    await waitFor(page, () => location.pathname === '/', 10000);
    const accounts = await one(`select count(*)::int as n from public.phone_logins where phone = '9812345678'`);
    const session = await page.evaluate(() => Object.entries(localStorage).find(([k]) => k.includes('auth-token'))?.[1] ?? '');
    check('the same number logs in to the same account', accounts.n === 1 && session.includes(userId), `${accounts.n} ${session.slice(0, 80)}`);
    await ctx.close();
  }
  {
    const { page, ctx } = await newPage({ tokens });
    await goto(page, '/sign-in');
    await sendOtp(page, '9000000002');
    await enterOtp(page, '1234');
    check('a non-Indian number in the token is refused with a clear message', (await waitFor(page, () => /Only Indian \(\+91\) mobile numbers/.test(document.body.innerText), 8000)) && (await page.evaluate(() => location.pathname)) === '/sign-in');
    await ctx.close();
  }

  section("GoKwik's script cannot load");
  {
    const { page, ctx } = await newPage({ sdk: 'blocked' });
    await goto(page, '/sign-in');
    await sendOtp(page, '9812345678');
    check('Send OTP says to use email instead', await waitFor(page, () => /log in with your email/.test(document.body.innerText), 20000));
    await clickText(page, '.auth-tab', '^Email$');
    await waitSel(page, '#email');
    await page.type('#email', 'reader@example.com');
    await page.type('#password', 'reader-pass-1');
    await page.click('button[type=submit]');
    check('email login still works', await waitFor(page, () => location.pathname === '/', 8000));
    await ctx.close();
  }

  section('The test shop');
  {
    siteBase = STAGING_BASE;
    const sandboxTokens = { 9812345678: await kpToken({ phone: '9812345678' }, SANDBOX_KEY) };
    const { page, ctx, sdkRequests } = await newPage({ tokens: sandboxTokens });
    await goto(page, '/');
    check("GoKwik's script loads on every page, not only sign-in", await waitFor(page, () => !!window.__kp?.merchantInfoAtLoad, 10000));
    check('the test shop always uses the sandbox script, even if the build says production', sdkRequests[0] === 'https://sandbox.pdp.gokwik.co/kwikpass/plugin/build/kp-custom-merchant.js' && (await page.evaluate(() => window.__kp.merchantInfoAtLoad.environment)) === 'sandbox', JSON.stringify(sdkRequests));
    await goto(page, '/sign-in');
    await sendOtp(page, '9812345678');
    await enterOtp(page, '1234');
    await waitFor(page, () => location.pathname === '/', 10000);
    const rows = (await db.query(`select environment, user_id::text from public.phone_logins where phone = '9812345678' order by environment`)).rows;
    check('a sandbox login for the same number gets its own test account', rows.length === 2 && rows[0].environment === 'production' && rows[1].environment === 'sandbox' && rows[0].user_id !== rows[1].user_id, JSON.stringify(rows));
    await ctx.close();
    siteBase = BASE;
  }

  section("GoKwik's real scripts under our security policy");
  for (const [label, base] of [
    ['production', BASE],
    ['sandbox', STAGING_BASE],
  ]) {
    siteBase = base;
    const { page, ctx } = await newPage({ sdk: 'real' });
    await goto(page, '/sign-in');
    const ready = await waitFor(page, () => typeof window.__KP_LOGIN_SDK_INSTANCE__?.kpSendOTP === 'function' && typeof window.__KP_LOGIN_SDK_INSTANCE__?.handleKPLogout === 'function', 20000);
    await sleep(3000);
    const csp = await page.evaluate(() => window.__csp.filter((v) => !/googletagmanager/.test(v.blocked)));
    check(`GoKwik's real ${label} login script starts with nothing blocked`, ready && csp.length === 0, JSON.stringify({ ready, csp }));
    await ctx.close();
  }
  siteBase = BASE;

  section('Phone widths');
  for (const width of [320, 375]) {
    const { page, ctx } = await newPage({ width, height: 760, tokens });
    await goto(page, '/sign-in');
    await sendOtp(page, '9812345678');
    await waitSel(page, '#otp', 5000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`sign-in at ${width}px: no sideways scrolling`, overflow <= 0, `overflow ${overflow}`);
    await page.screenshot({ path: path.join(SHOTS, `kwikpass-otp-${width}.png`), fullPage: true });
    await ctx.close();
  }
} catch (error) {
  check('suite ran without crashing', false, error?.stack ?? error);
} finally {
  await browser.close();
  preview.kill();
  stagingPreview.kill();
  await db.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
