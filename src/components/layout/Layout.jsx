import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import AnnouncementBar from './AnnouncementBar';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import { PageSkeleton } from '../store/Skeletons';
import CartPanel from '../cart/CartPanel';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import '../../styles/store.css';

function Layout() {
  const { pathname } = useLocation();
  // Back returns to the exact spot on the previous page; new pages open at the top.
  useScrollMemory();

  return (
    <div className="site">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <AnnouncementBar />
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
      <SiteFooter />
      <CartPanel />
    </div>
  );
}

export default Layout;
