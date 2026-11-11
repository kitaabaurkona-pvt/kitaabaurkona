import { LIVE_ORIGIN, RELEASE, isTestBuild } from '../../utils/release';

// Shown only on the test site, so it is never mistaken for the live store. The test
// site uses the live database: orders placed here are real orders.
function TestSiteBar() {
  if (!isTestBuild) return null;
  return (
    <div className="test-site-bar" role="note">
      <p>
        <strong>Test site</strong>
        <span> · not the live store yet. Orders placed here are real.</span>
        {RELEASE.commit && <span className="test-site-commit"> · {RELEASE.commit}</span>}
      </p>
      <a href={`${LIVE_ORIGIN}${window.location.pathname}${window.location.search}`}>Go to the live store</a>
    </div>
  );
}

export default TestSiteBar;
