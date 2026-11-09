// Supabase Edge Function "shipping" (Deno). Wires the handler to the database and to
// Xpressbees using secrets set in Supabase (never stored in this repository):
//   XPRESSBEES_EMAIL, XPRESSBEES_PASSWORD  Xpressbees account login
//   SHIPPING_CRON_SECRET                   shared with the scheduled jobs (pg_cron)
//   SHIPPING_ALLOWED_ORIGINS               optional, comma-separated site addresses
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
// Deployed with JWT verification off at the gateway: the handler checks every request
// itself (user token via Supabase Auth, or the cron secret).

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { DEFAULT_ORIGINS, LIMITS, XPRESSBEES_BASE_URL } from './config.js';
import { createHandler } from './handler.js';
import { createXpressbees } from './xpressbees.js';

const env = (name) => Deno.env.get(name) ?? '';

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const tokenStore = {
  async get() {
    const { data } = await db.rpc('xb_token_get');
    return Array.isArray(data) && data[0]?.token ? data[0].token : null;
  },
  async set(token, expiresAt) {
    await db.rpc('xb_token_set', { p_token: token, p_expires_at: expiresAt.toISOString() });
  },
};

const origins = env('SHIPPING_ALLOWED_ORIGINS')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o));

const handle = createHandler({
  db,
  cronSecret: env('SHIPPING_CRON_SECRET'),
  allowedOrigins: origins.length ? origins : DEFAULT_ORIGINS,
  makeXpressbees: () =>
    createXpressbees({
      baseUrl: XPRESSBEES_BASE_URL,
      email: env('XPRESSBEES_EMAIL'),
      password: env('XPRESSBEES_PASSWORD'),
      tokenStore,
      timeoutMs: LIMITS.requestTimeoutMs,
    }),
});

Deno.serve(handle);
