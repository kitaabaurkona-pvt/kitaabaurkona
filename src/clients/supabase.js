// The Supabase client (sign-in, cart, orders, wishlist, admin) is a large library, so it
// is a separate file that starts loading as soon as the app starts but is never waited
// for by the first screen: public catalogue reads use services/publicRead.js instead.
// Every caller gets the same client. (If the file is gone after a release, main.jsx's
// vite:preloadError handler reloads the tab once.)
let client = null;

export function loadSupabase() {
  if (!client) {
    client = import('./supabaseClient').then((module) => module.supabase);
    // A failed download (a blip in the connection) is tried again on the next call.
    client.catch(() => {
      client = null;
    });
  }
  return client;
}
