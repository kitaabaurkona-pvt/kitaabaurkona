import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useCart } from '../../hooks/useCart';

/**
 * Navigation bar with links to all main routes, a mini-cart indicator,
 * and auth-aware sign-in/sign-out controls.
 */
function Navbar() {
  const { itemCount } = useCart();
  const { isAuthenticated, role, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/sign-in', { replace: true });
  }

  return (
    <nav>
      <Link to="/">Home</Link>
      <Link to="/products">Products</Link>
      {isAuthenticated && <Link to="/dashboard">Dashboard</Link>}
      {isAuthenticated && <Link to="/cart">Cart ({itemCount})</Link>}
      {isAuthenticated && <Link to="/profile">Profile</Link>}
      {role === 'admin' && <Link to="/admin">Admin</Link>}
      {isAuthenticated ? (
        <button type="button" onClick={handleSignOut}>
          Sign Out
        </button>
      ) : (
        <Link to="/sign-in">Sign In</Link>
      )}
    </nav>
  );
}

export default Navbar;
