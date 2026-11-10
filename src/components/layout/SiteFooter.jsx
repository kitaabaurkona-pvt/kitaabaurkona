import { Link } from 'react-router-dom';
import { CONTACT } from '../../utils/storeInfo';
import { underPriceHref, categoryHref } from '../../utils/categories';
import { previewMode } from '../../preview/mode';
const YEAR = new Date().getFullYear();
export default function SiteFooter(){return <footer className="site-footer"><div className="container editorial-footer">
 <div className="footer-brand"><Link className="brand-logo" to="/"><img src="/images/brand/emblem-transparent.png" width="42" height="42" alt=""/><span className="brand-word">Kitaab Aur Kona</span></Link><p>Your next read.<br/>Your own little corner.</p></div>
 <nav aria-label="Shop"><h2>Find a book</h2><Link to="/books">Browse books</Link><Link to={underPriceHref}>₹299 & under</Link><Link to={categoryHref('Box Sets & Combos')}>Box sets & combos</Link><Link to="/wishlist">Your wishlist</Link></nav>
 <nav aria-label="Help"><h2>Here to help</h2><Link to="/orders">Your orders</Link><Link to="/shipping">Shipping & delivery</Link><Link to="/returns">Returns</Link><a href={`mailto:${CONTACT.email}`}>Contact us</a></nav>
 <div><h2>Let's talk books.</h2><a href={CONTACT.whatsappHref} target="_blank" rel="noopener noreferrer">Chat on WhatsApp</a><p>{CONTACT.hours}</p><Link to="/about">About our bookshop</Link></div>
 </div><div className="container editorial-footer-bottom"><span>© {YEAR} Kitaab Aur Kona</span><nav aria-label="Legal"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/settings">Preferences</Link></nav></div>{previewMode&&<p className="preview-note">Local frontend preview · Catalogue snapshot · Account and ordering services are not connected</p>}</footer>}
