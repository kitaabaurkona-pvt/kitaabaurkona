import { Suspense, useRef, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import ErrorBoundary from '../components/ErrorBoundary';
import { PageSkeleton } from '../components/store/Skeletons';
import { LIVE_ORIGIN } from '../utils/release';
import '../styles/store.css';
import '../styles/reading-corner.css';
import '../styles/bento-shop.css';
import '../styles/storefront-motion.css';
import '../styles/admin.css';

// The frame around every admin page: who is signed in, a way to the store and a way out.
// The store's own header, footer and cart are not part of the admin site.
function AdminShell() {
  const { user, signOut } = useAuth();
  const { show } = useToast();
  const [leaving, setLeaving] = useState(false);
  const busy = useRef(false);

  // Signing out sends the browser back to the sign-in page (AdminRoute sees to that).
  async function handleSignOut() {
    if (busy.current) return;
    busy.current = true;
    setLeaving(true);
    try {
      await signOut();
    } catch {
      show({ message: 'Could not sign out. Try again.', tone: 'error' });
      busy.current = false;
      setLeaving(false);
    }
  }

  return (
    <div className="site admin-site">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="admin-bar">
        <div className="container admin-bar-inner">
          <Link to="/admin" className="admin-bar-brand" aria-label="Kitaab Aur Kona admin home">
            <img src="/images/brand/kitaab-aur-kona-dark.svg" width="230" height="44" alt="" />
          </Link>
          <div className="admin-bar-actions">
            {user?.email && <span className="admin-bar-user">{user.email}</span>}
            <a className="admin-bar-button" href={LIVE_ORIGIN} target="_blank" rel="noopener noreferrer">
              Open the store
            </a>
            <button type="button" className="admin-bar-button" data-kind="solid" aria-busy={leaving} onClick={handleSignOut}>
              {leaving && <span className="spinner" aria-hidden="true" />}
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="site-main" tabIndex={-1}>
        <ErrorBoundary>
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default AdminShell;
