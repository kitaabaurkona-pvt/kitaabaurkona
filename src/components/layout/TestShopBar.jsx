import { LIVE_ORIGIN, RELEASE, STAGING } from '../../utils/release';

// Shown only on the test shop (staging), so it is never mistaken for the live store.
function TestShopBar() {
  if (!STAGING) return null;
  return (
    <div className="test-site-bar" role="note">
      <p>
        <strong>Test shop</strong>
        <span> · GoKwik sandbox: payments here are not real and orders are never shipped.</span>
        {RELEASE.commit && <span className="test-site-commit"> · {RELEASE.commit}</span>}
      </p>
      <a href={`${LIVE_ORIGIN}${window.location.pathname}${window.location.search}`}>Go to the live store</a>
    </div>
  );
}

export default TestShopBar;
