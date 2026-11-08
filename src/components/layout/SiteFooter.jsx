import { Link } from 'react-router-dom';

const YEAR = new Date().getFullYear();

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-row">
        <span>© {YEAR} Kitaabaurkona</span>
        <nav aria-label="Footer">
          <Link to="/terms">Terms</Link>
          <Link to="/settings">Settings</Link>
        </nav>
      </div>
    </footer>
  );
}

export default SiteFooter;
