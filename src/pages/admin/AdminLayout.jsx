import { NavLink, Outlet } from 'react-router-dom';

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
        <NavLink to="/admin/bulk-upload" className="chip">
          Bulk upload
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}

export default AdminLayout;
