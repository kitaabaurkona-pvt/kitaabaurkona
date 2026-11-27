import { Link, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { COMING_SOON } from '../utils/release';
import AuthShell from './auth/AuthShell';
import Splash from './Splash';

// While the live store is "coming soon" (until GoKwik checkout is ready), only accounts
// that already exist may use it. Everyone else sees this page. On by build only: the
// live store (branch main) and `npm run build -- --mode coming-soon`; see vite.config.js.
//
// This hides the shop; it is not a lock on the data (the catalogue is public anyway).

// Accounts made before this moment get in. Admins always do.
const ACCOUNTS_MADE_BEFORE = '2026-11-28T00:00:00Z';

// Open to everyone: signing in, password help, and the policy pages (payment partners
// check them on the live domain). /sign-up is listed so it can send people to /sign-in.
const OPEN_PATHS = new Set([
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/reset-password',
  '/terms',
  '/about',
  '/returns',
  '/shipping',
  '/privacy',
]);

function mayEnter(user, role) {
  if (!user) return false;
  if (role === 'admin') return true;
  const made = Date.parse(user.created_at ?? '');
  return Number.isFinite(made) && made < Date.parse(ACCOUNTS_MADE_BEFORE);
}

function ComingSoonPage({ user }) {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  async function logOut() {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <AuthShell title="Opening soon" subtitle="The store is not open to new accounts yet. We will let you in as soon as it opens.">
        <button type="button" className="btn-primary" onClick={logOut} aria-busy={busy}>
          {busy ? 'Logging out…' : 'Log out'}
        </button>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Opening soon" subtitle="Kitaab Aur Kona is getting ready. If you already have an account, you can log in.">
      <Link to="/sign-in" className="btn-primary coming-soon-login">
        Log in
      </Link>
    </AuthShell>
  );
}

function ComingSoonGate({ children }) {
  const { user, role, loading } = useAuth();
  const { pathname } = useLocation();
  if (!COMING_SOON || OPEN_PATHS.has(pathname)) return children;
  if (loading) return <Splash />;
  if (mayEnter(user, role)) return children;
  return <ComingSoonPage user={user} />;
}

export default ComingSoonGate;
