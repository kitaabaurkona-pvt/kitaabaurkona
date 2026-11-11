import { BookOpen, ChatCircle, Lifebuoy } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import BrandLink from './BrandLink';
import { CONTACT } from '../../utils/storeInfo';
import { underPriceHref, categoryHref } from '../../utils/categories';
import { previewMode } from '../../preview/mode';

const YEAR = new Date().getFullYear();

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container editorial-footer">
        <div className="footer-brand">
          <BrandLink />
          <p>Your next read.<br />Your own little corner.</p>
        </div>
        <nav aria-labelledby="footer-shop">
          <h2 id="footer-shop"><BookOpen aria-hidden="true" />Find a book</h2>
          <Link to="/books">Browse books</Link>
          <Link to={underPriceHref}>₹299 &amp; under</Link>
          <Link to={categoryHref('Box Sets & Combos')}>Box sets &amp; combos</Link>
          <Link to="/wishlist">Your wishlist</Link>
        </nav>
        <nav aria-labelledby="footer-help">
          <h2 id="footer-help"><Lifebuoy aria-hidden="true" />Here to help</h2>
          <Link to="/orders">Your orders</Link>
          <Link to="/shipping">Shipping &amp; delivery</Link>
          <Link to="/returns">Returns</Link>
          <a href={`mailto:${CONTACT.email}`}>Contact us</a>
        </nav>
        <div className="footer-contact">
          <h2><ChatCircle aria-hidden="true" />Let's talk books.</h2>
          <a href={CONTACT.whatsappHref} target="_blank" rel="noopener noreferrer">Chat on WhatsApp</a>
          <p>{CONTACT.hours}</p>
          <Link to="/about">About our bookshop</Link>
        </div>
      </div>
      <div className="container editorial-footer-bottom">
        <span>© {YEAR} Kitaab Aur Kona</span>
        <nav aria-label="Legal">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/settings">Preferences</Link>
        </nav>
      </div>
      {previewMode && <p className="preview-note">Local frontend preview · Catalogue snapshot · Account and ordering services are not connected</p>}
    </footer>
  );
}
