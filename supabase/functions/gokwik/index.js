// Supabase Edge Function "gokwik" (Deno). GoKwik's checkout talks to the store through
// this function: it reads the cart, sets the delivery address and places the order here,
// and its payment webhooks arrive here. Wires the handler to the database using secrets
// set in Supabase (never stored in this repository):
//
//   Our side (we make these up and give them to GoKwik):
//     GOKWIK_MERCHANT_API_TOKEN          access token GoKwik's production sends as
//                                        "Authorization: Bearer ..." (32+ characters)
//     GOKWIK_SANDBOX_MERCHANT_API_TOKEN  the same for GoKwik's sandbox (a different value:
//                                        orders placed with it are tests, never shipped)
//     GOKWIK_WEBHOOK_KEY                 secret in the webhook addresses (?key=..., 32+)
//
//   GoKwik's side (from GoKwik's onboarding mail):
//     GOKWIK_APP_ID, GOKWIK_APP_SECRET   one pair for sandbox and production alike
//                                        (GoKwik, 16 Nov 2026: only the merchant ids differ)
//     GOKWIK_MID, GOKWIK_SANDBOX_MID     the merchant id of each environment
//     GOKWIK_API_BASE_URL, GOKWIK_SANDBOX_API_BASE_URL
//                                        address of each environment's Update Order API
//   (app id, app secret and base URL are for GoKwik's Update Order API; without them
//   order updates and refunds wait in the queue.)
//
//   Optional:
//     GOKWIK_IP_CHECK                    "enforce": refuse calls from outside GoKwik's
//                                        addresses (config.js). Not set = only log them;
//                                        "off" = neither.
//     GOKWIK_DELIVERY_DAYS               e.g. "4-8": overrides the delivery estimate shown in GoKwik's
//                                        checkout. Not set = DEFAULT_DELIVERY_DAYS (config.js).
//
// The scheduled job's secret is the shipping function's (Vault, read through
// public.shipping_cron_secret(), service role only). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
// Deployed with JWT verification off at the gateway: GoKwik is not a Supabase user, and
// the handler checks every request itself.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { DEFAULT_DELIVERY_DAYS, LIMITS } from './config.js';
import { parseDeliveryDays } from './cart.js';
import { createGokwikApi } from './gokwik-api.js';
import { createHandler } from './handler.js';

const env = (name) => (Deno.env.get(name) ?? '').trim();

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

let cronSecretCache = '';
async function cronSecret() {
  if (!cronSecretCache) {
    const { data, error } = await db.rpc('shipping_cron_secret');
    if (!error && typeof data === 'string' && data.length >= 32) cronSecretCache = data;
  }
  return cronSecretCache;
}

// Asks the shipping function (which holds the courier logins) whether a PIN code can be
// delivered to. Throws when it cannot say; the handler then accepts the address.
async function checkPincode(pincode) {
  const secret = await cronSecret();
  if (!secret) throw new Error('no job secret');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.pincodeTimeoutMs);
  try {
    const res = await fetch(`${env('SUPABASE_URL')}/functions/v1/shipping`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cron-secret': secret },
      body: JSON.stringify({ action: 'service_pincode', pincode }),
      signal: controller.signal,
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error('pin check failed');
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

const environment = (prefix) => ({
  token: env(`${prefix}MERCHANT_API_TOKEN`),
  merchantId: env(`${prefix}MID`),
  api: createGokwikApi({
    baseUrl: env(`${prefix}API_BASE_URL`),
    appId: env('GOKWIK_APP_ID'),
    appSecret: env('GOKWIK_APP_SECRET'),
    timeoutMs: LIMITS.requestTimeoutMs,
  }),
});

const handle = createHandler({
  db,
  environments: { production: environment('GOKWIK_'), sandbox: environment('GOKWIK_SANDBOX_') },
  webhookKey: env('GOKWIK_WEBHOOK_KEY'),
  ipCheck: env('GOKWIK_IP_CHECK').toLowerCase() || 'log',
  cronSecret,
  checkPincode,
  deliveryDays: parseDeliveryDays(env('GOKWIK_DELIVERY_DAYS') || DEFAULT_DELIVERY_DAYS),
  log: console,
});

Deno.serve(handle);
