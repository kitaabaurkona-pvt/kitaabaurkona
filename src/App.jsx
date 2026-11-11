import { lazy } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import TestSiteBar from './components/layout/TestSiteBar';
import AdminRoute from './components/AdminRoute';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Home from './pages/Home';
const Books = lazy(() => import('./pages/Books'));
const BookDetail = lazy(() => import('./pages/BookDetail'));
const Offers = lazy(() => import('./pages/Offers'));
const Cart = lazy(() => import('./pages/Cart'));
const Checkout = lazy(() => import('./pages/Checkout'));
const Orders = lazy(() => import('./pages/Orders'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const Wishlist = lazy(() => import('./pages/Wishlist'));
const Account = lazy(() => import('./pages/Account'));
const Forbidden = lazy(() => import('./pages/Forbidden'));
const NotFound = lazy(() => import('./pages/NotFound'));

// Pages most shoppers never open are split into their own files and loaded on demand.
const Settings = lazy(() => import('./pages/Settings'));
const Terms = lazy(() => import('./pages/Terms'));
const PolicyPage = lazy(() => import('./pages/PolicyPage'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminBooks = lazy(() => import('./pages/admin/AdminBooks'));
const AdminOrders = lazy(() => import('./pages/admin/AdminOrders'));
const BulkUpload = lazy(() => import('./pages/admin/BulkUpload'));
const AdminShipping = lazy(() => import('./pages/admin/AdminShipping'));

function LegacyBookRedirect() {
  const { id } = useParams();
  return <Navigate to={`/books/${id}`} replace />;
}

function App() {
  return (
    <>
      <TestSiteBar />
      <Routes>
        {/* Auth pages render their own shell instead of the store layout */}
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignUp />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route element={<Layout />}>
          {/* Public */}
          <Route path="/" element={<Home />} />
          <Route path="/books" element={<Books />} />
          <Route path="/books/:id" element={<BookDetail />} />
          <Route path="/offers" element={<Offers />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/about" element={<PolicyPage page="about" />} />
          <Route path="/returns" element={<PolicyPage page="returns" />} />
          <Route path="/shipping" element={<PolicyPage page="shipping" />} />
          <Route path="/privacy" element={<PolicyPage page="privacy" />} />
          <Route path="/403" element={<Forbidden />} />

          {/* Signed-in users */}
          <Route element={<ProtectedRoute />}>
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="/wishlist" element={<Wishlist />} />
            <Route path="/account" element={<Account />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          {/* Admins only (the database enforces this as well) */}
          <Route path="/admin" element={<AdminRoute />}>
            <Route element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="books" element={<AdminBooks />} />
              <Route path="orders" element={<AdminOrders />} />
              <Route path="bulk-upload" element={<BulkUpload />} />
              <Route path="shipping" element={<AdminShipping />} />
            </Route>
          </Route>

          {/* Earlier addresses */}
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/products" element={<Navigate to="/books" replace />} />
          <Route path="/products/:id" element={<LegacyBookRedirect />} />
          <Route path="/profile" element={<Navigate to="/account" replace />} />

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}

export default App;
