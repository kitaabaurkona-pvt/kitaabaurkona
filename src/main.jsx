import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/bricolage-grotesque';
import './index.css';
import { captureAuthRedirectError } from './utils/authRedirect';
import { homeOrigin } from './utils/release';
import { reloadOnce } from './utils/lazyPage';
import ErrorBoundary from './components/ErrorBoundary';
import { PreferencesProvider } from './context/PreferencesContext';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { CartLinesProvider } from './context/CartLinesProvider';
import { WishlistProvider } from './context/WishlistContext';
import { ToastProvider } from './context/ToastProvider';
import App from './App.jsx';

function start() {
  captureAuthRedirectError();

  // A page's files could not be fetched, usually because a new version of the site was
  // released while this tab was open: reload once to get the current version.
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnce()) event.preventDefault();
  });

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter>
        <PreferencesProvider>
          <AuthProvider>
            <CartProvider>
              <CartLinesProvider>
                <WishlistProvider>
                  <ToastProvider>
                    <ErrorBoundary>
                      <App />
                    </ErrorBoundary>
                  </ToastProvider>
                </WishlistProvider>
              </CartLinesProvider>
            </CartProvider>
          </AuthProvider>
        </PreferencesProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}

// The live store belongs on www.kitaabaurkona.com and the test site on
// kitaabaurkona.vercel.app; opened on any other Vercel address, go there instead.
const home = homeOrigin(window.location.hostname);
if (home) {
  const { pathname, search, hash } = window.location;
  window.location.replace(`${home}${pathname}${search}${hash}`);
} else {
  start();
}
