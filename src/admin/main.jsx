// Entry file of the admin site (kitaabaurkona.vercel.app). The store has its own entry,
// src/main.jsx; vite.config.js picks one per build, so the admin site carries no shop
// pages, cart or wishlist, and the store carries no admin pages.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/bricolage-grotesque';
import '../index.css';
import { captureAuthRedirectError } from '../utils/authRedirect';
import { homeOrigin } from '../utils/release';
import { reloadOnce } from '../utils/lazyPage';
import ErrorBoundary from '../components/ErrorBoundary';
import { PreferencesProvider } from '../context/PreferencesContext';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastProvider';
import AdminApp from './AdminApp.jsx';

function start() {
  captureAuthRedirectError();

  // A page's files could not be fetched, usually because a new version was released
  // while this tab was open: reload once to get the current version.
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnce()) event.preventDefault();
  });

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter>
        <PreferencesProvider>
          <AuthProvider>
            <ToastProvider>
              <ErrorBoundary>
                <AdminApp />
              </ErrorBoundary>
            </ToastProvider>
          </AuthProvider>
        </PreferencesProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}

// The admin panel belongs on kitaabaurkona.vercel.app; opened on any of Vercel's other
// addresses for the branch, go there instead.
const home = homeOrigin(window.location.hostname);
if (home) {
  const { pathname, search, hash } = window.location;
  window.location.replace(`${home}${pathname}${search}${hash}`);
} else {
  start();
}
