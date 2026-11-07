import { createPortal } from 'react-dom';

// Full-screen branded loader shown while the session is being restored, so pages
// never flash a signed-out state first. Rendered into <body> so animated page
// wrappers cannot offset it.
function Splash() {
  return createPortal(
    <div className="splash" role="status" aria-live="polite">
      <img src="/logo-192.png" alt="" width="72" height="72" />
      <div className="splash-bar" aria-hidden="true" />
      <span className="visually-hidden">Loading Kitaabaurkona…</span>
    </div>,
    document.body,
  );
}

export default Splash;
