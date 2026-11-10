import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// Remembers how far down each page in the history was scrolled. Going back (or
// forward) returns to that exact spot; opening a new page starts at the top. Changing
// filters on the same page (which replaces the address) keeps the place.
//
// Positions are kept per history entry for this tab (sessionStorage), so they also
// survive a reload. Pages draw from cached data (useAsync keys), so the content is
// already the right height when the position is restored; if it is still growing, the
// restore keeps trying for a moment and stops as soon as the visitor scrolls themselves.

const STORAGE_KEY = 'kitaab_scroll_v1';
const MAX_ENTRIES = 60;
const positions = new Map();
// How each entry was reached, for "Continue shopping" on the cart page.
const arrivals = new Map();
// The page on screen in the store layout (null while it is not mounted, e.g. on sign-in).
let shownPath = null;

try {
  const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
  if (Array.isArray(saved)) {
    for (const [key, y] of saved.slice(-MAX_ENTRIES)) {
      if (typeof key === 'string' && Number.isFinite(y) && y >= 0) positions.set(key, y);
    }
  }
} catch {
  // Storage can be unavailable; positions are then remembered for this page load only.
}

function persist() {
  while (positions.size > MAX_ENTRIES) positions.delete(positions.keys().next().value);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...positions]));
  } catch {
    // ignore
  }
}

function record(key, y) {
  positions.delete(key);
  positions.set(key, Math.max(0, Math.round(y)));
}

const scrollToY = (y) => window.scrollTo({ top: y, left: 0, behavior: 'instant' });

function restore(y) {
  let stopped = false;
  let frame = 0;
  const started = performance.now();
  const inputs = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    inputs.forEach((name) => window.removeEventListener(name, stop));
  };
  inputs.forEach((name) => window.addEventListener(name, stop, { passive: true }));
  const attempt = () => {
    if (stopped) return;
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    scrollToY(Math.min(y, max));
    if (max >= y || performance.now() - started > 2000) stop();
    else frame = requestAnimationFrame(attempt);
  };
  attempt();
  return stop;
}

// The page the current entry was opened from, when it was opened with a normal link
// (so the browser's previous entry is that page). Null otherwise.
export function previousPage(key) {
  return arrivals.get(key) ?? null;
}

export function useScrollMemory() {
  const { key, pathname } = useLocation();
  const type = useNavigationType();
  const current = useRef(key);

  // Noted while rendering (the layout renders before the page inside it), so the cart
  // page can already read it. Writing it again on a second render changes nothing.
  if (type === 'PUSH' && shownPath && shownPath !== pathname && !arrivals.has(key)) {
    arrivals.set(key, shownPath);
    while (arrivals.size > MAX_ENTRIES) arrivals.delete(arrivals.keys().next().value);
  }

  useLayoutEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    return () => {
      shownPath = null;
    };
  }, []);

  // Place the page: back/forward restores, a new page starts at the top.
  useLayoutEffect(() => {
    const from = shownPath;
    current.current = key;
    shownPath = pathname;
    if (type === 'POP' && positions.has(key)) return restore(positions.get(key));
    if (type === 'REPLACE' && from === pathname) return undefined;
    if (from !== pathname || type === 'PUSH') scrollToY(0);
    return undefined;
  }, [key, pathname, type]);

  // Note the position of this entry as the visitor scrolls.
  useEffect(() => {
    // A scroll caused by the next page replacing this one is not this page's position.
    const onScroll = () => {
      if (current.current === key) record(key, window.scrollY);
    };
    const onHide = () => {
      if (current.current === key) record(key, window.scrollY);
      persist();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', onHide);
      persist();
    };
  }, [key]);
}
