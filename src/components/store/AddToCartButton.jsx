import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useCart } from '../../hooks/useCart';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { MAX_QUANTITY } from '../../utils/storeForm';
import { coverFrom, flyToCart } from '../../utils/flyToCart';

// The size and look of the stepper follow the button it replaces, so nothing around
// it moves when a book is added.
function stepperClass(className) {
  const has = (name) => className.split(/\s+/).includes(name);
  return ['cart-stepper', has('btn-block') && 'is-block', has('btn-card') && 'is-card', has('btn-quiet') && 'is-quiet']
    .filter(Boolean)
    .join(' ');
}

// "Add to cart" adds one copy and sends the cover flying into the header cart; the
// cart panel stays closed so the shopper keeps their place. From then on the button
// is a − count + stepper for that book, and taking the last copy out turns it back.
function AddToCartButton({ book, className = 'btn btn-primary', label = 'Add to cart' }) {
  const { add, setQuantity, quantityOf } = useCart();
  const reduce = useReduceMotion();
  const ref = useRef(null);
  const focusAfter = useRef(null);

  const limit = Math.min(book.stock_quantity, MAX_QUANTITY);
  const inCart = quantityOf(book.id);
  const soldOut = book.stock_quantity <= 0;
  const atLimit = inCart >= limit;
  const showStepper = inCart > 0;

  // Which way the number slides: up when adding, down when taking away.
  const [shown, setShown] = useState(inCart);
  const [direction, setDirection] = useState(1);
  if (shown !== inCart) {
    setDirection(inCart > shown ? 1 : -1);
    setShown(inCart);
  }

  // The button and the stepper swap places; keep keyboard focus on the new control.
  useEffect(() => {
    const want = focusAfter.current;
    focusAfter.current = null;
    if (!want || !ref.current) return;
    const next = want === 'stepper' ? (ref.current.querySelector('[data-step="up"]:not([aria-disabled])') ?? ref.current.querySelector('[data-step="down"]')) : ref.current;
    next?.focus({ preventScroll: true });
  }, [showStepper]);

  function increase(event) {
    if (soldOut || atLimit) return;
    if (inCart === 0) focusAfter.current = 'stepper';
    add(book.id, 1, limit);
    if (!reduce) flyToCart(coverFrom(event.currentTarget));
  }

  function decrease() {
    if (inCart === 1) focusAfter.current = 'button';
    setQuantity(book.id, inCart - 1);
  }

  if (!showStepper) {
    return (
      <button ref={ref} type="button" className={className} aria-disabled={soldOut || undefined} onClick={increase}>
        {soldOut ? 'Out of stock' : label}
      </button>
    );
  }

  return (
    <div ref={ref} className={stepperClass(className)} role="group" aria-label={`${book.title}, in your cart`}>
      <button type="button" data-step="down" aria-label={inCart === 1 ? 'Remove from cart' : 'Remove one copy'} onClick={decrease}>
        <span aria-hidden="true">−</span>
      </button>
      <span className="cart-stepper-count" aria-live="polite" aria-atomic="true">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.span
            key={inCart}
            className="cart-stepper-number"
            custom={direction}
            variants={{
              enter: (d) => ({ y: d * 14, opacity: 0 }),
              center: { y: 0, opacity: 1 },
              exit: (d) => ({ y: d * -14, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2, ease: [0.25, 0.8, 0.25, 1] }}
          >
            {inCart}
          </motion.span>
        </AnimatePresence>
        <span className="visually-hidden"> in cart</span>
      </span>
      <button
        type="button"
        data-step="up"
        aria-label="Add one more copy"
        aria-disabled={soldOut || atLimit || undefined}
        title={atLimit && !soldOut ? (limit < MAX_QUANTITY ? `Only ${limit} in stock` : `Up to ${limit} per order`) : undefined}
        onClick={increase}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

export default AddToCartButton;
