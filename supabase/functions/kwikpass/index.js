// Supabase Edge Function "kwikpass" (Deno): mobile number login through GoKwik's KwikPass.
// The website gets a token from GoKwik after a correct OTP and sends it here; this
// function opens it with GoKwik's secret key and signs the customer in. Secrets (set in
// Supabase, never stored in this repository):
//
//   KWIKPASS_SANDBOX_KEY       GoKwik's KwikPass secret key for the sandbox (test shop)
//   KWIKPASS_KEY               the same for production (live store)
//   (either may be missing; tokens are only accepted for the keys that are set)
//
//   Optional:
//     KWIKPASS_ALLOWED_ORIGINS   comma-separated website addresses (replaces config.js)
//     KWIKPASS_MAX_AGE_SECONDS   refuse tokens older than this, when they say their age
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
// Deployed with JWT verification off at the gateway: visitors who are not signed in call
// it, and the token from GoKwik is the proof.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import * as jose from 'npm:jose@6.2.17';
import { SITE_ORIGINS } from './config.js';
import { createAccounts } from './accounts.js';
import { createHandler } from './handler.js';
import { createTokenReader } from './token.js';

const env = (name) => (Deno.env.get(name) ?? '').trim();

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const origins = env('KWIKPASS_ALLOWED_ORIGINS')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const handle = createHandler({
  db,
  accounts: createAccounts(db),
  tokens: createTokenReader({
    keys: { production: env('KWIKPASS_KEY'), sandbox: env('KWIKPASS_SANDBOX_KEY') },
    jose,
    maxAgeSeconds: Number(env('KWIKPASS_MAX_AGE_SECONDS')) || 0,
  }),
  origins: origins.length ? origins : SITE_ORIGINS,
  log: console,
});

Deno.serve(handle);
