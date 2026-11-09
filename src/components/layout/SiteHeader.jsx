import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useAuth } from '../../hooks/useAuth';
import { useCart } from '../../hooks/useCart';
import { useCartLines } from '../../hooks/useCartLines';
import { useAsync } from '../../hooks/useAsync';
import { listCategories } from '../../services/bookService';
import {
  COLLECTIONS,
  FICTION,
  NON_FICTION,
  UNDER_PRICE,
  categoryHref,
  dealsHref,
  regionalHref,
  underPriceHref,
} from '../../utils/categories';
import { formatCount, formatPrice } from '../../utils/format';
import { BagIcon, BookmarkIcon, SearchIcon, UserIcon } from '../icons';
import MobileMenu from './MobileMenu';
import NavMenu from './NavMenu';

const toLinks = (names) => names.map((name) => ({ to: categoryHref(name), label: name }));

// Store header like the previous store: search on the left, the logo in the middle,
// account, wishlist and bag on the right, and an UPPERCASE nav row underneath
// (tablets and up). Phones get the menu button and a search icon instead.
function SiteHeader() {
  const { isAuthenticated, role } = useAuth();
  const { count } = useCart();
  const { cartOpen, openCart } = useCartLines();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [term, setTerm] = useState('');
  const categories = useAsync(() => listCategories(), []);

  // Before the category list arrives, offer the known ones; afterwards only those with books.
  const present = (names) => (categories.data ? names.filter((name) => categories.data.includes(name)) : names);
  const activeCategory = pathname === '/books' ? new URLSearchParams(search).get('category') : null;

  function handleSearch(event) {
    event.preventDefault();
    const q = term.trim().slice(0, 100);
    navigate(q ? `/books?q=${encodeURIComponent(q)}` : '/books', { state: { focusSearch: !q } });
    setTerm('');
  }

  const categoryLink = (name, text) => (
    <Link to={categoryHref(name)} className="nav-link" aria-current={activeCategory === name ? 'page' : undefined}>
      {text}
    </Link>
  );

  const more = [
    { to: dealsHref, label: 'Biggest discounts' },
    { to: underPriceHref, label: `Up to ${formatPrice(UNDER_PRICE)}` },
    { to: regionalHref, label: COLLECTIONS.regional.label },
    ...toLinks(present(['Biography & Memoir', 'Mythology & History'])),
    { to: '/books', label: 'All books' },
    { to: '/orders', label: 'Orders' },
    ...(role === 'admin' ? [{ to: '/admin', label: 'Admin' }] : []),
  ];

  return (
    <header className="site-header">
      <div className="container header-top">
        <div className="header-left">
          <MobileMenu />
          <form className="header-search" role="search" onSubmit={handleSearch}>
            <label htmlFor="header-search" className="visually-hidden">
              Search books by title
            </label>
            <SearchIcon size={20} />
            <input
              id="header-search"
              type="search"
              placeholder="Search"
              maxLength={100}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
          </form>
          <Link to="/books" state={{ focusSearch: true }} className="icon-button header-search-icon" aria-label="Search books">
            <SearchIcon />
          </Link>
        </div>

        <Link to="/" className="brand-logo" aria-label="Kitaabaurkona home">
          <img src="/logo-192.png" alt="" width="56" height="56" />
        </Link>

        <div className="header-right">
          <Link
            to={isAuthenticated ? '/account' : '/sign-in'}
            className="icon-button header-account"
            aria-label={isAuthenticated ? 'Account' : 'Sign in'}
          >
            <UserIcon />
          </Link>
          <Link to="/wishlist" className="icon-button header-wishlist" aria-label="Wishlist">
            <BookmarkIcon />
          </Link>
          <button
            type="button"
            className="icon-button cart-button"
            aria-label={`Cart, ${count} ${count === 1 ? 'item' : 'items'}`}
            aria-haspopup="dialog"
            aria-expanded={cartOpen}
            onClick={openCart}
          >
            <BagIcon />
            {count > 0 && (
              <motion.span
                key={`count-${count}`}
                className="cart-count"
                aria-hidden="true"
                initial={{ scale: 0.6 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 18 }}
              >
                {count > 99 ? '99+' : formatCount(count)}
              </motion.span>
            )}
          </button>
        </div>
      </div>

      <nav className="header-nav" aria-label="Main">
        <div className="container header-nav-row">
          <NavLink to="/" end className="nav-link">
            Home
          </NavLink>
          <NavMenu label="Fiction" links={toLinks(present(FICTION))} current={FICTION.includes(activeCategory)} />
          <NavMenu
            label="Non-fiction"
            links={toLinks(present(NON_FICTION))}
            current={NON_FICTION.includes(activeCategory)}
          />
          {categoryLink('Self-Help', 'Self-Help')}
          {categoryLink('Money & Business', 'Money & Business')}
          {categoryLink('Box Sets & Combos', 'Box Sets')}
          <NavMenu label="More" links={more} />
        </div>
      </nav>
    </header>
  );
}

export default SiteHeader;
