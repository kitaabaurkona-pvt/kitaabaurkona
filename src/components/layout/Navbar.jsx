import { Link } from 'react-router-dom';
import { useCart } from '../../hooks/useCart';

/**
 * Navigation bar with links to all main routes and a mini-cart indicator.
 */
function Navbar() {
  const { itemCount } = useCart();

  return (
    <nav>
      <Link to="/">Dashboard</Link>
      <Link to="/products">Products</Link>
      <Link to="/cart">Cart ({itemCount})</Link>
      <Link to="/checkout">Checkout</Link>
      <Link to="/profile">Profile</Link>
      <Link to="/login">Login</Link>
    </nav>
  );
}

export default Navbar;
