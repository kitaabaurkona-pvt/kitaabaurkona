// Which site this build is. One codebase builds two separate sites, and Vercel tells the
// build which git branch it is building (see vite.config.js):
//
//   main → the store,       https://www.kitaabaurkona.com
//   test → the admin panel, https://kitaabaurkona.vercel.app  (sign-in only, admins only)
//
//   staging → the test shop, https://kitaabaurkonastaging.bizwitheet.com  (GoKwik sandbox only)
//
// A local build or test run is the store unless it is started with --mode admin
// (npm run dev:admin, npm run build:admin) or --mode staging (npm run build:staging).

export const LIVE_ORIGIN = 'https://www.kitaabaurkona.com';
export const ADMIN_ORIGIN = 'https://kitaabaurkona.vercel.app';
export const STAGING_ORIGIN = 'https://kitaabaurkonastaging.bizwitheet.com';

// The test shop: the store's pages for trying GoKwik's sandbox checkout. It shares the
// live database, so it never offers the site's own cash-on-delivery checkout.
export const STAGING = import.meta.env.VITE_STAGING === 'true';

// The live store is "coming soon" until GoKwik checkout is ready: only accounts that
// already exist can use it, and sign-up is closed (components/ComingSoonGate.jsx).
export const COMING_SOON = import.meta.env.VITE_COMING_SOON === 'true';
const ADMIN_HOST = new URL(ADMIN_ORIGIN).hostname;

export const RELEASE = {
  branch: import.meta.env.VITE_RELEASE_BRANCH || '',
  env: import.meta.env.VITE_RELEASE_ENV || 'local',
  commit: import.meta.env.VITE_RELEASE_COMMIT || '',
};

export const SITE = import.meta.env.VITE_SITE === 'admin' ? 'admin' : 'store';

// Where this build belongs, when it is being shown somewhere else: the store opened on a
// Vercel address goes to the real domain, and the admin panel opened on one of Vercel's
// other addresses for its branch goes to its own address. Null otherwise (the right
// address, the store's own domain, local runs and other branches).
export function homeOrigin(hostname, release = RELEASE) {
  if (!hostname.endsWith('.vercel.app')) return null;
  if (release.branch === 'main') return LIVE_ORIGIN;
  if (release.branch === 'test' && hostname !== ADMIN_HOST) return ADMIN_ORIGIN;
  return null;
}
