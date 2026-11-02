import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';

/**
 * Root layout wrapper.
 * Renders the persistent Navbar and an Outlet for the active page.
 */
function Layout() {
  return (
    <>
      <Navbar />
      <Outlet />
    </>
  );
}

export default Layout;
