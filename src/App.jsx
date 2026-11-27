import { Suspense } from 'react';
import { lazyPage } from './utils/lazyPage';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import Layout from './components/layout/Layout';
import TestShopBar from './components/layout/TestShopBar';
import ProtectedRoute from './components/ProtectedRoute';
import DetailsGate from './components/DetailsGate';
import Home from './pages/Home';
// The sign-in pages have their own look and style sheet, so they are loaded only when opened.
const SignIn = lazyPage(() => import('./pages/SignIn'));
const SignUp = lazyPage(() => import('./pages/SignUp'));
const ForgotPassword = lazyPage(() => import('./pages/ForgotPassword'));
const ResetPassword = lazyPage(() => import('./pages/ResetPassword'));
const Books = lazyPage(() => import('./pages/Books'));
const BookDetail = lazyPage(() => import('./pages/BookDetail'));
const Offers = lazyPage(() => import('./pages/Offers'));
const Cart = lazyPage(() => import('./pages/Cart'));
const Checkout = lazyPage(() => import('./pages/Checkout'));
const Orders = lazyPage(() => import('./pages/Orders'));
const OrderDetail = lazyPage(() => import('./pages/OrderDetail'));
const ReturnRequest = lazyPage(() => import('./pages/ReturnRequest'));
const Wishlist = lazyPage(() => import('./pages/Wishlist'));
const Account = lazyPage(() => import('./pages/Account'));
const Details = lazyPage(() => import('./pages/Details'));
const NotFound = lazyPage(() => import('./pages/NotFound'));

// Pages most shoppers never open are split into their own files and loaded on demand.
const Settings = lazyPage(() => import('./pages/Settings'));
const Terms = lazyPage(() => import('./pages/Terms'));
const PolicyPage = lazyPage(() => import('./pages/PolicyPage'));

function LegacyBookRedirect() {
  const { id } = useParams();
  return <Navigate to={`/books/${id}`} replace />;
}

// The store. The admin panel is a separate site with its own entry (src/admin/main.jsx,
// kitaabaurkona.vercel.app), so there are no admin pages here: /admin is "not found".
function App() {
  return (
    <>
      <TestShopBar />
      {/* While a sign-in page loads, the page being left stays on screen. */}
      <Suspense fallback={null}>
      <DetailsGate>
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

          {/* Signed-in users */}
          <Route element={<ProtectedRoute />}>
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="/orders/:id/return" element={<ReturnRequest />} />
            <Route path="/wishlist" element={<Wishlist />} />
            <Route path="/account" element={<Account />} />
            <Route path="/details" element={<Details />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          {/* Earlier addresses */}
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/products" element={<Navigate to="/books" replace />} />
          <Route path="/products/:id" element={<LegacyBookRedirect />} />
          <Route path="/profile" element={<Navigate to="/account" replace />} />

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      </DetailsGate>
      </Suspense>
    </>
  );
}

export default App;
