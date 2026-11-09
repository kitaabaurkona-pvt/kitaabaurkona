import { useCart } from '../../hooks/useCart';
import { useCartLines } from '../../hooks/useCartLines';
import { MAX_QUANTITY } from '../../utils/storeForm';

// Adds the book and slides the cart panel in from the right, like the previous store's
// "My Bag" panel. No pop-up message: the panel itself shows what was added.
function AddToCartButton({ book, quantity = 1, className = 'btn btn-primary', label = 'Add to cart' }) {
  const { add, quantityOf } = useCart();
  const { openCart } = useCartLines();

  const limit = Math.min(book.stock_quantity, MAX_QUANTITY);
  const inCart = quantityOf(book.id);
  const soldOut = book.stock_quantity <= 0;
  const atLimit = !soldOut && inCart >= limit;
  const blocked = soldOut || atLimit;

  function handleClick() {
    if (blocked) return;
    add(book.id, quantity, limit);
    openCart();
  }

  let text = label;
  if (soldOut) text = 'Out of stock';
  else if (atLimit) text = 'In cart';

  return (
    <button type="button" className={className} aria-disabled={blocked || undefined} onClick={handleClick}>
      {text}
    </button>
  );
}

export default AddToCartButton;
