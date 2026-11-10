import { Suspense } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import { PageSkeleton } from '../store/Skeletons';
import CartPanel from '../cart/CartPanel';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import '../../styles/store.css';
import '../../styles/reading-corner.css';
import '../../styles/bento-shop.css';

function Layout() {
  const { pathname } = useLocation();

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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.12, ease: 'linear' }}
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
