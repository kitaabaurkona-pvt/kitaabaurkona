import { Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import Dashboard from './pages/Dashboard';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';
import Forbidden from './pages/Forbidden';
import ProductListing from './pages/ProductListing';
import ProductDetail from './pages/ProductDetail';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import Profile from './pages/Profile';

function App() {
  return (
    <Routes>
      {/* Auth pages render their own shell instead of the app layout */}
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/sign-up" element={<SignUp />} />

      <Route element={<Layout />}>
        {/* Public */}
        <Route path="/" element={<ProductListing />} />
        <Route path="/products" element={<ProductListing />} />
        <Route path="/products/:id" element={<ProductDetail />} />
        <Route path="/403" element={<Forbidden />} />

        {/* Protected (authenticated users) */}
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/profile" element={<Profile />} />
        </Route>

        {/* Admin only */}
        <Route path="/admin" element={<AdminRoute />}>
          <Route index element={<div>Admin Area</div>} />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
