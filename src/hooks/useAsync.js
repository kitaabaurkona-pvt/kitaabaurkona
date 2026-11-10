import { useCallback, useEffect, useRef, useState } from 'react';

// Results kept in memory for this visit, by key. Moving between screens shows them at
// once (no skeleton, no new request), so going back lands on the same page, at the same
// height, and the scroll position can be restored. Only public catalogue data is given
// a key; anything about the signed-in person is always loaded fresh.
const cache = new Map();
const MAX_ENTRIES = 80;
const DEFAULT_STALE_MS = 5 * 60 * 1000;

function remember(key, entry) {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

const cachedData = (key) => (key ? cache.get(key)?.data : undefined);

// Runs an async loader whenever `deps` change. Results of an outdated run are dropped,
// so fast navigation or typing never shows stale data.
//
// With `options.key`, the result is cached: a screen opened again within `staleMs`
// reuses it without a request; after that it is shown at once and refreshed quietly.
// Two components asking for the same key at the same time share one request.
export function useAsync(loader, deps, { key, staleMs = DEFAULT_STALE_MS } = {}) {
  const [state, setState] = useState(() => {
    const data = cachedData(key);
    return data === undefined ? { key, data: undefined, error: null, loading: true } : { key, data, error: null, loading: false };
  });
  const [attempt, setAttempt] = useState(0);
  const seenAttempt = useRef(attempt);

  useEffect(() => {
    let active = true;
    const forced = seenAttempt.current !== attempt;
    seenAttempt.current = attempt;
    const entry = key ? cache.get(key) : undefined;
    const hasData = entry?.data !== undefined;

    if (key && hasData && !forced && Date.now() - entry.at < staleMs) {
      setState({ key, data: entry.data, error: null, loading: false });
      return undefined;
    }

    if (key && hasData) {
      // Show what we have and refresh behind it, without a loading state.
      setState({ key, data: entry.data, error: null, loading: false });
    } else {
      setState((current) => ({ ...current, key, error: null, loading: true }));
    }

    let promise;
    if (key && entry?.promise && !forced) {
      promise = entry.promise;
    } else {
      promise = loader();
      if (key) {
        remember(key, { ...entry, promise });
        promise.then(
          (data) => {
            if (cache.get(key)?.promise === promise) remember(key, { data, at: Date.now() });
          },
          () => {
            const current = cache.get(key);
            if (current?.promise === promise) {
              if (current.data === undefined) cache.delete(key);
              else remember(key, { data: current.data, at: current.at });
            }
          },
        );
      }
    }

    promise.then(
      (data) => {
        if (active) setState({ key, data, error: null, loading: false });
      },
      (error) => {
        // A quiet refresh that fails keeps showing what was already there.
        if (active) setState((current) => (key && hasData ? current : { key, data: undefined, error, loading: false }));
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const setData = useCallback(
    (data) => {
      if (key && cache.has(key)) remember(key, { data, at: cache.get(key).at ?? Date.now() });
      setState((s) => ({ ...s, data }));
    },
    [key],
  );

  // Switching to a key that is already cached shows it in this very render, instead of
  // one frame of the previous screen's data or a skeleton.
  let view = state;
  if (key && state.key !== key) {
    const data = cachedData(key);
    view = data === undefined ? { ...state, error: null, loading: true } : { data, error: null, loading: false };
  }
  return { data: view.data, error: view.error, loading: view.loading, retry, setData };
}
