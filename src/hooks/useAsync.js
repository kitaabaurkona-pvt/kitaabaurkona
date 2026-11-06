import { useCallback, useEffect, useState } from 'react';

// Runs an async loader whenever `deps` change. Results of an outdated run are dropped,
// so fast navigation or typing never shows stale data.
export function useAsync(loader, deps) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, error: null, loading: true }));
    loader().then(
      (data) => {
        if (active) setState({ data, error: null, loading: false });
      },
      (error) => {
        if (active) setState({ data: undefined, error, loading: false });
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry, setData: (data) => setState((s) => ({ ...s, data })) };
}
