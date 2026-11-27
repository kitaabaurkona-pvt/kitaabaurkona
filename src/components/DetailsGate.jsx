import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { previewMode } from '../preview/mode';

// A signed-in customer who has not saved their name, mobile and delivery address yet is
// sent to "Your details" (pages/Details.jsx), then back to where they were going. They
// may "Skip for now" and browse, but checkout always asks first: saving there goes
// straight back to checkout. After that, checkout and My Account start from the details.
// Signing in, password help and the policy pages are never interrupted.
const OPEN_PATHS = new Set([
  '/details',
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/reset-password',
  '/terms',
  '/about',
  '/returns',
  '/shipping',
  '/privacy',
]);

function DetailsGate({ children }) {
  const { user, detailsMissing, detailsSkipped } = useAuth();
  const location = useLocation();
  if (previewMode || !user || !detailsMissing || OPEN_PATHS.has(location.pathname)) return children;
  if (detailsSkipped && location.pathname !== '/checkout') return children;
  return <Navigate to="/details" replace state={{ from: `${location.pathname}${location.search}` }} />;
}

export default DetailsGate;
