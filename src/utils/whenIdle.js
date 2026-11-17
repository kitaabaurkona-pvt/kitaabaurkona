// Runs `task` once the page has finished loading and the browser has a quiet moment, so
// fetching code a visitor may need soon (the cart panel, the phone menu) never competes
// with what the first screen needs. Returns a function that cancels it.
export function whenIdle(task, timeout = 4000) {
  let cancelled = false;
  let handle = 0;
  const run = () => {
    if (cancelled) return;
    if (typeof window.requestIdleCallback === 'function') handle = window.requestIdleCallback(task, { timeout });
    else handle = setTimeout(task, 1500);
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', run);
    if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle);
    clearTimeout(handle);
  };
}
