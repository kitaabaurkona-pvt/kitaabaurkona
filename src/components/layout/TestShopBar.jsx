import { LIVE_ORIGIN, RELEASE, STAGING } from '../../utils/release';

// Same rule as gokwikService (kept here so the bar does not pull in the checkout code).
const GOKWIK_ENVIRONMENT = import.meta.env.VITE_GOKWIK_ENV === 'production' ? 'production' : 'sandbox';

// Shown only on the test shop (staging), so it is never mistaken for the live store.
// With GoKwik production on, orders here are real, and the bar says so.
function TestShopBar() {
  if (!STAGING) return null;
  return (
    <div className="test-site-bar" role="note">
      <p>
        <strong>Test shop</strong>
        {GOKWIK_ENVIRONMENT === 'production' ? (
          <span> · GoKwik production: payments here are real and orders are real orders in the live store.</span>
        ) : (
          <span> · GoKwik sandbox: payments here are not real and orders are never shipped.</span>
        )}
        {RELEASE.commit && <span className="test-site-commit"> · {RELEASE.commit}</span>}
      </p>
      <a href={`${LIVE_ORIGIN}${window.location.pathname}${window.location.search}`}>Go to the live store</a>
    </div>
  );
}

export default TestShopBar;
