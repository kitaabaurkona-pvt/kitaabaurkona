import { useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ADMIN_ORIGIN } from '../../utils/release';
import { isMobileLoginEmail } from '../../utils/mobileLogin';
import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, m } from 'motion/react';
import { useAuth } from '../../hooks/useAuth';
import { useCart } from '../../hooks/useCart';
import { useWishlist } from '../../hooks/useWishlist';
import { usePreferences } from '../../hooks/usePreferences';
import { useToast } from '../../hooks/useToast';
import { POLICY_LINKS } from '../../content/policies';
import {
  BagIcon,
  BookIcon,
  BookmarkIcon,
  CloseIcon,
  LogoutIcon,
  ReceiptIcon,
  SettingsIcon,
  ShieldIcon,
  StoreIcon,
  UserIcon,
} from '../icons';

// Phone navigation: the menu button in the header (MobileMenu.jsx) opens this side
// panel, which is loaded the first time it is needed. Radix Dialog traps focus inside,
// closes on Escape or a tap outside, and focus goes back to the menu button.
function MobileMenuPanel({ open, setOpen, pointerOpen, menuButton }) {
  const panel = useRef(null);
  const { user, isAuthenticated, role, signOut } = useAuth();
  const { count: cartCount } = useCart();
  const { count: savedCount } = useWishlist();
  const { dark, setTheme } = usePreferences();
  const { show } = useToast();
  const navigate = useNavigate();
  const close = () => setOpen(false);

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
  // Mobile number login accounts have a made-up email address: show the number instead.
  const contact = isMobileLoginEmail(user?.email) ? (user?.user_metadata?.phone ? `+91 ${user.user_metadata.phone}` : null) : user?.email;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <m.div className="drawer-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined} onOpenAutoFocus={(event) => {
              // A touch opening should focus the dialog, not draw a ring around its X.
              if (pointerOpen.current) { event.preventDefault(); panel.current?.focus(); }
            }} onCloseAutoFocus={(event) => {
              event.preventDefault();
              menuButton.current?.focus();
            }}>
              <m.div
                className="drawer" ref={panel} tabIndex={-1}
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <div className="drawer-head">
                  <Dialog.Title asChild>
                    <span className="brand">
                      <img src="/images/brand/emblem-header.webp" alt="" width="28" height="28" />
                      <span>Menu</span>
                    </span>
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <button type="button" className="icon-button menu-close" aria-label="Close menu">
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
                    {contact}
                  </p>
                )}

                <nav aria-label="Shop" className="drawer-section">
                  <h2>Shop</h2>
                  {item('/', 'Store', StoreIcon, { end: true })}
                  {item('/books', 'Browse books', BookIcon)}
                  {item('/cart', 'Cart', BagIcon, { count: cartCount })}
                </nav>

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
                    <a href={ADMIN_ORIGIN} className="drawer-link" target="_blank" rel="noopener noreferrer" onClick={close}>
                      <ShieldIcon size={20} />
                      Open admin panel
                    </a>
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




              </m.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

export default MobileMenuPanel;
