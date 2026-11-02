import { formatCurrency } from '../../utils/formatCurrency';
import { useCart } from '../../hooks/useCart';

/**
 * A single row item inside the Cart page.
 * @param {object} props
 * @param {object} props.item - Cart item ({ id, title, price, quantity }).
 */
function CartItem({ item }) {
  const { updateQuantity, removeItem } = useCart();

  return (
    <div>
      <span>{item.title}</span>
      <span>{formatCurrency(item.price)}</span>
      <input
        type="number"
        min="1"
        value={item.quantity}
        onChange={(e) => updateQuantity(item.id, Number(e.target.value))}
      />
      <span>{formatCurrency(item.price * item.quantity)}</span>
      <button onClick={() => removeItem(item.id)}>Remove</button>
    </div>
  );
}

export default CartItem;
