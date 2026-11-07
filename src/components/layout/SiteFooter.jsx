import { Link } from 'react-router-dom';

const YEAR = new Date().getFullYear();

const COLUMNS = [
  {
    title: 'Shop',
    links: [
      ['/books', 'All books'],
      ['/books?sort=discount&stock=1', 'Biggest discounts'],
      ['/offers', 'Offers'],
      ['/cart', 'Cart'],
    ],
  },
  {
    title: 'Your account',
    links: [
      ['/orders', 'Orders'],
      ['/wishlist', 'Wishlist'],
      ['/account', 'Account'],
      ['/settings', 'Settings'],
    ],
  },
  {
    title: 'Help',
    links: [['/terms', 'Terms and conditions']],
  },
];

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Link to="/" className="footer-brand">
            <img src="/logo-64.png" alt="" width="40" height="40" />
            Kitaabaurkona
          </Link>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.title} className="footer-col" aria-label={col.title}>
            <h2>{col.title}</h2>
            <ul>
              {col.links.map(([to, label]) => (
                <li key={to}>
                  <Link to={to}>{label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="container footer-base">© {YEAR} Kitaabaurkona</div>
    </footer>
  );
}

export default SiteFooter;
