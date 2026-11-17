import { previewMode } from '../preview/mode';
import PreviewCheckout from '../preview/PreviewCheckout';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useCart } from '../hooks/useCart';
import { useCartLines } from '../hooks/useCartLines';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { getProfile } from '../services/profileService';
import { createOrder } from '../services/orderService';
import { checkPincode } from '../services/shippingService';
import { createCheckoutCart, getCheckoutCartOrder, gokwikEnabled, openGokwikCheckout } from '../services/gokwikService';
import { coverOf, formatPrice } from '../utils/format';
import { STAGING } from '../utils/release';
import { INDIAN_STATES, normalizeShipping, orderErrorMessage, validateShipping } from '../utils/storeForm';
import CartSummary from '../components/store/CartSummary';
import BookCover from '../components/store/BookCover';
import { LoadError, StateBlock } from '../components/store/States';
import { LinesSkeleton } from '../components/store/Skeletons';
import { BagIcon } from '../components/icons';

function Field({ id, label, error, children }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="field-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// Asks the courier (through the shipping function) whether it delivers to the PIN code,
// once 6 digits are in. If the check itself cannot run, ordering is still allowed: the
// parcel is checked again before it is booked.
function usePincodeCheck(pincode) {
  const [result, setResult] = useState({ pincode: '', state: 'idle' });
  const valid = /^[1-9][0-9]{5}$/.test(pincode);
  useEffect(() => {
    if (!valid) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      checkPincode(pincode).then(
        (r) => active && setResult({ pincode, state: !r.deliverable ? 'no' : r.cod ? 'ok' : 'nocod' }),
        () => active && setResult({ pincode, state: 'unknown' }),
      );
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pincode, valid]);
  if (!valid) return 'idle';
  return result.pincode === pincode ? result.state : 'checking';
}

const PIN_MESSAGES = {
  checking: 'Checking delivery to this PIN code…',
  ok: 'We deliver here. Cash on delivery is available.',
  no: "We can't deliver to this PIN code yet.",
  nocod: "Cash on delivery isn't available for this PIN code yet.",
  unknown: "Couldn't check delivery right now. You can still place the order.",
};

// Books in the cart that are not part of this order, each with "Add to this order".
function OtherBooks({ others, onInclude }) {
  if (others.length === 0) return null;
  return (
    <div className="checkout-more">
      <h3 className="checkout-more-title">Also in your cart</h3>
      <ul>
        {others.map((line) => (
          <li key={line.id}>
            <span className="checkout-more-name">
              {line.book.title} × {line.quantity}
            </span>
            <span className="checkout-more-price">{formatPrice(Number(line.book.price) * line.quantity)}</span>
            <button type="button" className="btn-link checkout-line-action" onClick={() => onInclude(line.id)} aria-label={`Add ${line.book.title} to this order`}>
              Add to this order
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Checkout through GoKwik: the order's books and one button that opens GoKwik's popup,
// where the customer gives the address and pays online or chooses cash on delivery.
// GoKwik's servers then place the order with our backend; this page only learns that it
// happened and moves on to the order. `onUnavailable` switches to the site's own
// checkout when GoKwik cannot be opened.
function GokwikCheckout({ phone, lines, totals, others = [], removable = [], onInclude, onExclude, wholeCart, nativeUrl, onUnavailable }) {
  const navigate = useNavigate();
  const { clear, remove } = useCart();
  const [error, setError] = useState(null);
  const [opening, setOpening] = useState(false);
  const busy = useRef(false);
  const done = useRef(false);

  // The order exists: only what was ordered leaves the cart, then on to the order page.
  function finish(orderId) {
    if (done.current) return;
    done.current = true;
    if (wholeCart) clear();
    else lines.forEach((line) => remove(line.id));
    navigate(orderId ? `/orders/${orderId}` : '/orders', { replace: true, state: { placed: true } });
  }

  const orderOf = (cartId) => getCheckoutCartOrder(cartId).catch(() => null);

  async function handleOpen() {
    if (busy.current) return;
    busy.current = true;
    setOpening(true);
    setError(null);
    let cartId;
    try {
      cartId = await createCheckoutCart(lines.map((line) => ({ bookId: line.id, quantity: line.quantity })));
    } catch (err) {
      busy.current = false;
      setOpening(false);
      setError(orderErrorMessage(err));
      return;
    }
    try {
      await openGokwikCheckout({
        cartId,
        phone,
        nativeUrl,
        onComplete: async () => finish(await orderOf(cartId)),
        // Closed: if the order went through anyway, carry on to it.
        onClose: async () => {
          const orderId = await orderOf(cartId);
          if (orderId) finish(orderId);
        },
        onFailure: onUnavailable,
      });
    } catch {
      onUnavailable();
    } finally {
      busy.current = false;
      setOpening(false);
    }
  }

  return (
    <div className="two-col">
      <ul className="line-list">
        {lines.map((line) => (
          <li key={line.id} className="line">
            <div className="line-inner">
              <div className="line-cover">
                <BookCover src={coverOf(line.book)} title={line.book.title} />
              </div>
              <div className="line-body">
                <h2 className="line-title">{line.book.title}</h2>
                <div className="order-total-row">
                  <span className="page-meta">
                    {formatPrice(line.book.price)} × {line.quantity}
                  </span>
                  <span className="line-total">{formatPrice(Number(line.book.price) * line.quantity)}</span>
                </div>
                {removable.includes(line.id) && (
                  <button type="button" className="btn-link checkout-line-action" onClick={() => onExclude(line.id)} aria-label={`Remove ${line.book.title} from this order`}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <aside>
        <CartSummary totals={totals}>
          <OtherBooks others={others} onInclude={onInclude} />
          {error && (
            <p className="notice" data-tone="error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="btn btn-primary btn-block" onClick={handleOpen} aria-busy={opening} aria-disabled={opening || undefined}>
            {opening && <span className="spinner" aria-hidden="true" />}
            {opening ? 'Opening payment…' : 'Continue to payment'}
          </button>
          <Link to="/cart" className="btn btn-outline btn-block">
            Back to cart
          </Link>
        </CartSummary>
      </aside>
    </div>
  );
}

// `others` are books in the cart that are not part of this order (an "Order now"
// checkout starts with one book); `onInclude` / `onExclude` move them in and out.
function CheckoutForm({ initial, lines, totals, others = [], removable = [], onInclude, onExclude, wholeCart }) {
  const navigate = useNavigate();
  const { clear, remove } = useCart();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  const pinState = usePincodeCheck(form.pincode);
  const pinBlocked = pinState === 'no' || pinState === 'nocod';

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const fieldError = (id) => (error?.field === id ? error.message : undefined);
  const invalidProps = (id) => ({
    'aria-invalid': fieldError(id) ? 'true' : undefined,
    'aria-describedby': fieldError(id) ? `${id}-error` : undefined,
  });

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy.current) return;
    const shipping = normalizeShipping(form);
    const problem =
      validateShipping(shipping) ??
      (pinBlocked ? { field: 'ship-pincode', message: PIN_MESSAGES[pinState] } : null) ??
      (pinState === 'checking' ? { field: 'ship-pincode', message: 'Wait a moment while we check delivery to this PIN code.' } : null);
    if (problem) {
      setError(problem);
      document.getElementById(problem.field)?.focus();
      return;
    }
    busy.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const orderId = await createOrder(
        lines.map((line) => ({ bookId: line.id, quantity: line.quantity })),
        shipping,
        'cod',
      );
      // Only what was ordered leaves the cart.
      if (wholeCart) clear();
      else lines.forEach((line) => remove(line.id));
      navigate(`/orders/${orderId}`, { replace: true, state: { placed: true } });
    } catch (err) {
      busy.current = false;
      setSubmitting(false);
      setError({ field: null, message: orderErrorMessage(err) });
    }
  }

  return (
    <form className="two-col" onSubmit={handleSubmit} noValidate>
      <div className="stack">
        <section className="panel" aria-labelledby="delivery-heading">
          <h2 id="delivery-heading" className="panel-title">
            Delivery details
          </h2>
          <div className="form-grid form-grid-2">
            <Field id="ship-name" label="Full name" error={fieldError('ship-name')}>
              <input id="ship-name" className="input" autoComplete="name" maxLength={80} value={form.name} onChange={set('name')} required {...invalidProps('ship-name')} />
            </Field>
            <Field id="ship-phone" label="Mobile number" error={fieldError('ship-phone')}>
              <input id="ship-phone" className="input" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10} value={form.phone} onChange={(event) => setForm((c) => ({ ...c, phone: event.target.value.replace(/\D/g, '').slice(0, 10) }))} required {...invalidProps('ship-phone')} />
            </Field>
            <div className="span-2">
              <Field id="ship-address" label="House, street and area" error={fieldError('ship-address')}>
                <textarea id="ship-address" className="textarea" autoComplete="street-address" maxLength={300} rows={3} value={form.address} onChange={set('address')} required {...invalidProps('ship-address')} />
              </Field>
            </div>
            <Field id="ship-city" label="City" error={fieldError('ship-city')}>
              <input id="ship-city" className="input" autoComplete="address-level2" maxLength={60} value={form.city} onChange={set('city')} required {...invalidProps('ship-city')} />
            </Field>
            <Field id="ship-state" label="State" error={fieldError('ship-state')}>
              <select id="ship-state" className="select" autoComplete="address-level1" value={form.state} onChange={set('state')} required {...invalidProps('ship-state')}>
                <option value="">Choose a state</option>
                {INDIAN_STATES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="ship-pincode" label="PIN code" error={fieldError('ship-pincode')}>
              <input id="ship-pincode" className="input" inputMode="numeric" autoComplete="postal-code" maxLength={6} value={form.pincode} onChange={(event) => setForm((c) => ({ ...c, pincode: event.target.value.replace(/\D/g, '').slice(0, 6) }))} required {...invalidProps('ship-pincode')} />
              {pinState !== 'idle' && !fieldError('ship-pincode') && (
                <p className="pin-check" data-state={pinState} role="status">
                  {PIN_MESSAGES[pinState]}
                </p>
              )}
            </Field>
          </div>
        </section>

        <section className="panel" aria-labelledby="payment-heading">
          <h2 id="payment-heading" className="panel-title">
            Payment
          </h2>
          <div className="payment-option">
            <p className="payment-option-title">Cash on delivery</p>
            <p>Pay {formatPrice(totals.subtotal)} in cash when your order arrives. Shipping is free.</p>
          </div>
        </section>
      </div>

      <aside>
        <CartSummary totals={totals}>
          <dl className="summary-rows checkout-lines">
            {lines.map((line) => (
              <div key={line.id}>
                <dt>
                  {line.book.title} × {line.quantity}
                  {removable.includes(line.id) && (
                    <button type="button" className="btn-link checkout-line-action" onClick={() => onExclude(line.id)} aria-label={`Remove ${line.book.title} from this order`}>
                      Remove
                    </button>
                  )}
                </dt>
                <dd>{formatPrice(Number(line.book.price) * line.quantity)}</dd>
              </div>
            ))}
          </dl>
          <OtherBooks others={others} onInclude={onInclude} />
          {error && !error.field && (
            <p className="notice" data-tone="error" role="alert">
              {error.message}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block" aria-busy={submitting} aria-disabled={submitting || pinBlocked || undefined}>
            {submitting && <span className="spinner" aria-hidden="true" />}
            {submitting ? 'Placing order…' : 'Place order'}
          </button>
          <Link to="/cart" className="btn btn-outline btn-block">
            Back to cart
          </Link>
        </CartSummary>
      </aside>
    </form>
  );
}

function Checkout() {
  useDocumentTitle('Checkout');
  const { user } = useAuth();
  const { ids } = useCart();
  const cart = useCartLines();
  const profile = useAsync(() => getProfile(user.id), [user.id]);
  const { retry: refreshCart } = cart;
  // "Order now" opens /checkout?buy=<book id>: the order is that book alone, plus any
  // other cart books the shopper adds here. Without it (or if that book is no longer in
  // the cart) checkout is for the whole cart.
  const [params] = useSearchParams();
  const buyParam = params.get('buy');
  const buyId = buyParam && ids.includes(buyParam) ? buyParam : null;
  const [included, setIncluded] = useState([]);
  // GoKwik's checkout where the site is set up for it. The site's own checkout (cash on
  // delivery) takes over if GoKwik cannot be opened, or when GoKwik sends the customer
  // back here with ?native=1.
  const [gokwikDown, setGokwikDown] = useState(false);
  const useGokwik = gokwikEnabled && !gokwikDown && params.get('native') !== '1';
  const inOrder = (line) => !buyId || line.id === buyId || included.includes(line.id);
  const lines = cart.lines.filter(inOrder);
  const others = cart.lines.filter((line) => !inOrder(line) && line.available);
  const totals = buyId
    ? lines
        .filter((line) => line.available)
        .reduce(
          (sum, line) => ({
            count: sum.count + line.quantity,
            subtotal: sum.subtotal + Number(line.book.price) * line.quantity,
            mrp: sum.mrp + Number(line.book.mrp) * line.quantity,
          }),
          { count: 0, subtotal: 0, mrp: 0 },
        )
    : cart.totals;
  const blocked = lines.some((line) => !line.available && !line.pending);

  // Checkout always starts from freshly read prices and stock.
  useEffect(() => {
    refreshCart();
  }, [refreshCart]);

  let content;
  if (ids.length === 0) {
    content = (
      <StateBlock title="Your cart is empty." description="Add a book before heading to checkout." icon={BagIcon}>
        <Link to="/books" className="btn btn-dark">
          Browse books
        </Link>
      </StateBlock>
    );
  } else if ((cart.loading && !cart.data) || cart.pending || profile.loading) {
    content = <LinesSkeleton count={3} label="Preparing checkout…" />;
  } else if (cart.error) {
    content = <LoadError onRetry={cart.retry} what="your cart" />;
  } else if (blocked || totals.count === 0) {
    content = (
      <StateBlock title="Some books in your cart are no longer available.">
        <Link to="/cart" className="btn btn-dark">
          Review cart
        </Link>
      </StateBlock>
    );
  } else {
    const p = profile.data ?? {};
    const order = {
      lines,
      totals,
      others,
      removable: buyId ? included : [],
      onInclude: (id) => setIncluded((current) => [...current, id]),
      onExclude: (id) => setIncluded((current) => current.filter((other) => other !== id)),
      wholeCart: !buyId,
    };
    // The test shop shares the live database, so its own checkout would make real
    // cash-on-delivery orders: there, only GoKwik's sandbox may take an order.
    content = STAGING && !useGokwik ? (
      <StateBlock title={gokwikEnabled ? 'GoKwik sandbox checkout could not be opened.' : 'The test shop takes orders only through GoKwik sandbox, which is not set up yet.'}>
        {gokwikEnabled && (
          <button type="button" className="btn btn-dark" onClick={() => window.location.assign(`/checkout${buyId ? `?buy=${encodeURIComponent(buyId)}` : ''}`)}>
            Try again
          </button>
        )}
      </StateBlock>
    ) : useGokwik ? (
      <GokwikCheckout
        {...order}
        phone={p.phone ?? ''}
        nativeUrl={`${window.location.origin}/checkout?native=1${buyId ? `&buy=${encodeURIComponent(buyId)}` : ''}`}
        onUnavailable={() => setGokwikDown(true)}
      />
    ) : (
      <>
        {gokwikDown && (
          <p className="notice notice-gap" data-tone="error" role="alert">
            Online payment could not be opened. You can still order with cash on delivery.
          </p>
        )}
        <CheckoutForm initial={{ name: p.full_name ?? '', phone: p.phone ?? '', address: p.address ?? '', city: '', state: '', pincode: '' }} {...order} />
      </>
    );
  }

  return (
    <div className="container page">
      <div className="page-head">
        <h1 className="page-title">Checkout</h1>
      </div>
      {content}
    </div>
  );
}

export default function CheckoutRoute() { return previewMode ? <PreviewCheckout /> : <Checkout />; }
