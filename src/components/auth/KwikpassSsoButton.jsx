import { useEffect, useState } from 'react';
import { showSsoButton, signInWithKpToken, SSO_CONTAINER_ID, SSO_LOGO, ssoTokenOf } from '../../services/kwikpassService';

// GoKwik's one-tap login button ("Login with 98xxxxxx34 · Powered by KwikPass"). GoKwik
// draws it only for a visitor it already knows (logged in on another GoKwik shop);
// for everyone else the box stays empty and takes no space. Its text, masked number and
// logo are GoKwik's and must not be changed or hidden. Shown only to visitors who are not
// logged in, and only while mounted does a press log anyone in.
export default function KwikpassSsoButton({ className = '', errorClassName = '' }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    showSsoButton().catch(() => {});

    async function onSso(event) {
      const token = ssoTokenOf(event);
      if (!active) return;
      if (!token) {
        setError('That quick login has expired. Please log in with your mobile number.');
        return;
      }
      setError(null);
      setBusy(true);
      try {
        await signInWithKpToken(token);
        // The page moves on (or re-renders without this button) once the session starts.
      } catch (err) {
        if (active) {
          setError(err.message);
          setBusy(false);
        }
      }
    }
    window.addEventListener('kwikpass-sso', onSso);
    return () => {
      active = false;
      window.removeEventListener('kwikpass-sso', onSso);
    };
  }, []);

  return (
    <>
      <div id={SSO_CONTAINER_ID} logo={SSO_LOGO} className={`kp-sso ${className}`.trim()} aria-busy={busy || undefined} />
      {error && (
        <p className={errorClassName} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
