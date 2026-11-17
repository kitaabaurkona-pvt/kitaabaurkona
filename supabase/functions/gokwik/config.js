// Fixed settings for the gokwik function. Nothing here is secret: GoKwik's keys and our
// own access token come from Supabase Edge Function secrets at run time.

// The store's addresses (the same list as the shipping function's DEFAULT_ORIGINS). The
// link back to an order after payment only ever points at one of these.
export const SITE_ORIGINS = [
  'https://www.kitaabaurkona.com',
  'https://kitaabaurkona.com',
  'https://kitaabaurkona-kitaabaurkona.vercel.app',
  'https://kitaabaurkona.vercel.app',
  'https://kitaabaurkonastaging.bizwitheet.com',
  'http://localhost:5199',
  'http://localhost:5200',
  'http://localhost:5173',
];
export const LIVE_SITE = 'https://www.kitaabaurkona.com';

// Shown for a book that has no cover image (GoKwik needs an image link for every item).
export const PLACEHOLDER_IMAGE = `${LIVE_SITE}/logo-192.png`;

// The addresses GoKwik's servers call from (GoKwik's mail of 16 Nov 2026). A call with
// the sandbox token must come from the sandbox address, one with the production token
// from a production address; webhooks from any of them.
export const GOKWIK_IPS = {
  sandbox: ['13.200.124.145'],
  production: ['3.108.114.222', '52.66.34.242', '13.127.239.196', '65.1.24.196'],
};

// GoKwik's own API (Update Order) is only ever called on a GoKwik host.
export const GOKWIK_API_HOST = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.gokwik\.(co|io|in)$/;

// The delivery estimate shown in GoKwik's checkout (owner, 2026-11-17), in days. The
// GOKWIK_DELIVERY_DAYS secret overrides it without a new deploy.
export const DEFAULT_DELIVERY_DAYS = '3-7';

// The store has one way of delivering: free, by courier.
export const SHIPPING_METHOD = { id: 'free_delivery', title: 'Free delivery', price: 0, currency: 'INR', shipping_type: 'standard' };

export const LIMITS = {
  bodyBytes: 64 * 1024,
  // An abandoned-cart notice carries many carts at once.
  webhookBodyBytes: 1024 * 1024,
  requestTimeoutMs: 15000,
  pincodeTimeoutMs: 8000,
  updateBatch: 20,
  abandonedCarts: 500,
};

export const TRANSACTION_EVENTS = ['transaction.successful', 'transaction.failure', 'transaction.auto_refund'];
export const REFUND_EVENTS = ['refund.successful', 'refund.failure', 'refund.pending', 'refund.initiated'];
