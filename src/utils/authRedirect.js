// Supabase reports failed Google sign-ins and expired email links by redirecting back
// with `error` parameters in the URL. They are read once at start-up, turned into one
// of our own messages (the server's free text is never displayed, so a crafted link
// cannot put arbitrary text on the page) and removed from the address bar.

const MESSAGES = {
  otp_expired: 'This link has expired or was already used. Request a new one.',
  access_denied: 'Sign-in was cancelled or denied. Try again.',
  bad_oauth_state: 'Sign-in could not be verified. Start again from the sign-in page.',
  bad_oauth_callback: 'Google sign-in could not be completed. Try again.',
  provider_email_needs_verification: 'Confirm your email address first: check your inbox for the link, then try again.',
  email_not_confirmed: 'Confirm your email address first: check your inbox for the link, then try again.',
  user_banned: 'This account is not allowed to sign in.',
  signup_disabled: 'New sign-ups are turned off right now.',
  unexpected_failure: 'Sign-in failed on the server. Try again in a moment.',
  server_error: 'Sign-in failed on the server. Try again in a moment.',
};

const ERROR_KEYS = ['error', 'error_code', 'error_description', 'sb'];
let pending = null;

export function captureAuthRedirectError() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const read = (key) => hash.get(key) ?? url.searchParams.get(key);
  const error = read('error');
  if (!error) return;

  const code = read('error_code');
  const safe = (value) => (value && /^[a-z_]{1,40}$/.test(value) ? value : null);
  const key = safe(code) ?? safe(error);
  pending = MESSAGES[key] ?? `Sign-in did not complete${key ? ` (${key})` : ''}. Try again.`;
  if (import.meta.env.DEV) console.warn('[auth] redirect error', { error, code, description: read('error_description') });

  for (const k of ERROR_KEYS) {
    hash.delete(k);
    url.searchParams.delete(k);
  }
  const rest = hash.toString();
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${rest ? `#${rest}` : ''}`);
}

export function takeAuthRedirectError() {
  const message = pending;
  pending = null;
  return message;
}
