import { Link, NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useAuth } from '../../hooks/useAuth';
import { useCart } from '../../hooks/useCart';
import { useCartLines } from '../../hooks/useCartLines';
import { formatCount, formatPrice } from '../../utils/format';
import { BagIcon, SearchIcon, UserIcon } from '../icons';
import MobileMenu from './MobileMenu';

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.15 },
};

function SiteHeader() {
  const { isAuthenticated, role } = useAuth();
  const { count } = useCart();
  const { totals, data, loading, cartOpen, openCart } = useCartLines();
  // The count is instant (it lives in this browser); the subtotal waits for fresh prices
  // so it never shows a figure worked out from an older cart.
  const showSubtotal = count > 0 && Boolean(data) && !loading;
  const label = `Cart, ${count} ${count === 1 ? 'item' : 'items'}${showSubtotal ? `, subtotal ${formatPrice(totals.subtotal)}` : ''}`;

  return (
    <header className="site-header">
      <div className="container site-header-row">
        <MobileMenu />
        <Link to="/" className="brand">
          <img src="/logo-64.png" alt="" width="28" height="28" />
          <span>Kitaabaurkona</span>
        </Link>

        <nav className="desktop-nav" aria-label="Main">
          <NavLink to="/" end>
            Store
          </NavLink>
          <NavLink to="/books">Books</NavLink>
          <NavLink to="/wishlist">Wishlist</NavLink>
          <NavLink to="/orders">Orders</NavLink>
          {role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
        </nav>

        <div className="header-actions">
          <Link to="/books" state={{ focusSearch: true }} className="icon-button" aria-label="Search books">
            <SearchIcon />
          </Link>
          {isAuthenticated ? (
            <Link to="/account" className="icon-button header-account" aria-label="Account">
              <UserIcon />
            </Link>
          ) : (
            <Link to="/sign-in" className="header-signin">
              Sign in
            </Link>
          )}
          <button
            type="button"
            className="cart-button"
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={cartOpen}
            onClick={openCart}
          >
            <BagIcon size={20} />
            <span className="cart-count" aria-hidden="true" data-empty={count === 0 || undefined}>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={count} {...fade}>
                  {count > 99 ? '99+' : formatCount(count)}
                </motion.span>
              </AnimatePresence>
            </span>
            {showSubtotal && (
              <span className="cart-subtotal" aria-hidden="true">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span key={totals.subtotal} {...fade}>
                    {formatPrice(totals.subtotal)}
                  </motion.span>
                </AnimatePresence>
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

export default SiteHeader;
