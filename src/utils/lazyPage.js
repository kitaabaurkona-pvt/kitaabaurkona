import { lazy } from 'react';

// Pages are separate script files, loaded when first opened. Two things can make such a
// file fail to load: a blip in the connection, or a new version of the site having been
// released while this tab was open (the old files are then gone from the server).
// Either way the page must never end up blank:
//   1. the file is asked for once more;
//   2. if that fails too, the tab is reloaded once, which fetches the current version
//      and lands on the page the visitor was opening (the address has already changed);
//   3. if a reload did not help a moment ago, the error is passed on and the page shows
//      a message with a Reload button (components/ErrorBoundary.jsx).

const RELOAD_KEY = 'kitaab_reloaded_at';
const RELOAD_GAP_MS = 60 * 1000;
let reloading = false;

// Reloads the tab, at most once a minute so a real outage cannot cause a reload loop.
// Returns true when a reload is under way.
export function reloadOnce() {
  if (reloading) return true;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_GAP_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Without storage the reload cannot be limited to once, so it is not done.
    return false;
  }
  reloading = true;
  window.location.reload();
  return true;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Keeps the page's loading skeleton on screen while the tab reloads.
const never = () => new Promise(() => {});

export function lazyPage(load) {
  return lazy(async () => {
    try {
      return await load();
    } catch {
      if (reloading) return never();
      try {
        await wait(400);
        return await load();
      } catch (error) {
        if (reloadOnce()) return never();
        throw error;
      }
    }
  });
}
