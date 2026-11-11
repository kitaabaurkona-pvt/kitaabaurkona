import { Suspense } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import FloatingCart from './FloatingCart';
import { PageSkeleton } from '../store/Skeletons';
import CartPanel from '../cart/CartPanel';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import '../../styles/store.css';
import '../../styles/reading-corner.css';
import '../../styles/bento-shop.css';
import '../../styles/storefront-motion.css';

function Layout() {
  const { pathname } = useLocation();
  const reduce = useReduceMotion();

  // Back returns to the exact spot on the previous page; new pages open at the top.
  useScrollMemory();

  return (
    <div className="site">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="site-main" tabIndex={-1}>
        {/* A short fade as each page comes in (none with Reduce animations). */}
        <motion.div key={pathname} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, ease: 'linear' }}>
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </motion.div>
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
      <FloatingCart />
      <CartPanel />
    </div>
  );
}

export default Layout;
