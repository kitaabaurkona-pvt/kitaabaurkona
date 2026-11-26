import { loadSupabase } from '../clients/supabase';
import { previewMode } from '../preview/mode';
import { SITE, STAGING } from '../utils/release';

// Mobile number login through GoKwik's KwikPass. It is on only where the site was built
// with a KwikPass merchant id:
//   VITE_KWIKPASS_MID   the merchant id GoKwik gave for KwikPass (public)
//   VITE_KWIKPASS_ENV   'production' for the live site; anything else means the sandbox
// The test shop (staging) is always the sandbox. The admin panel never loads it.
//
// How a login works: GoKwik's script sends the OTP and checks it. When the OTP is right it
// gives us a sealed token (kpToken) holding the number. The `kwikpass` Edge Function opens
// it with GoKwik's secret key and answers with a one-time code, which Supabase Auth turns
// into a normal session. The website never decides which account it logs in to.
const MID = (import.meta.env.VITE_KWIKPASS_MID ?? '').trim();
const ENVIRONMENT = import.meta.env.VITE_KWIKPASS_ENV === 'production' && !STAGING ? 'production' : 'sandbox';
const SDK_URL =
  ENVIRONMENT === 'production'
    ? 'https://pdp.gokwik.co/kwikpass/plugin/build/kp-custom-merchant.js'
    : 'https://sandbox.pdp.gokwik.co/kwikpass/plugin/build/kp-custom-merchant.js';
const LOAD_TIMEOUT_MS = 15000;

export const kwikpassEnabled = !previewMode && SITE === 'store' && /^[a-z0-9]{6,40}$/i.test(MID);

const GENERIC = 'Mobile number login is not working right now. Please try again, or log in with your email.';

function instance() {
  const sdk = window.__KP_LOGIN_SDK_INSTANCE__;
  return sdk && typeof sdk.kpSendOTP === 'function' ? sdk : null;
}

// GoKwik asks for its merchant details on the page before its script, on every page, so
// this runs once when the site starts (main.jsx) and again on demand. Later calls reuse it.
let sdkPromise = null;
export function startKwikpass() {
  if (!kwikpassEnabled) return Promise.reject(new Error('Mobile number login is off on this site'));
  if (sdkPromise) return sdkPromise;
  window.merchantInfo = { ...window.merchantInfo, environment: ENVIRONMENT, mid: MID, type: 'merchantInfo' };
  sdkPromise = new Promise((resolve, reject) => {
    const ready = instance();
    if (ready) return resolve(ready);
    const script = document.createElement('script');
    const timer = setTimeout(() => fail(), LOAD_TIMEOUT_MS);
    function fail() {
      clearTimeout(timer);
      script.remove();
      sdkPromise = null;
      reject(new Error('GoKwik login could not be loaded'));
    }
    script.src = SDK_URL;
    script.async = true;
    script.dataset.kwikpass = 'sdk';
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      const sdk = instance();
      if (!sdk) return fail();
      window.dispatchEvent(new CustomEvent('kp-script-loaded'));
      resolve(sdk);
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

// GoKwik answers { status, body, message }: 200 is success, 400 a problem the customer can
// fix (wrong or expired OTP), anything else an error whose message is shown as it is.
function outcome(answer) {
  const status = Number(answer?.status);
  const message = typeof answer?.message === 'string' && answer.message.trim() ? answer.message.trim().slice(0, 200) : '';
  return { ok: status === 200, status, message };
}

// Sends a 4-digit OTP to the number (10 digits, no +91).
export async function sendLoginOtp(phone) {
  let sdk;
  try {
    sdk = await startKwikpass();
  } catch {
    return { ok: false, message: GENERIC };
  }
  try {
    const answer = await sdk.kpSendOTP(phone);
    if (!answer || typeof answer !== 'object') return { ok: false, message: GENERIC };
    const result = outcome(answer);
    return result.ok ? result : { ...result, message: result.message || GENERIC };
  } catch {
    return { ok: false, message: GENERIC };
  }
}

// Checks the OTP and, when it is right, returns GoKwik's sealed token for the number.
export async function verifyLoginOtp(phone, otp) {
  let sdk;
  try {
    sdk = await startKwikpass();
  } catch {
    return { ok: false, message: GENERIC };
  }
  try {
    const answer = await sdk.kpVerifyOTP({ phone, otp });
    // GoKwik's script answers nothing when its own call failed (it swallows the error).
    if (!answer || typeof answer !== 'object') return { ok: false, message: GENERIC };
    const result = outcome(answer);
    const kpToken = answer?.body?.data?.kpToken ?? answer?.body?.kpToken ?? answer?.data?.kpToken ?? '';
    if (result.ok && typeof kpToken === 'string' && kpToken) return { ...result, kpToken };
    if (result.ok) return { ok: false, message: GENERIC };
    return { ...result, message: result.message || 'That OTP did not work. Please try again.' };
  } catch {
    return { ok: false, message: GENERIC };
  }
}

// Signs the customer in with GoKwik's sealed token (from an OTP or the one-tap button).
// Throws an Error whose message can be shown to the customer.
export async function signInWithKpToken(kpToken) {
  const supabase = await loadSupabase();
  const { data, error } = await supabase.functions.invoke('kwikpass/login', { body: { kp_token: kpToken } });
  if (error) {
    let message = GENERIC;
    try {
      const body = await error.context?.json?.();
      if (typeof body?.error === 'string' && body.error) message = body.error;
    } catch {
      // no readable answer: keep the general message
    }
    throw new Error(message);
  }
  if (!data?.token_hash) throw new Error(GENERIC);
  const { error: sessionError } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: 'email' });
  if (sessionError) throw new Error(GENERIC);
  return { newAccount: Boolean(data.new_account) };
}

// GoKwik asks that every logout on the site also logs out of KwikPass, or the next OTP
// does not work. Safe to call when the script never loaded.
export function kwikpassLogout() {
  try {
    window.__KP_LOGIN_SDK_INSTANCE__?.handleKPLogout?.();
  } catch {
    // GoKwik's script failed: the site's own logout has already happened
  }
}
