import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ShoppingCart } from '@phosphor-icons/react';
import { useCartLines } from '../../hooks/useCartLines';
import { useCartBadge } from '../../hooks/useCartBadge';
import { useReduceMotion } from '../../hooks/useReduceMotion';

// On wide screens the header scrolls away with the page (on phones it stays on top).
// While it is out of sight this small cart button waits in the top right corner, so the
// cart is always one click away and an added book has somewhere to fly to.
function FloatingCart() {
  const { pathname } = useLocation();
  const { cartOpen, openCart } = useCartLines();
  const badge = useCartBadge();
  const reduce = useReduceMotion();
  const [headerHidden, setHeaderHidden] = useState(false);

  useEffect(() => {
    // No header to watch (checkout has its own): stay hidden (see `show` below).
    const header = document.querySelector('.site-header');
    if (!header || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setHeaderHidden(!entry.isIntersecting));
    observer.observe(header);
    return () => observer.disconnect();
  }, [pathname]);

  const show = headerHidden && !cartOpen && pathname !== '/checkout';
  const label = `Cart, ${badge} ${badge === 1 ? 'item' : 'items'}`;

  return (
    <AnimatePresence>
      {show && (
        <motion.button
          type="button"
          className="floating-cart"
          aria-label={label}
          aria-haspopup="dialog"
          onClick={openCart}
          initial={reduce ? false : { opacity: 0, y: -12, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.92 }}
          transition={{ duration: 0.2, ease: [0.25, 0.8, 0.25, 1] }}
        >
          <motion.span
            key={badge}
            className="cart-icon-motion"
            initial={false}
            animate={{ scale: reduce || !badge ? 1 : [1, 1.18, 1], rotate: reduce || !badge ? 0 : [0, -7, 0] }}
            transition={{ duration: 0.32 }}
          >
            <ShoppingCart size={22} weight="regular" aria-hidden="true" />
          </motion.span>
          {badge > 0 && (
            <span className="floating-cart-count" aria-hidden="true">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

export default FloatingCart;
