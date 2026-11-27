// The kwikpass function's request handling, kept free of Deno-only code so it can be
// tested with Node. index.js wires it to Supabase.
//
// Called by the store's website only (CORS limits it to the store's addresses):
//   POST /login    { kp_token }  GoKwik's KwikPass token, from a correct OTP or from the
//                                "Login with 98xxxxxx34" button. Answers { token_hash }:
//                                a one-time code the website exchanges with Supabase Auth
//                                for a session (verifyOtp, type "email").
//   POST /link     { kp_token }  with the signed-in customer's session token as
//                                "Authorization: Bearer ...": the number in GoKwik's token
//                                joins that customer's account (My Account), so they can
//                                log in with it. Answers { phone }, or 409 with a reason.
//   POST /health                 which of GoKwik's keys are set (never the keys).
//
// The number comes only from inside the token, which only GoKwik can make; the website
// cannot choose which account it logs in to.

import { LIMITS } from './config.js';
import { claimNames, phoneFromClaims, TokenError } from './token.js';
import { LinkConflict } from './accounts.js';

// What the customer is told, by reason. Nothing says which check failed in a way that
// helps someone trying tokens.
const REFUSED = 'This login could not be completed. Please ask for a new OTP and try again.';
const MESSAGES = {
  expired: REFUSED,
  too_old: REFUSED,
  wrong_key: REFUSED,
  not_a_jwe: REFUSED,
  not_json: REFUSED,
  no_keys: 'Mobile number login is not available right now. Please log in with your email.',
};

function corsHeaders(origin, allowed) {
  if (!origin || !allowed.includes(origin)) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

// The caller's address as Supabase's gateway reports it (as in the gokwik function).
function callerAddress(req) {
  for (const name of ['cf-connecting-ip', 'x-real-ip']) {
    const value = (req.headers.get(name) || '').trim();
    if (value) return value.slice(0, 64);
  }
  const forwarded = (req.headers.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
  return forwarded.length ? forwarded[forwarded.length - 1].slice(0, 64) : 'unknown';
}

// db        service-role Supabase client (rate limits)
// accounts  createAccounts(db)
// tokens    createTokenReader(...)
// origins   websites allowed to call
export function createHandler({ db, accounts, tokens, origins, log = console }) {
  // true when the caller may go on. A failing counter lets the login through (logged):
  // the token check is the real protection, the limit only slows down guessing.
  async function withinLimit(bucket, { limit, windowSeconds }) {
    const { data, error } = await db.rpc('hit_rate_limit', { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds });
    if (error) {
      log.warn(JSON.stringify({ event: 'rate_limit_unavailable', bucket: bucket.split(':')[1] }));
      return true;
    }
    return data !== false;
  }

  return async function handle(req) {
    const started = Date.now();
    const ref = crypto.randomUUID().slice(0, 8);
    const origin = req.headers.get('origin');
    const cors = corsHeaders(origin, origins);
    const reply = (status, body) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(cors ?? {}) },
      });
    const fail = (status, error) => reply(status, { ok: false, error, ref });

    if (req.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
    if (req.method !== 'POST') return fail(405, 'Method not allowed');
    if (!cors) return fail(403, 'This site may not use mobile number login');

    const route = new URL(req.url).pathname.replace(/^.*\/kwikpass(?=\/|$)/, '').replace(/\/+$/, '') || '/';
    if (route === '/health') return reply(200, { ok: true, keys: tokens.configured });
    if (route !== '/login' && route !== '/link') return fail(404, 'Not found');

    try {
      // /link is for a signed-in customer only: their session token (sent by the website's
      // Supabase client) decides which account the number joins.
      let linkUser = null;
      if (route === '/link') {
        const session = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
        linkUser = await accounts.userOfSession(session);
        if (!linkUser) return fail(401, 'Please log in again, then verify your number.');
      }

      const declared = Number(req.headers.get('content-length') || 0);
      if (declared > LIMITS.bodyBytes) return fail(413, 'Request too large');
      const raw = await req.text();
      if (raw.length > LIMITS.bodyBytes) return fail(413, 'Request too large');
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return fail(400, 'Invalid JSON');
      }
      const token = typeof body?.kp_token === 'string' ? body.kp_token.trim() : '';
      if (!token) return fail(400, 'kp_token is missing');
      if (token.length > LIMITS.tokenChars) return fail(400, 'kp_token is too long');

      const ip = callerAddress(req);
      if (!(await withinLimit(`kwikpass:ip:${ip}`, LIMITS.perAddress))) return fail(429, 'Too many tries. Please wait a few minutes and try again.');

      let opened;
      try {
        opened = await tokens.read(token);
      } catch (error) {
        if (!(error instanceof TokenError)) throw error;
        log.warn(JSON.stringify({ event: 'token_refused', ref, reason: error.reason, length: token.length }));
        return fail(error.reason === 'no_keys' ? 503 : 401, MESSAGES[error.reason] ?? REFUSED);
      }

      const phone = phoneFromClaims(opened.payload);
      if (!phone) {
        // Field names only, so the right one can be added to token.js; never the values.
        log.warn(JSON.stringify({ event: 'no_phone_in_token', ref, environment: opened.environment, fields: claimNames(opened.payload) }));
        return fail(422, 'Only Indian (+91) mobile numbers can log in here. Please log in with your email.');
      }
      if (!(await withinLimit(`kwikpass:phone:${opened.environment}:${phone}`, LIMITS.perPhone))) {
        return fail(429, 'Too many logins for this number. Please wait a few minutes and try again.');
      }

      if (linkUser) {
        try {
          const linked = await accounts.link(opened.environment, phone, linkUser.id);
          log.info(JSON.stringify({ event: 'link', ref, environment: opened.environment, already: linked.alreadyLinked, ms: Date.now() - started }));
          return reply(200, { ok: true, phone, environment: opened.environment, already_linked: linked.alreadyLinked });
        } catch (error) {
          if (!(error instanceof LinkConflict)) throw error;
          log.warn(JSON.stringify({ event: 'link_refused', ref, environment: opened.environment }));
          return fail(409, error.message);
        }
      }

      const account = await accounts.findOrCreate(opened.environment, phone);
      const tokenHash = await accounts.signInCode(account.email);
      log.info(JSON.stringify({ event: 'login', ref, environment: opened.environment, new_account: account.created, ms: Date.now() - started }));
      return reply(200, { ok: true, token_hash: tokenHash, new_account: account.created, environment: opened.environment });
    } catch (error) {
      log.error(JSON.stringify({ event: 'login_failed', ref, error: String(error?.message ?? error).slice(0, 300) }));
      return fail(500, 'Mobile number login failed. Please try again, or log in with your email.');
    }
  };
}
