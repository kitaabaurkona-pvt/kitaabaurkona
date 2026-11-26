// Fixed settings for the kwikpass function. Nothing here is secret: GoKwik's KwikPass keys
// come from Supabase Edge Function secrets at run time.

// The websites that may log customers in through this function (the store's addresses,
// as in the gokwik and shipping functions). KWIKPASS_ALLOWED_ORIGINS replaces the list.
export const SITE_ORIGINS = [
  'https://www.kitaabaurkona.com',
  'https://kitaabaurkona.com',
  'https://kitaabaurkona-kitaabaurkona.vercel.app',
  'https://kitaabaurkonastaging.bizwitheet.com',
  'http://localhost:5199',
  'http://localhost:5200',
  'http://localhost:5173',
];

// Every Supabase account needs an email address. An account made by logging in with a
// mobile number gets a made-up one on this domain (no mail is ever sent there). The part
// before @ is random, so nobody can guess it and sign up with it first. The website hides
// these addresses (src/utils/mobileLogin.js has the same domain).
export const MOBILE_EMAIL_DOMAIN = 'mobile.kitaabaurkona.com';

export const LIMITS = {
  bodyBytes: 16 * 1024,
  // GoKwik's token is a few hundred characters; anything far longer is not one.
  tokenChars: 8192,
  // Logins from one address, and for one mobile number, per ten minutes.
  perAddress: { limit: 30, windowSeconds: 600 },
  perPhone: { limit: 10, windowSeconds: 600 },
};
