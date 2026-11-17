import { supabase } from '../clients/supabase';
import { previewMode } from '../preview/mode';
import { unwrap } from './request';
import { STAGING } from '../utils/release';

// GoKwik's checkout (address, online payment and cash on delivery in one popup). It is
// on only where the site was built with a GoKwik merchant id:
//   VITE_GOKWIK_MID   the merchant id GoKwik gave (public, like the Supabase anon key)
//   VITE_GOKWIK_ENV   'production' for the live site; anything else means the sandbox
// Without a merchant id the site keeps its own checkout (cash on delivery).
// The website only starts the popup. Reading the cart, taking payment and placing the
// order all happen between GoKwik's servers and the `gokwik` Edge Function.
// The test shop (staging) is always the sandbox, whatever VITE_GOKWIK_ENV says.
const MID = (import.meta.env.VITE_GOKWIK_MID ?? '').trim();
const ENVIRONMENT = import.meta.env.VITE_GOKWIK_ENV === 'production' && !STAGING ? 'production' : 'sandbox';
const SDK_URL = ENVIRONMENT === 'production' ? 'https://pdp.gokwik.co/v4/build/gokwik.js' : 'https://sandbox.pdp.gokwik.co/v4/build/gokwik.js';
const LOAD_TIMEOUT_MS = 10000;

export const gokwikEnabled = !previewMode && /^[a-z0-9]{6,40}$/i.test(MID);

// Saves the books of this order as a checkout cart and returns its id. Only book ids and
// quantities are sent; the database prices the cart itself.
export async function createCheckoutCart(items) {
  const { data } = unwrap(
    await supabase.rpc('create_checkout_cart', {
      p_items: items.map(({ bookId, quantity }) => ({ book_id: bookId, quantity })),
      p_site: window.location.origin,
    }),
  );
  return data;
}

// The order made from a checkout cart of the signed-in customer (null until placed).
export async function getCheckoutCartOrder(cartId) {
  const { data } = unwrap(await supabase.rpc('checkout_cart_order', { p_cart: cartId }));
  return data ?? null;
}

// What the open checkout should do when GoKwik reports something. GoKwik's script keeps
// its listeners for the life of the page, so they are attached once and pass each event
// on to whichever checkout is open now.
let handlers = {};
let sdkPromise = null;

function loadSdk() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => fail(), LOAD_TIMEOUT_MS);
    function fail() {
      clearTimeout(timer);
      script.remove();
      sdkPromise = null;
      reject(new Error('GoKwik checkout could not be loaded'));
    }
    script.src = SDK_URL;
    script.async = true;
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      const sdk = window.gokwikSdk;
      if (!sdk || typeof sdk.initCheckout !== 'function') return fail();
      const listen = (event, name) => {
        try {
          sdk.on(event, (payload) => handlers[name]?.(payload));
        } catch {
          // an event this version of the script does not know
        }
      };
      listen('order-complete', 'onComplete');
      listen('checkout-close', 'onClose');
      listen('checkout-initiation-failure', 'onFailure');
      resolve(sdk);
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

// Opens GoKwik's checkout for a checkout cart. Rejects when GoKwik's script cannot be
// loaded, so the caller can fall back to the site's own checkout.
//   phone        the customer's mobile, to prefill GoKwik's sign-in
//   customerId   the customer's account id, passed as GoKwik's customerToken so GoKwik
//                can map the cart to the customer (GoKwik's mail of 17 Nov). It is the
//                same id the cart id starts with, never the customer's sign-in token.
//   nativeUrl    where GoKwik sends the customer if its checkout cannot start
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function openGokwikCheckout({ cartId, customerId, phone, nativeUrl, onComplete, onClose, onFailure }) {
  const sdk = await loadSdk();
  handlers = { onComplete, onClose, onFailure };
  sdk.initCheckout({
    environment: ENVIRONMENT,
    type: 'merchantInfo',
    mid: MID,
    ...(/^[6-9][0-9]{9}$/.test(phone ?? '') ? { phoneNumber: phone } : {}),
    merchantParams: { merchantCheckoutId: cartId, ...(UUID.test(customerId ?? '') ? { customerToken: customerId } : {}) },
    nativeCheckoutUrl: nativeUrl,
  });
}
