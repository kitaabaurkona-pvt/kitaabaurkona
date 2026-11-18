import { LIVE_ORIGIN, RELEASE, STAGING, TEST_SITE } from '../../utils/release';

// Shown only on the test shop (staging) and the test site (frontend_test), so neither is
// ever mistaken for the live store.
function TestShopBar() {
  if (!STAGING && !TEST_SITE) return null;
  return (
    <div className="test-site-bar" role="note">
      <p>
        {STAGING ? (
          <>
            <strong>Test shop</strong>
            <span> · GoKwik sandbox: payments here are not real and orders are never shipped.</span>
          </>
        ) : (
          <>
            <strong>Test site</strong>
            <span> · not the live store yet. Orders placed here are real.</span>
          </>
        )}
        {RELEASE.commit && <span className="test-site-commit"> · {RELEASE.commit}</span>}
      </p>
      <a href={`${LIVE_ORIGIN}${window.location.pathname}${window.location.search}`}>Go to the live store</a>
    </div>
  );
}

export default TestShopBar;
