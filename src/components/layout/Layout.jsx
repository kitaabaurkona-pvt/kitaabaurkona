import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import BottomNav from './BottomNav';
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
        <Outlet />
      </main>
      <SiteFooter />
      <BottomNav />
      <div id="live-region" className="visually-hidden" role="status" aria-live="polite" />
    </div>
  );
}

export default Layout;
