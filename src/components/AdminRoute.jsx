import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Splash from './Splash';

/**
 * The admin site's gate. Nothing inside is shown unless the signed-in user has role
 * 'admin' (read from the users table, which RLS restricts to the owning row). Anyone
 * else is sent to the sign-in page, which signs a non-admin out again and says why.
 */
function AdminRoute() {
  const { isAuthenticated, role, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Splash />;

  if (!isAuthenticated) {
    return <Navigate to="/sign-in" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  if (role !== 'admin') {
    return <Navigate to="/sign-in" replace />;
  }

  return <Outlet />;
}

export default AdminRoute;
