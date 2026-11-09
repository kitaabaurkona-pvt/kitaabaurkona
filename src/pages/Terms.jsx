import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { CONTACT } from '../utils/storeInfo';

// Bracketed items are details the business has not supplied yet. They are shown
// as highlighted placeholders so nothing on this page is invented.
function Fill({ children }) {
  return <mark className="placeholder">[{children}]</mark>;
}

const SECTIONS = [
  ['about', 'About these terms'],
  ['accounts', 'Your account'],
  ['books', 'Books, prices and stock'],
  ['orders', 'Orders and payment'],
  ['delivery', 'Delivery'],
  ['returns', 'Cancellations and returns'],
  ['use', 'Acceptable use'],
  ['content', 'Site content'],
  ['data', 'Your information'],
  ['liability', 'Liability'],
  ['changes', 'Changes to these terms'],
  ['law', 'Governing law'],
  ['contact', 'Contact'],
];

function Terms() {
  useDocumentTitle('Terms and conditions');

  return (
    <div className="container page">
      <div className="page-head">
        <h1 className="page-title">Terms and conditions</h1>
      </div>

      <article className="prose">
        <p>
          Effective from <Fill>Effective date</Fill>.
        </p>

        <nav className="toc" aria-label="On this page">
          <ol>
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ol>
        </nav>

        <h2 id="about">About these terms</h2>
        <p>
          Kitaabaurkona is operated by <Fill>Business legal name</Fill>, {CONTACT.address}. These terms
          apply whenever you browse this site, create an account or place an order. By using the site you agree to
          them.
        </p>

        <h2 id="accounts">Your account</h2>
        <ul>
          <li>You need an account to save books to your wishlist, place orders and see your order history.</li>
          <li>Give accurate details and keep them up to date from your account page.</li>
          <li>
            Keep your password private. You can change it, or sign out of every device, from{' '}
            <Link to="/settings">Settings</Link>.
          </li>
          <li>We may suspend an account that is used to break these terms.</li>
        </ul>

        <h2 id="books">Books, prices and stock</h2>
        <ul>
          <li>All prices are in Indian rupees (₹). Where a book shows an MRP, the discount is worked out from it.</li>
          <li>Stock is limited. A book can sell out between adding it to your cart and placing your order.</li>
          <li>
            We try to describe every book accurately. If a price or detail is listed in error, we may cancel the
            affected order and tell you.
          </li>
        </ul>

        <h2 id="orders">Orders and payment</h2>
        <ul>
          <li>The price you pay is the price shown when you place the order.</li>
          <li>Orders are paid by cash on delivery: you pay the order total in cash when the parcel arrives.</li>
          <li>A cash on delivery order is confirmed as soon as it is placed, and its books are set aside for you.</li>
          <li>Your cart is kept in this browser until you place an order or clear it.</li>
        </ul>

        <h2 id="delivery">Delivery</h2>
        <p>
          Orders are delivered to the address you enter at checkout, within India. Shipping is free on all orders,
          and orders are usually shipped within two business days. See our <Link to="/shipping">Shipping policy</Link>.
        </p>

        <h2 id="returns">Cancellations and returns</h2>
        <ul>
          <li>
            You can cancel an order yourself from its page in <Link to="/orders">Orders</Link> until the parcel has
            been picked up by the courier.
          </li>
          <li>
            Returns and exchanges follow our <Link to="/returns">Return policy</Link>.
          </li>
          <li>
            Refunds are made to the original payment method within <Fill>Refund timeline</Fill>.
          </li>
        </ul>

        <h2 id="use">Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>try to access accounts, data or admin pages that are not yours;</li>
          <li>interfere with the site, or overload it with automated requests;</li>
          <li>place orders you do not intend to complete, or use false details.</li>
        </ul>

        <h2 id="content">Site content</h2>
        <p>
          Book titles, cover images and descriptions belong to their respective publishers and authors. The
          Kitaabaurkona name, logo and the design of this site belong to <Fill>Business legal name</Fill>.
        </p>

        <h2 id="data">Your information</h2>
        <ul>
          <li>
            We store the details you give us, such as your name, email address, mobile number, gender and delivery
            address, to run your account and deliver your orders.
          </li>
          <li>If you continue with Google, we receive your name and email address from Google.</li>
          <li>Your theme and animation settings are saved only in this browser.</li>
        </ul>

        <h2 id="liability">Liability</h2>
        <p>
          We are responsible for supplying the books you order as described. We are not responsible for losses that
          were not foreseeable when you placed your order, or for delays caused by events outside our control. Nothing
          in these terms limits your rights under Indian consumer law.
        </p>

        <h2 id="changes">Changes to these terms</h2>
        <p>
          We may update these terms. The version shown on this page, with its effective date, applies to orders placed
          from that date.
        </p>

        <h2 id="law">Governing law</h2>
        <p>
          These terms are governed by the laws of India. Disputes are subject to the courts of <Fill>City</Fill>.
        </p>

        <h2 id="contact">Contact</h2>
        <p>
          Questions about these terms or an order: <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>, or call or
          WhatsApp <a href={CONTACT.phoneHref}>{CONTACT.phone}</a> ({CONTACT.hours}).
        </p>
      </article>
    </div>
  );
}

export default Terms;
