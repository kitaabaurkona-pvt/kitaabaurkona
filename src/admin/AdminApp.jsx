// The admin site: a sign-in page and the admin panel, nothing else. Every address that is
// not one of these leads to the panel, which leads to the sign-in page until an admin has
// signed in. The database enforces admin-only access to the data as well (RLS and
// is_admin()), and the shipping function checks the role on every request.

import { Navigate, Route, Routes } from 'react-router-dom';
import { lazyPage } from '../utils/lazyPage';
import AdminRoute from '../components/AdminRoute';
import ForgotPassword from '../pages/ForgotPassword';
import ResetPassword from '../pages/ResetPassword';
import AdminLayout from '../pages/admin/AdminLayout';
import AdminDashboard from '../pages/admin/AdminDashboard';
import AdminShell from './AdminShell';
import AdminSignIn from './AdminSignIn';

const AdminBooks = lazyPage(() => import('../pages/admin/AdminBooks'));
const AdminOrders = lazyPage(() => import('../pages/admin/AdminOrders'));
const BookEditor = lazyPage(() => import('../pages/admin/BookEditor'));
const BulkUpload = lazyPage(() => import('../pages/admin/BulkUpload'));
const AdminShipping = lazyPage(() => import('../pages/admin/AdminShipping'));
const AdminFailedDeliveries = lazyPage(() => import('../pages/admin/AdminFailedDeliveries'));
const AdminReturns = lazyPage(() => import('../pages/admin/AdminReturns'));
const AdminPlaceOrder = lazyPage(() => import('../pages/admin/AdminPlaceOrder'));

function AdminApp() {
  return (
    <Routes>
      <Route path="/sign-in" element={<AdminSignIn />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Admins only */}
      <Route element={<AdminRoute />}>
        <Route element={<AdminShell />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="books" element={<AdminBooks />} />
            <Route path="books/new" element={<BookEditor />} />
            <Route path="books/:id" element={<BookEditor />} />
            <Route path="orders" element={<AdminOrders key="process" view="process" />} />
            <Route path="orders/track" element={<AdminOrders key="track" view="track" />} />
            <Route path="orders/failed-deliveries" element={<AdminFailedDeliveries />} />
            <Route path="orders/returns" element={<AdminReturns />} />
            <Route path="orders/new" element={<AdminPlaceOrder />} />
            <Route path="bulk-upload" element={<BulkUpload />} />
            <Route path="shipping" element={<AdminShipping />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

export default AdminApp;
