// Fixed settings for the shipping function. Nothing here is secret: the Xpressbees login
// comes from Supabase Edge Function secrets and the cron secret from Vault, at run time.

// The only host this function ever sends requests to.
export const XPRESSBEES_BASE_URL = 'https://shipment.xpressbees.com';

// Label and manifest PDFs are only accepted (stored or shown) from Xpressbees' file host.
export const FILE_URL = /^https:\/\/xb-files\.s3\.amazonaws\.com\/[A-Za-z0-9._/-]+$/;

// Sites allowed to call the function from a browser: the live store (www, plus the bare
// domain, which redirects to it), Vercel's own address for the live store, the test site
// (Vercel free domain on the `test` branch) and local development.
export const DEFAULT_ORIGINS = [
  'https://www.kitaabaurkona.com',
  'https://kitaabaurkona.com',
  'https://kitaabaurkona-kitaabaurkona.vercel.app',
  'https://kitaabaurkona.vercel.app',
  'http://localhost:5199',
  'http://localhost:5200',
  'http://localhost:5173',
];

export const LIMITS = {
  bodyBytes: 32 * 1024,
  requestTimeoutMs: 15000,
  pinChecksPerUserPerHour: 20,
  pinChecksPerIpPerHour: 60,
  adminActionsPerMinute: 60,
  // Opening an order page asks Xpressbees again once its last answer is 2 minutes old;
  // the background job (every 15 minutes) refreshes every parcel on the move.
  trackRefreshMinutes: 2,
  backgroundTrackMinutes: 14,
  bookBatch: 10,
  pinCacheMinutes: 24 * 60,
  manifestOrders: 50,
  ndrItems: 100,
};

// Parcel used for the checkout PIN check (one typical book).
export const PIN_CHECK_PARCEL = { weight: 500, length: 22, breadth: 15, height: 5, order_amount: 500 };
