import { Link } from 'react-router-dom';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { CONTACT, BLURB, STORE_NAME } from '../../utils/storeInfo';
import { POLICY_LINKS } from '../../content/policies';
import { COLLECTIONS, UNDER_PRICE, CATEGORIES, categoryHref, dealsHref, regionalHref, underPriceHref } from '../../utils/categories';
import { formatPrice } from '../../utils/format';
import { ArrowUpIcon } from '../icons';

const YEAR = new Date().getFullYear();

const SEARCHED = [
  { to: dealsHref, label: 'Biggest discounts' },
  { to: underPriceHref, label: `Up to ${formatPrice(UNDER_PRICE)}` },
  ...CATEGORIES.map((name) => ({ to: categoryHref(name), label: name })),
  { to: regionalHref, label: COLLECTIONS.regional.label },
  { to: '/books', label: 'All books' },
];

// Black footer like the previous store: who we are, how to reach us, the policies,
// popular links and a button back to the top.
function SiteFooter() {
  const reduce = useReduceMotion();
  return (
    <footer className="site-footer">
      <div className="container footer-main">
        <div className="footer-about">
          <img src="/logo-64.png" alt="" width="40" height="40" />
          <p className="footer-name">{STORE_NAME.toUpperCase()}</p>
          <p>{BLURB}</p>
        </div>
        <div className="footer-contact">
          <h2>Contact Us</h2>
          <ul>
            <li>
              Call: <a href={CONTACT.phoneHref}>{CONTACT.phone}</a>
            </li>
            <li>
              WhatsApp:{' '}
              <a href={CONTACT.whatsappHref} target="_blank" rel="noopener noreferrer">
                {CONTACT.whatsapp}
              </a>
            </li>
            <li>Customer Support Time: {CONTACT.hours}</li>
            <li>
              Email: <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
            </li>
            <li>Address: {CONTACT.address}</li>
          </ul>
        </div>
      </div>

      <div className="container">
        <nav className="footer-links" aria-label="Policies">
          {POLICY_LINKS.map((link) => (
            <Link key={link.to} to={link.to}>
              {link.label}
            </Link>
          ))}
          <Link to="/settings">Settings</Link>
        </nav>

        <nav className="footer-searched" aria-label="Most searched on store">
          <h2>Most searched on store</h2>
          {SEARCHED.map((link) => (
            <Link key={link.to} to={link.to}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="footer-bottom">
          <span>
            © {YEAR} {STORE_NAME}
          </span>
          <button
            type="button"
            className="btn footer-top"
            onClick={() => window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })}
          >
            <ArrowUpIcon size={18} />
            Go to top
          </button>
        </div>
      </div>
    </footer>
  );
}

export default SiteFooter;
