import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/**
 * Blocks unauthenticated access to nested routes, redirecting to /sign-in
 * and remembering where the user was headed.
 */
function ProtectedRoute() {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/sign-in"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <Outlet />;
}

export default ProtectedRoute;
