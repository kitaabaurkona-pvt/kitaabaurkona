import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'motion/react';
import { useAuth } from '../../hooks/useAuth';
import { useCart } from '../../hooks/useCart';
import { useWishlist } from '../../hooks/useWishlist';
import { usePreferences } from '../../hooks/usePreferences';
import { useToast } from '../../hooks/useToast';
import { useAsync } from '../../hooks/useAsync';
import { listCategories } from '../../services/bookService';
import { COLLECTIONS, UNDER_PRICE, categoryHref, orderCategories, regionalHref, underPriceHref } from '../../utils/categories';
import { POLICY_LINKS } from '../../content/policies';
import { formatPrice } from '../../utils/format';
import {
  BagIcon,
  BookIcon,
  BookmarkIcon,
  CloseIcon,
  LogoutIcon,
  MenuIcon,
  ReceiptIcon,
  SettingsIcon,
  ShieldIcon,
  StoreIcon,
  UploadIcon,
  UserIcon,
  ChevronDownIcon,
} from '../icons';

// Phone navigation: a menu button in the header opens this side panel. Radix Dialog
// traps focus inside, closes on Escape or a tap outside, and returns focus to the button.
function MobileMenu() {
  const [open, setOpen] = useState(false);
  const { user, isAuthenticated, role, signOut } = useAuth();
  const { count: cartCount } = useCart();
  const { count: savedCount } = useWishlist();
  const { dark, setTheme } = usePreferences();
  const { show } = useToast();
  const navigate = useNavigate();
  const close = () => setOpen(false);
  const categories = useAsync(() => listCategories(), []);

  const item = (to, label, Icon, { end = false, count = 0 } = {}) => (
    <NavLink to={to} end={end} className="drawer-link" onClick={close}>
      <Icon size={20} />
      {label}
      {count > 0 && <span className="count-pill">{count > 99 ? '99+' : count}</span>}
    </NavLink>
  );

  async function handleSignOut() {
    close();
    try {
      await signOut();
      navigate('/sign-in', { replace: true });
    } catch {
      show({ message: 'Could not sign out. Try again.', tone: 'error' });
    }
  }

  const name = user?.user_metadata?.full_name;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="icon-button menu-button" aria-label="Open menu">
          <MenuIcon />
        </button>
      </Dialog.Trigger>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="drawer-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="drawer"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <div className="drawer-head">
                  <Dialog.Title asChild>
                    <span className="brand">
                      <img src="/images/brand/emblem-transparent.png" alt="" width="28" height="28" />
                      <span>Menu</span>
                    </span>
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <button type="button" className="icon-button" aria-label="Close menu">
                      <CloseIcon />
                    </button>
                  </Dialog.Close>
                </div>

                <div className="drawer-section">
                  <div className="switch-row">
                    <span id="drawer-dark-label">Dark theme</span>
                    <button
                      type="button"
                      role="switch"
                      className="switch"
                      aria-checked={dark}
                      aria-labelledby="drawer-dark-label"
                      onClick={() => setTheme(dark ? 'light' : 'dark')}
                    />
                  </div>
                </div>

                {isAuthenticated && (
                  <p className="drawer-user">
                    {name && <strong>{name}</strong>}
                    {user?.email}
                  </p>
                )}

                <nav aria-label="Shop" className="drawer-section">
                  <h2>Shop</h2>
                  {item('/', 'Store', StoreIcon, { end: true })}
                  {item('/books', 'Browse books', BookIcon)}
                  {item('/cart', 'Cart', BagIcon, { count: cartCount })}
                </nav>

                {categories.data?.length > 0 && (
                  <details className="drawer-section drawer-categories">
                    <summary>Browse categories <ChevronDownIcon size={18}/></summary>
                    <nav aria-label="Categories" className="drawer-category-options">
                    {orderCategories(categories.data).map((name) => (
                      <Link key={name} to={categoryHref(name)} className="drawer-link drawer-link-plain" onClick={close}>
                        {name}
                      </Link>
                    ))}
                    <Link to={underPriceHref} className="drawer-link drawer-link-plain" onClick={close}>
                      Up to {formatPrice(UNDER_PRICE)}
                    </Link>
                    <Link to={regionalHref} className="drawer-link drawer-link-plain" onClick={close}>
                      {COLLECTIONS.regional.label}
                    </Link>
                    </nav>
                  </details>
                )}

                <nav aria-label="Your account" className="drawer-section">
                  <h2>Your account</h2>
                  {item('/wishlist', 'Wishlist', BookmarkIcon, { count: savedCount })}
                  {item('/orders', 'Orders', ReceiptIcon)}
                  {item('/account', 'Account', UserIcon)}
                  {item('/settings', 'Settings', SettingsIcon)}
                </nav>

                {role === 'admin' && (
                  <nav aria-label="Admin" className="drawer-section">
                    <h2>Admin</h2>
                    {item('/admin', 'Dashboard', ShieldIcon, { end: true })}
                    {item('/admin/books', 'Manage books', BookIcon)}
                    {item('/admin/orders', 'Manage orders', ReceiptIcon)}
                    {item('/admin/bulk-upload', 'Bulk upload', UploadIcon)}
                  </nav>
                )}

                <div className="drawer-section drawer-auth">
                  {isAuthenticated ? (
                    <button type="button" className="btn btn-outline btn-block" onClick={handleSignOut}>
                      <LogoutIcon size={18} />
                      Sign out
                    </button>
                  ) : (
                    <>
                      <NavLink to="/sign-in" className="btn btn-dark btn-block" onClick={close}>
                        Sign in
                      </NavLink>
                      <NavLink to="/sign-up" className="btn btn-outline btn-block" onClick={close}>
                        Create account
                      </NavLink>
                    </>
                  )}
                </div>

                <nav aria-label="Help" className="drawer-section">
                  <h2>Help</h2>
                  {POLICY_LINKS.map((link) => (
                    <NavLink key={link.to} to={link.to} className="drawer-link drawer-link-plain" onClick={close}>
                      {link.label}
                    </NavLink>
                  ))}
                </nav>




              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

export default MobileMenu;
