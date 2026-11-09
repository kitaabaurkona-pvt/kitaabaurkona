import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LinesSkeleton } from '../../components/store/Skeletons';

function AdminLayout() {
  return (
    <div className="container page">
      <div className="page-head">
        <h1 className="page-title">Admin</h1>
      </div>
      <nav className="admin-tabs" aria-label="Admin sections">
        <NavLink to="/admin" end className="chip">
          Dashboard
        </NavLink>
        <NavLink to="/admin/books" className="chip">
          Books
        </NavLink>
        <NavLink to="/admin/orders" className="chip">
          Orders
        </NavLink>
        <NavLink to="/admin/shipping" className="chip">
          Shipping
        </NavLink>
        <NavLink to="/admin/bulk-upload" className="chip">
          Bulk upload
        </NavLink>
      </nav>
      {/* Keeps the admin tabs on screen while the next section loads */}
      <Suspense fallback={<LinesSkeleton />}>
        <Outlet />
      </Suspense>
    </div>
  );
}

export default AdminLayout;
