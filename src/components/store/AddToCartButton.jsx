import { useEffect, useRef, useState } from 'react';
import { useCart } from '../../hooks/useCart';
import { announce } from '../../utils/announce';
import { MAX_QUANTITY } from '../../utils/storeForm';
import { CheckIcon, PlusIcon } from '../icons';

function AddToCartButton({ book, quantity = 1, className = 'btn btn-primary', label = 'Add to cart' }) {
  const { add, quantityOf } = useCart();
  const [justAdded, setJustAdded] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const limit = Math.min(book.stock_quantity, MAX_QUANTITY);
  const inCart = quantityOf(book.id);
  const soldOut = book.stock_quantity <= 0;
  const atLimit = !soldOut && inCart >= limit;
  const blocked = soldOut || atLimit;

  function handleClick() {
    if (blocked) return;
    add(book.id, quantity, limit);
    announce(`${book.title} added to cart`);
    setJustAdded(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setJustAdded(false), 1500);
  }

  let text = label;
  if (soldOut) text = 'Out of stock';
  else if (justAdded) text = 'Added';
  else if (atLimit) text = 'In cart';

  return (
    <button type="button" className={className} aria-disabled={blocked || undefined} onClick={handleClick}>
      {justAdded ? <CheckIcon size={18} /> : !blocked && <PlusIcon size={18} />}
      {text}
    </button>
  );
}

export default AddToCartButton;
