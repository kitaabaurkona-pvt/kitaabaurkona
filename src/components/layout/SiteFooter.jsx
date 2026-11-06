import { Link } from 'react-router-dom';

const YEAR = new Date().getFullYear();

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer-row">
        <ul className="footer-links">
          <li>
            <Link to="/books">Books</Link>
          </li>
          <li>
            <Link to="/offers">Offers</Link>
          </li>
          <li>
            <Link to="/cart">Cart</Link>
          </li>
          <li>
            <Link to="/orders">Orders</Link>
          </li>
          <li>
            <Link to="/account">Account</Link>
          </li>
        </ul>
        <p className="footer-copy">© {YEAR} Kitaabaurkona</p>
      </div>
    </footer>
  );
}

export default SiteFooter;
