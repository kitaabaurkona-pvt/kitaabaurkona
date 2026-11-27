import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import BottomNav from './BottomNav';
import { PageSkeleton } from '../store/Skeletons';
import ErrorBoundary from '../ErrorBoundary';
import CartPanel from '../cart/CartPanel';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import '../../styles/store.css';
import '../../styles/reading-corner.css';
import '../../styles/bento-shop.css';
import '../../styles/storefront-motion.css';
import '../../styles/bottom-nav.css';

function Layout() {
  const { pathname, search, hash } = useLocation();
  const reduce = useReduceMotion();

  const isCheckout = pathname === '/checkout';
  const header = useRef(null);
  const searchInput = useRef(null);
  const [bottomNavVisible, setBottomNavVisible] = useState(false);

  useEffect(() => {
    if (isCheckout || !header.current) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      setBottomNavVisible(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
    });
    observer.observe(header.current);
    return () => observer.disconnect();
  }, [isCheckout]);

  // Back returns to the exact spot on the previous page; new pages open at the top.
  useScrollMemory();

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: reduce ? 'instant' : 'smooth' });
  }

  function handleHome(event) {
    if (pathname !== '/' || search || hash || event.button !== 0
      || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    scrollToTop();
  }

  function handleSearch() {
    searchInput.current?.focus({ preventScroll: true });
    scrollToTop();
  }

  return (
    <div className="site" data-store-nav={!isCheckout || undefined} data-bottom-nav={!isCheckout && bottomNavVisible || undefined}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader headerRef={header} searchInputRef={searchInput} />
      <main id="main" className="site-main" tabIndex={-1}>
        {/* A short fade as each page comes in (none with Reduce animations); .page-fade
            in storefront-motion.css. */}
        <div key={pathname} className={reduce ? undefined : 'page-fade'}>
          {/* A page that cannot be drawn or loaded shows a message here; the header,
              footer and every other page keep working. */}
          <ErrorBoundary>
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
      {pathname === '/checkout' ? (
        <footer className="checkout-footer container">
          <p>Kitaab Aur Kona</p>
          <nav aria-label="Checkout help">
            <Link to="/shipping">Delivery</Link>
            <Link to="/returns">Returns</Link>
            <Link to="/privacy">Privacy</Link>
          </nav>
        </footer>
      ) : (
        <SiteFooter />
      )}
      {!isCheckout && <BottomNav onHome={handleHome} onSearch={handleSearch} />}
      <CartPanel />
    </div>
  );
}

export default Layout;
