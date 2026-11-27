import { BookmarkSimple, House, MagnifyingGlass, ShoppingCart } from '@phosphor-icons/react';
import { NavLink, useMatch } from 'react-router-dom';
import { useCartBadge } from '../../hooks/useCartBadge';
import { useCartLines } from '../../hooks/useCartLines';
import MobileMenu from './MobileMenu';

export default function BottomNav({ onHome, onSearch }) {
  const count = useCartBadge();
  const { cartOpen, openCart } = useCartLines();
  const onCartPage = useMatch('/cart');

  return (
    <nav className="bottom-nav" aria-label="Store navigation">
      <NavLink to="/" end className="bottom-nav-item" onClick={onHome}>
        <House size={23} aria-hidden="true" />
        <span>Home</span>
      </NavLink>
      <button type="button" className="bottom-nav-item" onClick={onSearch}>
        <MagnifyingGlass size={23} aria-hidden="true" />
        <span>Search</span>
      </button>
      <NavLink to="/wishlist" className="bottom-nav-item">
        <BookmarkSimple size={23} aria-hidden="true" />
        <span>Wishlist</span>
      </NavLink>
      <button
        type="button"
        className="bottom-nav-item bottom-nav-cart"
        aria-label={`Cart, ${count} ${count === 1 ? 'item' : 'items'}`}
        aria-current={onCartPage ? 'page' : undefined}
        aria-haspopup="dialog"
        aria-expanded={cartOpen}
        onClick={openCart}
      >
        <span className="bottom-nav-cart-icon" aria-hidden="true">
          <ShoppingCart size={23} />
          {count > 0 && <span className="bottom-nav-count">{count > 99 ? '99+' : count}</span>}
        </span>
        <span>Cart</span>
      </button>
      <MobileMenu bottomNav />
    </nav>
  );
}
