// Accounts made by logging in with a mobile number (GoKwik KwikPass) get a made-up email
// address on this domain, because every Supabase account needs one. No mail goes there,
// so the website shows the mobile number instead and hides these addresses.
// Keep in step with MOBILE_EMAIL_DOMAIN in supabase/functions/kwikpass/config.js.
export const MOBILE_EMAIL_DOMAIN = 'mobile.kitaabaurkona.com';

export function isMobileLoginEmail(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith(`@${MOBILE_EMAIL_DOMAIN}`);
}
