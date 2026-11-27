import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { previewMode } from '../preview/mode';

// A signed-in customer who has not saved their name, mobile and delivery address yet is
// sent to "Your details" once (pages/Details.jsx), then back to where they were going.
// After that, checkout and My Account start from the saved details.
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
  const { user, detailsMissing } = useAuth();
  const location = useLocation();
  if (previewMode || !user || !detailsMissing || OPEN_PATHS.has(location.pathname)) return children;
  return <Navigate to="/details" replace state={{ from: `${location.pathname}${location.search}` }} />;
}

export default DetailsGate;
