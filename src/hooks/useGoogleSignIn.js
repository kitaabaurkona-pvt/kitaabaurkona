import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { oauthErrorMessage } from '../utils/authForm';

const REDIRECT_TIMEOUT_MS = 8000;

export function useGoogleSignIn(nextPath) {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const busyRef = useRef(false);
  const timerRef = useRef(null);

  const settle = useCallback(() => {
    clearTimeout(timerRef.current);
    busyRef.current = false;
    setBusy(false);
  }, []);

  // Coming back to the page with the Back button restores it from the browser cache,
  // so a stale "busy" state has to be cleared or the button would stay stuck.
  useEffect(() => {
    const onPageShow = (event) => {
      if (event.persisted) settle();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      clearTimeout(timerRef.current);
    };
  }, [settle]);

  const start = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle(nextPath);
      // The browser is now leaving for Google. If that navigation is blocked or
      // stopped, recover instead of leaving the button stuck.
      timerRef.current = setTimeout(settle, REDIRECT_TIMEOUT_MS);
    } catch (err) {
      settle();
      setError(oauthErrorMessage(err));
    }
  }, [nextPath, settle, signInWithGoogle]);

  return { busy, error, start };
}
