import { Link, NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useAuth } from '../../hooks/useAuth';
import { useCart } from '../../hooks/useCart';
import { formatCount } from '../../utils/format';
import { BagIcon, SearchIcon, UserIcon } from '../icons';
import MobileMenu from './MobileMenu';

function SiteHeader() {
  const { isAuthenticated, role } = useAuth();
  const { count } = useCart();

  return (
    <header className="site-header">
      <div className="container site-header-row">
        <MobileMenu />
        <Link to="/" className="brand">
          <img src="/logo-64.png" alt="" width="32" height="32" />
          <span>Kitaabaurkona</span>
        </Link>

        <nav className="desktop-nav" aria-label="Main">
          <NavLink to="/" end>
            Store
          </NavLink>
          <NavLink to="/books">Books</NavLink>
          <NavLink to="/offers">Offers</NavLink>
          <NavLink to="/wishlist">Wishlist</NavLink>
          <NavLink to="/orders">Orders</NavLink>
          {role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
        </nav>

        <div className="header-actions">
          <Link to="/books" state={{ focusSearch: true }} className="icon-button" aria-label="Search books">
            <SearchIcon />
          </Link>
          <Link to="/cart" className="icon-button" aria-label={`Cart, ${count} ${count === 1 ? 'item' : 'items'}`}>
            <BagIcon />
            <AnimatePresence>
              {count > 0 && (
                <motion.span
                  key="badge"
                  className="count-badge"
                  aria-hidden="true"
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.4, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                >
                  {/* Re-keyed on every change so the number pops, while the badge itself stays put */}
                  <motion.span
                    key={count}
                    className="count-badge-value"
                    initial={{ scale: 1.6 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 600, damping: 20 }}
                  >
                    {count > 99 ? '99+' : formatCount(count)}
                  </motion.span>
                </motion.span>
              )}
            </AnimatePresence>
          </Link>
          {isAuthenticated ? (
            <Link to="/account" className="icon-button" aria-label="Account">
              <UserIcon />
            </Link>
          ) : (
            <>
              <Link to="/sign-in" className="icon-button header-account-icon-guest" aria-label="Sign in">
                <UserIcon />
              </Link>
              <Link to="/sign-in" className="btn btn-dark btn-sm header-signin">
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default SiteHeader;
