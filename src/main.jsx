import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import './index.css';
import { captureAuthRedirectError } from './utils/authRedirect';
import { PreferencesProvider } from './context/PreferencesContext';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { WishlistProvider } from './context/WishlistContext';
import { ToastProvider } from './context/ToastProvider';
import App from './App.jsx';

captureAuthRedirectError();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <PreferencesProvider>
        <AuthProvider>
          <CartProvider>
            <WishlistProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </WishlistProvider>
          </CartProvider>
        </AuthProvider>
      </PreferencesProvider>
    </BrowserRouter>
  </StrictMode>
);
