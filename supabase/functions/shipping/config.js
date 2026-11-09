// Fixed settings for the shipping function. Nothing here is secret: the Xpressbees login
// and the cron secret come from Supabase Edge Function secrets at run time.

// The only host this function ever sends requests to.
export const XPRESSBEES_BASE_URL = 'https://shipment.xpressbees.com';

// Label and manifest PDFs are only accepted (stored or shown) from Xpressbees' file host.
export const FILE_URL = /^https:\/\/xb-files\.s3\.amazonaws\.com\/[A-Za-z0-9._/-]+$/;

// Sites allowed to call the function from a browser.
export const DEFAULT_ORIGINS = ['https://kitaabaurkona.vercel.app', 'http://localhost:5199', 'http://localhost:5200', 'http://localhost:5173'];

export const LIMITS = {
  bodyBytes: 32 * 1024,
  requestTimeoutMs: 15000,
  pinChecksPerUserPerHour: 20,
  pinChecksPerIpPerHour: 60,
  adminActionsPerMinute: 60,
  trackRefreshMinutes: 10,
  backgroundTrackMinutes: 110,
  bookBatch: 10,
  pinCacheMinutes: 24 * 60,
  manifestOrders: 50,
  ndrItems: 100,
};

// Parcel used for the checkout PIN check (one typical book).
export const PIN_CHECK_PARCEL = { weight: 500, length: 22, breadth: 15, height: 5, order_amount: 500 };
