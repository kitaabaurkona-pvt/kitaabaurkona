import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useCart } from '../../hooks/useCart';
import { formatCount } from '../../utils/format';
import { BagIcon, SearchIcon, UserIcon } from '../icons';

function SiteHeader() {
  const { isAuthenticated, role } = useAuth();
  const { count } = useCart();

  return (
    <header className="site-header">
      <div className="container site-header-row">
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
            {count > 0 && (
              <span className="count-badge" aria-hidden="true">
                {count > 99 ? '99+' : formatCount(count)}
              </span>
            )}
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
