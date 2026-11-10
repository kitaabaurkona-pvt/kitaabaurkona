// Which version of the store this is. Vercel tells the build which git branch it is
// building (see vite.config.js); a local build or test run has none.
//
//   main → the live store, https://www.kitaabaurkona.com
//   test → the test site,  https://kitaabaurkona.vercel.app
//
// Work goes to `test` first and reaches `main` only when the owner says to ship.

export const LIVE_ORIGIN = 'https://www.kitaabaurkona.com';
export const TEST_ORIGIN = 'https://kitaabaurkona.vercel.app';
const TEST_HOST = new URL(TEST_ORIGIN).hostname;

export const RELEASE = {
  branch: import.meta.env.VITE_RELEASE_BRANCH || '',
  env: import.meta.env.VITE_RELEASE_ENV || 'local',
  commit: import.meta.env.VITE_RELEASE_COMMIT || '',
};

export const isTestBuild = RELEASE.branch === 'test';

// Where this version belongs, when it is being shown somewhere else: the live store
// opened on a Vercel address goes to the real domain, and the test site opened on one
// of Vercel's other addresses for the branch goes to its own address. Null otherwise
// (the right address, the store's own domain, local runs and other branches).
export function homeOrigin(hostname, release = RELEASE) {
  if (!hostname.endsWith('.vercel.app')) return null;
  if (release.branch === 'main') return LIVE_ORIGIN;
  if (release.branch === 'test' && hostname !== TEST_HOST) return TEST_ORIGIN;
  return null;
}
