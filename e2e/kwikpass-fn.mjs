// Checks for the `kwikpass` Edge Function (mobile number login through GoKwik's KwikPass),
// run in Node with no real network calls: the database is the real supabase/schema.sql in
// PGlite behind a local fake Supabase API (REST, Auth admin and sign-in codes), and
// GoKwik's tokens are made here with test keys, the way GoKwik makes them (JWE).
// Run: npm run test:kwikpass

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as jose from 'jose';
import { createClient } from '@supabase/supabase-js';
import { asRole, authAdminCalls, createBackend, fetchPublicBooks, handleAuth, handleAuthAdmin, handleRest, SERVICE_TOKEN, sessionFor, USERS } from './fake-supabase.mjs';
import { createHandler } from '../supabase/functions/kwikpass/handler.js';
import { createAccounts } from '../supabase/functions/kwikpass/accounts.js';
import { createTokenReader, phoneFromClaims, tenDigits } from '../supabase/functions/kwikpass/token.js';
import { MOBILE_EMAIL_DOMAIN, SITE_ORIGINS } from '../supabase/functions/kwikpass/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${String(detail).slice(0, 300)}`}`);
};
const section = (title) => console.log(`\n-- ${title}`);

// ---------- Fake Supabase over HTTP ----------
const db = await createBackend({ schemaPath: path.join(ROOT, 'supabase', 'schema.sql'), books: await fetchPublicBooks(path.join(ROOT, '.env.local')) });
const readBody = (req) => new Promise((resolve) => {
  let s = '';
  req.on('data', (c) => (s += c));
  req.on('end', () => resolve(s));
});
const supa = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const body = await readBody(req);
  const input = { method: req.method, url, headers: req.headers, body };
  const r = url.pathname.startsWith('/rest/v1/') ? await handleRest(db, input) : (await handleAuthAdmin(db, input)) ?? handleAuth(input);
  res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers || {}) });
  res.end(r.body ?? '');
});
await new Promise((r) => supa.listen(0, r));
const SUPA_URL = `http://localhost:${supa.address().port}`;
const service = createClient(SUPA_URL, SERVICE_TOKEN, { auth: { persistSession: false, autoRefreshToken: false } });
const browser = () => createClient(SUPA_URL, 'anon-key', { auth: { persistSession: false, autoRefreshToken: false } });

// ---------- GoKwik's keys and tokens (test values) ----------
const newKey = () => jose.base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
const PROD_KEY = newKey();
const SANDBOX_KEY = newKey();
const OTHER_KEY = newKey();
const keyOf = (text) => jose.base64url.decode(text);
async function kpToken(claims, { key = PROD_KEY, enc = 'A256GCM', iat = true, exp } = {}) {
  let jwt = new jose.EncryptJWT(claims).setProtectedHeader({ alg: 'dir', enc });
  if (iat) jwt = jwt.setIssuedAt(typeof iat === 'number' ? iat : undefined);
  if (exp) jwt = jwt.setExpirationTime(exp);
  return jwt.encrypt(keyOf(key));
}

// ---------- The function under test ----------
const logs = [];
const log = { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) };
const accounts = createAccounts(service);
const makeHandler = (options = {}) =>
  createHandler({
    db: service,
    accounts,
    tokens: createTokenReader({ keys: { production: PROD_KEY, sandbox: SANDBOX_KEY }, jose, ...options.tokens }),
    origins: SITE_ORIGINS,
    log,
    ...options.handler,
  });
const handle = makeHandler();

const STORE = 'https://www.kitaabaurkona.com';
const STAGING = 'https://kitaabaurkonastaging.bizwitheet.com';
let ipCounter = 1;
const freshIp = () => `10.0.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
async function call(route, body, { origin = STORE, method = 'POST', ip = freshIp(), via = handle, raw, session } = {}) {
  const req = new Request(`http://fn.local/functions/v1/kwikpass${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), 'cf-connecting-ip': ip, ...(session ? { authorization: `Bearer ${session}` } : {}) },
    body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined,
  });
  const res = await via(req);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, headers: res.headers, text };
}
const login = (token, options) => call('/login', { kp_token: token }, options);
// What the website does with the answer: exchange the one-time code for a session.
async function exchange(tokenHash) {
  const { data, error } = await browser().auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
  return { userId: data?.session?.user?.id ?? null, email: data?.session?.user?.email ?? null, error };
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

try {
  section('Reading the number from the token');
  check('10 digits stay as they are', tenDigits('9812345678') === '9812345678');
  check('+91, spaces and dashes are removed', tenDigits('+91 98123-45678') === '9812345678' && tenDigits('919812345678') === '9812345678' && tenDigits('09812345678') === '9812345678');
  check('numbers that are not Indian mobiles are refused', [tenDigits('1234567890'), tenDigits('98123'), tenDigits(''), tenDigits(null), tenDigits({})].every((v) => v === null));
  check('the number is found at the top, nested, or as { value }', [
    phoneFromClaims({ phone: '9812345678' }),
    phoneFromClaims({ phone_number: 919812345678 }),
    phoneFromClaims({ data: { phoneNumber: '9812345678' } }),
    phoneFromClaims({ phone: { value: '9812345678', country_code: '+91' } }),
    phoneFromClaims({ user: { mobile: '+919812345678' } }),
  ].every((v) => v === '9812345678'));
  check('a number with another country code is refused', phoneFromClaims({ phone: { value: '9812345678', country_code: '+1' } }) === null && phoneFromClaims({ phone: '9812345678', country_code: '44' }) === null);

  section('Who may call it');
  {
    const pre = await call('/login', null, { method: 'OPTIONS', origin: STAGING });
    check('the test shop may call it (CORS)', pre.status === 204 && pre.headers.get('access-control-allow-origin') === STAGING);
    const evil = await call('/login', null, { method: 'OPTIONS', origin: 'https://evil.example' });
    check('another website may not', evil.status === 403 && !evil.headers.get('access-control-allow-origin'));
    const noOrigin = await login('x');
    check('a call without a website address is refused', (await call('/login', { kp_token: 'x' }, { origin: null })).status === 403 && noOrigin.status !== 403);
    check('the admin panel is not on the list', !SITE_ORIGINS.includes('https://kitaabaurkona.vercel.app'));
    check('GET is refused', (await call('/login', null, { method: 'GET' })).status === 405);
    const health = await call('/health', {});
    check('health names the keys that are set, never the keys', health.status === 200 && JSON.stringify(health.json.keys) === JSON.stringify(['production', 'sandbox']) && !health.text.includes(PROD_KEY) && !health.text.includes(SANDBOX_KEY));
    check('an unknown route is 404', (await call('/nope', {})).status === 404);
  }

  section('Refused tokens');
  {
    check('a missing token is 400', (await call('/login', {})).status === 400);
    check('a token that is not JSON is 400', (await call('/login', null, { raw: 'kp_token=abc' })).status === 400);
    check('a very long token is 400', (await login('a.b.c.d.' + 'e'.repeat(9000))).status === 400);
    const garbage = await login('not-a-token');
    check('a token that is not a JWE is 401 with a plain message', garbage.status === 401 && /ask for a new OTP/.test(garbage.json?.error));
    const wrongKey = await login(await kpToken({ phone: '9812345678' }, { key: OTHER_KEY }));
    check('a token made with another key is 401', wrongKey.status === 401);
    const tampered = (await kpToken({ phone: '9812345678' })).split('.');
    tampered[3] = tampered[3].slice(0, -2) + (tampered[3].endsWith('AA') ? 'BB' : 'AA');
    check('a token changed on the way is 401', (await login(tampered.join('.'))).status === 401);
    const expired = await login(await kpToken({ phone: '9812345678' }, { exp: Math.floor(Date.now() / 1000) - 3600 }));
    check('an expired token is 401', expired.status === 401 && logs.some((l) => l.includes('"reason":"expired"')));
    const noPhone = await login(await kpToken({ email: 'someone@example.com', name: 'Someone' }));
    check('a token without a number is 422', noPhone.status === 422 && /\+91/.test(noPhone.json?.error));
    const fieldsLine = logs.find((l) => l.includes('no_phone_in_token')) ?? '';
    check('...and the log names its fields, never their values', fieldsLine.includes('"email"') && !fieldsLine.includes('someone@example.com'), fieldsLine);
    const foreign = await login(await kpToken({ phone: { value: '9812345678', country_code: '+1' } }));
    check('a foreign number is 422', foreign.status === 422);
    check('no refused call made an account', authAdminCalls.length === 0, JSON.stringify(authAdminCalls));
    const noKeys = await login(await kpToken({ phone: '9812345678' }), { via: makeHandler({ tokens: { keys: { production: '', sandbox: '' } } }) });
    check('without keys it answers 503 and says to use email', noKeys.status === 503 && /email/.test(noKeys.json?.error));
  }

  section('First login with a number');
  let prodUser;
  {
    const r = await login(await kpToken({ phone: '9812345678', email: 'kp@example.com' }));
    check('answers 200 with a one-time sign-in code', r.status === 200 && r.json?.ok && /^[0-9a-f]{40,}$/.test(r.json.token_hash), r.text);
    check('...says it is a new account from production', r.json?.new_account === true && r.json?.environment === 'production');
    check('...and does not send back the number or an email address', !r.text.includes('9812345678') && !r.text.includes('@'));
    const s = await exchange(r.json.token_hash);
    prodUser = s.userId;
    check('the website gets a session for the new account', !!prodUser && !s.error, s.error?.message);
    check('the account has a random address on our mobile domain', new RegExp(`^m-[0-9a-f]{24}@${MOBILE_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`).test(s.email), s.email);
    check('the unchecked email in the token is not used', s.email !== 'kp@example.com');
    const profile = await one('select phone, role from public.users where id = $1', [prodUser]);
    check('the profile has the verified number and is a customer', profile?.phone === '9812345678' && profile?.role === 'customer', JSON.stringify(profile));
    const link = await one('select environment, linked_via from public.phone_logins where user_id = $1', [prodUser]);
    check('the number is recorded as verified (production, otp_login)', link?.environment === 'production' && link?.linked_via === 'otp_login', JSON.stringify(link));
    check('the code works only once', !!(await exchange(r.json.token_hash)).error);
  }

  section('Logging in again');
  {
    for (const [label, claims] of [
      ['the same number', { phone: '9812345678' }],
      ['with +91 and spaces', { phone: '+91 98123 45678' }],
      ['nested as { phone: { value, country_code } }', { phone: { value: '9812345678', country_code: '+91' } }],
      ['in { data: { phone_number } }', { data: { phone_number: '919812345678' } }],
    ]) {
      const r = await login(await kpToken(claims));
      const s = r.status === 200 ? await exchange(r.json.token_hash) : {};
      check(`${label}: same account, not new`, r.status === 200 && r.json.new_account === false && s.userId === prodUser, r.text);
    }
    const viaCbc = await login(await kpToken({ phone: '9812345678' }, { enc: 'A128CBC-HS256' }));
    check('a token sealed with A128CBC-HS256 opens too', viaCbc.status === 200 && (await exchange(viaCbc.json.token_hash)).userId === prodUser);
    const plain = await new jose.CompactEncrypt(new TextEncoder().encode(JSON.stringify({ phone: '9812345678' }))).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).encrypt(keyOf(PROD_KEY));
    check('a JWE holding plain JSON (not JWT claims) opens too', (await login(plain)).status === 200);
    check('still one account for the number', Number((await one(`select count(*) from public.phone_logins where phone = '9812345678' and environment = 'production'`)).count) === 1);
  }

  section('Sandbox stays apart from real accounts');
  {
    const r = await login(await kpToken({ phone: '9812345678' }, { key: SANDBOX_KEY }), { origin: STAGING });
    const s = await exchange(r.json?.token_hash);
    check('a sandbox token for the same number gets a different account', r.status === 200 && r.json.environment === 'sandbox' && r.json.new_account === true && s.userId && s.userId !== prodUser, r.text);
    const profile = await one('select phone from public.users where id = $1', [s.userId]);
    check('the sandbox account does not carry the number on its profile', profile && profile.phone === null, JSON.stringify(profile));
    const again = await login(await kpToken({ phone: '9812345678' }, { key: SANDBOX_KEY }), { origin: STAGING });
    check('the sandbox number keeps its own sandbox account', (await exchange(again.json.token_hash)).userId === s.userId);
  }

  section('A number typed on a profile is never trusted');
  {
    const reader = USERS['reader@example.com'];
    check('the test customer has 9876543210 on their profile', (await one('select phone from public.users where id = $1', [reader.id])).phone === '9876543210');
    const r = await login(await kpToken({ phone: '9876543210' }));
    const s = await exchange(r.json?.token_hash);
    check('logging in with that number makes a new account, not theirs', r.status === 200 && r.json.new_account === true && s.userId !== reader.id, r.text);
  }

  section('Two logins with a new number at the same moment');
  {
    const before = Number((await one('select count(*) from auth.users')).count);
    const token = await kpToken({ phone: '7012345678' });
    const [a, b] = await Promise.all([login(token), login(token)]);
    const [sa, sb] = await Promise.all([exchange(a.json?.token_hash), exchange(b.json?.token_hash)]);
    check('both get in, to the same account', a.status === 200 && b.status === 200 && sa.userId && sa.userId === sb.userId, `${a.text} ${b.text}`);
    check('no spare account is left behind', Number((await one('select count(*) from auth.users')).count) === before + 1);
  }

  section('Limits');
  {
    const token = await kpToken({ phone: '6012345678' });
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await login(token)).status);
    check('10 logins for one number in 10 minutes are fine, the 11th waits', statuses.slice(0, 10).every((s) => s === 200) && statuses[10] === 429, statuses.join(','));
    const ip = '10.99.99.99';
    const fromOne = [];
    for (let i = 0; i < 31; i++) fromOne.push((await login('not-a-token', { ip })).status);
    check('30 tries from one address are fine, the 31st waits', fromOne.slice(0, 30).every((s) => s === 401) && fromOne[30] === 429, fromOne.join(','));
    const oldToken = await kpToken({ phone: '9812345678' }, { iat: Math.floor(Date.now() / 1000) - 7200 });
    check('an old token is accepted while no age limit is set', (await login(oldToken)).status === 200);
    check('...and refused with KWIKPASS_MAX_AGE_SECONDS=600', (await login(oldToken, { via: makeHandler({ tokens: { maxAgeSeconds: 600 } }) })).status === 401);
  }

  section('Linking a number to an account that is logged in (My Account)');
  {
    const reader = USERS['reader@example.com'];
    const readerSession = sessionFor('reader@example.com').access_token;
    const adminSession = sessionFor('admin@example.com').access_token;
    const link = (token, session, options = {}) => call('/link', { kp_token: token }, { session, ...options });
    const t1 = await kpToken({ phone: '9300000001' });
    check('linking needs a logged-in customer', (await link(t1, null)).status === 401 && (await link(t1, 'not-a-session')).status === 401);
    const before = Number((await one('select count(*) from auth.users')).count);
    const r = await link(t1, readerSession);
    check('a logged-in customer links a number they proved with an OTP', r.status === 200 && r.json?.phone === '9300000001' && r.json?.already_linked === false, r.text);
    const row = await one(`select user_id::text, linked_via, environment from public.phone_logins where phone = '9300000001'`);
    check('...recorded for their own account as account_link (production)', row?.user_id === reader.id && row?.linked_via === 'account_link' && row?.environment === 'production', JSON.stringify(row));
    check('...the verified number replaces the typed one on their profile', (await one('select phone from public.users where id = $1', [reader.id])).phone === '9300000001');
    check('...and no new account was made', Number((await one('select count(*) from auth.users')).count) === before);
    const viaLogin = await login(await kpToken({ phone: '9300000001' }));
    check('logging in with that number now opens their existing account', viaLogin.status === 200 && viaLogin.json.new_account === false && (await exchange(viaLogin.json.token_hash)).userId === reader.id, viaLogin.text);
    const again = await link(await kpToken({ phone: '9300000001' }), readerSession);
    check('linking the same number again is fine (already linked)', again.status === 200 && again.json?.already_linked === true);
    const other = await link(await kpToken({ phone: '9300000001' }), adminSession);
    check("another account cannot take a number that is already linked", other.status === 409 && /already belongs to another account/.test(other.json?.error));
    const second = await link(await kpToken({ phone: '9300000002' }), readerSession);
    check('an account cannot link a second number', second.status === 409 && /already has a different verified mobile number/.test(second.json?.error), second.text);
    check('a number made by mobile login cannot be linked to someone else', (await link(await kpToken({ phone: '9812345678' }), adminSession)).status === 409);
    const sandbox = await link(await kpToken({ phone: '9300000002' }, { key: SANDBOX_KEY }), adminSession, { origin: STAGING });
    const adminId = USERS['admin@example.com'].id;
    check('a sandbox link stays in the sandbox and leaves the profile alone', sandbox.status === 200 && (await one(`select environment from public.phone_logins where phone = '9300000002'`))?.environment === 'sandbox' && (await one('select phone from public.users where id = $1', [adminId])).phone === null, sandbox.text);
    const sandboxLogin = await login(await kpToken({ phone: '9300000002' }, { key: SANDBOX_KEY }), { origin: STAGING });
    check('...a sandbox login with it opens that account on the test shop', (await exchange(sandboxLogin.json?.token_hash)).userId === adminId);
    const prodLogin = await login(await kpToken({ phone: '9300000002' }));
    check('...but a live login with the same number does not', prodLogin.status === 200 && prodLogin.json.new_account === true && (await exchange(prodLogin.json.token_hash)).userId !== adminId);
    check('a link with a refused token is refused', (await link(await kpToken({ phone: '9300000003' }, { key: OTHER_KEY }), readerSession)).status === 401);
  }

  section('Database rules');
  {
    const reader = { role: 'authenticated', sub: USERS['reader@example.com'].id };
    const denied = async (who, sql) => {
      try {
        await asRole(db, who, (tx) => tx.query(sql));
        return false;
      } catch (error) {
        return /permission denied/.test(error.message);
      }
    };
    check('a signed-in customer cannot look numbers up', await denied(reader, `select * from public.kwikpass_account('production', '9812345678')`));
    check('...or link a number', await denied(reader, `select public.kwikpass_link_phone('production', '9812345678', '${reader.sub}', 'account_link')`));
    check('...or write to phone_logins', await denied(reader, `insert into public.phone_logins (environment, phone, user_id, linked_via) values ('production', '9000000000', '${reader.sub}', 'account_link')`));
    check('visitors cannot read phone_logins', await denied({ role: 'anon', sub: null }, 'select * from public.phone_logins'));
    const own = await asRole(db, { role: 'authenticated', sub: prodUser }, (tx) => tx.query('select phone from public.phone_logins'));
    const other = await asRole(db, reader, (tx) => tx.query('select phone from public.phone_logins'));
    check('a customer sees only their own verified number', own.rows.length === 1 && own.rows[0].phone === '9812345678' && other.rows.length === 1 && other.rows[0].phone === '9300000001', JSON.stringify({ own: own.rows, other: other.rows }));
    let refused = false;
    try {
      await db.query(`select public.kwikpass_link_phone('production', '9111111111', $1, 'account_link')`, [prodUser]);
    } catch (error) {
      refused = /already has a different verified mobile number/.test(error.message);
    }
    check('an account cannot get a second verified number', refused);
  }

  section('Logs');
  {
    const all = logs.join('\n');
    check('no log line holds a token, a key or a full number', !/\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./.test(all) && !all.includes(PROD_KEY) && !all.includes(SANDBOX_KEY) && !/9812345678|7012345678|6012345678/.test(all));
    check('each login is logged with its environment', logs.some((l) => l.includes('"event":"login"') && l.includes('"environment":"production"')) && logs.some((l) => l.includes('"environment":"sandbox"')));
  }
} catch (error) {
  check('suite ran without crashing', false, error?.stack ?? error);
} finally {
  supa.close();
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
