import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Splash from './Splash';

/**
 * Blocks access to nested routes unless the signed-in user has role 'admin'
 * (role is read from the users table, which RLS restricts to the owning row).
 */
function AdminRoute() {
  const { isAuthenticated, role, loading } = useAuth();

  if (loading) return <Splash />;

  if (!isAuthenticated) {
    return <Navigate to="/sign-in" replace />;
  }

  if (role !== 'admin') {
    return <Navigate to="/403" replace />;
  }

  return <Outlet />;
}

export default AdminRoute;
