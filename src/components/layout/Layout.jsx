import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import { PageSkeleton } from '../store/Skeletons';
import '../../styles/store.css';

function Layout() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="site">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="site-main" tabIndex={-1}>
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </motion.div>
      </main>
      <SiteFooter />
    </div>
  );
}

export default Layout;
