import { useRef } from 'react';
import { Link } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'motion/react';
import { useCart } from '../../hooks/useCart';
import { useCartLines } from '../../hooks/useCartLines';
import { formatPrice, plural } from '../../utils/format';
import { LoadError, StateBlock } from '../store/States';
import { ShoppingCart } from '@phosphor-icons/react';
import { LinesSkeleton } from '../store/Skeletons';
import { CloseIcon } from '../icons';
import CartLine from './CartLine';


// Slide-out cart opened from the header. Radix Dialog traps focus, closes on Escape
// or a click outside, and returns focus to whatever opened it.
function CartPanel() {
  const { ids } = useCart();
  const { cartOpen, setCartOpen, lines, totals, blocked, pending, data, loading, error, retry } = useCartLines();
  const saving = totals.mrp - totals.subtotal;
  const empty = ids.length === 0;
  const returnTo = useRef(null);
  const panel = useRef(null);

  return (
    <Dialog.Root open={cartOpen} onOpenChange={setCartOpen}>
      <AnimatePresence>
        {cartOpen && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="drawer-scrim"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: [0, 0, 0.2, 1] }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              forceMount
              aria-describedby={undefined}
              onOpenAutoFocus={(event) => {
                returnTo.current = document.activeElement;
                if (!returnTo.current?.matches(':focus-visible')) {
                  event.preventDefault();
                  panel.current?.focus();
                }
              }}
              onCloseAutoFocus={(event) => {
                // Return focus to what opened the panel, or to the header cart button when
                // that element is gone (for example a toast that has closed).
                event.preventDefault();
                const target = returnTo.current?.isConnected ? returnTo.current : document.querySelector('.cart-button');
                target?.focus();
              }}
            >
              <motion.div
                className="cart-panel" ref={panel} tabIndex={-1}
                onClick={(event) => {
                  // Any link inside the panel closes it, even one to the page already open.
                  if (event.target.closest('a')) setCartOpen(false);
                }}
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', stiffness: 340, damping: 36 }}
              >
                <div className="cart-panel-head">
                  <Dialog.Title className="cart-panel-title">Your cart</Dialog.Title>
                  {!empty && <span className="cart-panel-count">{plural(totals.count, 'item')}</span>}
                  <Dialog.Close asChild>
                    <button type="button" className="icon-button cart-close" aria-label="Close cart">
                      <CloseIcon />
                    </button>
                  </Dialog.Close>
                </div>

                {empty && (
                  <div className="cart-panel-empty">
                    <StateBlock title="Your cart is empty." description="Found a book you like? Add it to your cart and it will appear here." icon={ShoppingCart}>
                      <Link to="/books" className="btn btn-primary">Browse books</Link>
                    </StateBlock>
                  </div>
                )}

                {!empty && (
                  <div className="cart-panel-body">
                    {loading && !data && <LinesSkeleton count={Math.min(ids.length, 3)} label="Loading your cart…" />}
                    {error && <LoadError onRetry={retry} what="your cart" />}
                    {data && (
                      <ul className="line-list" aria-label="Books in your cart">
                        <AnimatePresence initial={false}>
                          {lines.map((line) => (
                            <CartLine key={line.id} line={line} compact />
                          ))}
                        </AnimatePresence>
                      </ul>
                    )}
                  </div>
                )}

                {!empty && data && (
                  <div className="cart-panel-foot">
                    {blocked && (
                      <p className="notice" data-tone="error" role="alert">
                        Remove the books that are no longer available to continue.
                      </p>
                    )}
                    <dl className="cart-panel-sum">
                      <div>
                        <dt>Subtotal</dt>
                        <dd>
                          <AnimatePresence mode="popLayout" initial={false}>
                            <motion.span
                              key={totals.subtotal}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.15 }}
                            >
                              {formatPrice(totals.subtotal)}
                            </motion.span>
                          </AnimatePresence>
                        </dd>
                      </div>
                      {saving > 0 && (
                        <div className="cart-panel-saving">
                          <dt>You save on MRP</dt>
                          <dd>{formatPrice(saving)}</dd>
                        </div>
                      )}
                    </dl>
                    {blocked || pending || totals.count === 0 ? (
                      <button type="button" className="btn btn-primary btn-block" aria-disabled="true">
                        Checkout
                      </button>
                    ) : (
                      <Link to="/checkout" className="btn btn-primary btn-block">
                        Checkout <span aria-hidden="true">•</span> {formatPrice(totals.subtotal)}
                      </Link>
                    )}
                    <div className="cart-panel-links">
                      <Link to="/books">Continue browsing</Link>
                      <Link to="/cart">View cart</Link>
                    </div>
                  </div>
                )}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

export default CartPanel;
