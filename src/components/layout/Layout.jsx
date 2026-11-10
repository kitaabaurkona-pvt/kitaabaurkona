import { Suspense } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { usePreferences } from '../../hooks/usePreferences';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import { PageSkeleton } from '../store/Skeletons';
import CartPanel from '../cart/CartPanel';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import '../../styles/store.css';
import '../../styles/reading-corner.css';
import '../../styles/bento-shop.css';
import '../../styles/storefront-motion.css';

function Layout() {
  const { pathname } = useLocation();
  const systemReduced = useReducedMotion();
  const { motion: preference } = usePreferences();
  const reduced = systemReduced || preference === 'reduce';

  useScrollMemory();

  return (
    <div className="site">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="site-main" tabIndex={-1}>
        <motion.div
          key={pathname}
          initial={reduced ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </motion.div>
      </main>
      {pathname==='/checkout' ? <footer className="checkout-footer container"><p>Kitaab Aur Kona</p><nav aria-label="Checkout help"><Link to="/shipping">Delivery</Link><Link to="/returns">Returns</Link><Link to="/privacy">Privacy</Link></nav></footer> : <SiteFooter />}
      <CartPanel />
    </div>
  );
}

export default Layout;
