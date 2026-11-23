import { Suspense, useRef, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowSquareOut, Books, House, List, Receipt, SignOut, Truck, UploadSimple, X } from '@phosphor-icons/react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import ErrorBoundary from '../components/ErrorBoundary';
import { PageSkeleton } from '../components/store/Skeletons';
import { LIVE_ORIGIN } from '../utils/release';
import '../styles/store.css';
import '../styles/admin.css';
import '../styles/admin-panel.css';

const SECTIONS = [
  { to: '/admin', label: 'Home', Icon: House, end: true },
  { to: '/admin/books', label: 'Books', Icon: Books },
  { to: '/admin/bulk-upload', label: 'Bulk upload', Icon: UploadSimple },
  {
    label: 'Orders',
    Icon: Receipt,
    children: [
      { to: '/admin/orders', label: 'Process orders', end: true },
      { to: '/admin/orders/failed-deliveries', label: 'Non-delivery report (NDR)' },
      { to: '/admin/orders/returns', label: 'RTO & returns' },
      { to: '/admin/orders/track', label: 'Track orders' },
      { to: '/admin/orders/new', label: 'Place order' },
    ],
  },
  { to: '/admin/shipping', label: 'Shipping', Icon: Truck },
];

function Brand() {
  return (
    <Link to="/admin" className="ap-brand" aria-label="Kitaab Aur Kona admin home">
      <img src="/images/brand/kitaab-aur-kona.svg" width="160" height="30" alt="" />
    </Link>
  );
}

// The menu itself: the same list on the left (large screens) and in the slide-out panel.
function Menu({ email, leaving, onSignOut, onNavigate }) {
  return (
    <>
      <nav className="ap-nav" aria-label="Admin sections">
        {SECTIONS.map(({ to, label, Icon, end, children }) =>
          children ? (
            <div key={label} className="ap-nav-group" role="group" aria-label={label}>
              <span className="ap-nav-link ap-nav-heading" aria-hidden="true">
                <Icon size={22} aria-hidden="true" />
                {label}
              </span>
              {children.map((child) => (
                <NavLink key={child.to} to={child.to} end={child.end} className="ap-nav-link ap-nav-sub" onClick={onNavigate}>
                  {child.label}
                </NavLink>
              ))}
            </div>
          ) : (
            <NavLink key={to} to={to} end={end} className="ap-nav-link" onClick={onNavigate}>
              <Icon size={22} aria-hidden="true" />
              {label}
            </NavLink>
          ),
        )}
      </nav>
      <div className="ap-side-foot">
        {email && <span className="ap-user">{email}</span>}
        <a className="ap-nav-link" href={LIVE_ORIGIN} target="_blank" rel="noopener noreferrer">
          <ArrowSquareOut size={22} aria-hidden="true" />
          Open the store
        </a>
        <button type="button" className="ap-nav-link" aria-busy={leaving} onClick={onSignOut}>
          {leaving ? <span className="spinner" aria-hidden="true" /> : <SignOut size={22} aria-hidden="true" />}
          Sign out
        </button>
      </div>
    </>
  );
}

// The frame around every admin page: the menu, who is signed in, a way to the store and
// a way out. The store's own header, footer and cart are not part of the admin site.
function AdminShell() {
  const { user, signOut } = useAuth();
  const { show } = useToast();
  const [leaving, setLeaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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

  // Opening a section from the slide-out menu closes it.
  const menu = <Menu email={user?.email} leaving={leaving} onSignOut={handleSignOut} onNavigate={() => setMenuOpen(false)} />;

  return (
    <div className="site admin-site ap">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="ap-side">
        <Brand />
        {menu}
      </aside>
      <header className="ap-top">
        <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Dialog.Trigger asChild>
            <button type="button" className="ap-icon-button" aria-label="Open menu">
              <List size={26} aria-hidden="true" />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="ap-drawer-overlay" />
            <Dialog.Content className="ap-drawer ap" aria-describedby={undefined}>
              <div className="ap-drawer-head">
                <Dialog.Title asChild>
                  <span className="visually-hidden">Menu</span>
                </Dialog.Title>
                <Brand />
                <Dialog.Close asChild>
                  <button type="button" className="ap-icon-button" aria-label="Close menu">
                    <X size={24} aria-hidden="true" />
                  </button>
                </Dialog.Close>
              </div>
              {menu}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <Brand />
      </header>
      <main id="main" className="ap-main" tabIndex={-1}>
        <div className="ap-content">
          <ErrorBoundary>
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

export default AdminShell;
