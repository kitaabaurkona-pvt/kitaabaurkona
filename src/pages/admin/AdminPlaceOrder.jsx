import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, MagnifyingGlass, Trash } from '@phosphor-icons/react';
import { adminErrorMessage, adminListBooks, adminPlaceOrder } from '../../services/adminService';
import { CARRIER_NAMES, checkPincode, getShippingSettings } from '../../services/shippingService';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { formatOrderNumber, formatPrice, plural } from '../../utils/format';
import { INDIAN_STATES, MAX_CART_LINES, MAX_QUANTITY, normalizeShipping, validateShipping } from '../../utils/storeForm';
import PageHead from '../../components/admin/PageHead';

const STEPS = ['Pickup & Customer details', 'Product details', 'Courier partner', 'Review order', 'Order placed'];
const EMPTY_CUSTOMER = { phone: '', alt: '', name: '', payment: '', pincode: '', city: '', state: '', house: '', street: '', landmark: '' };
const PHONE = /^[6-9][0-9]{9}$/;
const digits = (value, max) => value.replace(/\D/g, '').slice(0, max);

// The delivery address as one line, the way the website saves it.
const addressOf = (c) => [c.house, c.street, c.landmark && `Near ${c.landmark}`].map((part) => part.trim()).filter(Boolean).join(', ');
const shippingOf = (c) => normalizeShipping({ name: c.name, phone: c.phone, address: addressOf(c), city: c.city, state: c.state, pincode: c.pincode });

function Stepper({ step }) {
  return (
    <>
      <ol className="ap-stepper" aria-label="Steps">
        {STEPS.map((label, index) => (
          <li key={label} data-state={index < step ? 'done' : index === step ? 'current' : undefined} aria-current={index === step ? 'step' : undefined}>
            <span className="ap-stepper-dot">{index + 1}</span>
            <span className="ap-stepper-label">{label}</span>
          </li>
        ))}
      </ol>
      <p className="ap-stepper-now" aria-hidden="true">
        Step {step + 1} of {STEPS.length} · {STEPS[step]}
      </p>
    </>
  );
}

function Field({ id, label, required, error, children }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
        {required && <span className="ap-required" aria-hidden="true"> *</span>}
      </label>
      {children}
      {error && (
        <p className="ap-field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

// Whether the couriers deliver to a PIN code (and take cash on delivery there).
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
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pincode, valid]);
  if (!valid) return 'idle';
  return result.pincode === pincode ? result.state : 'checking';
}

const PIN_TEXT = {
  checking: 'Checking delivery…',
  ok: 'Delivery available, cash on delivery too',
  nocod: 'Delivery available, but not cash on delivery',
  no: 'Our couriers do not deliver to this PIN code',
  unknown: 'Could not check delivery right now',
};

function CustomerStep({ customer, setCustomer, settings, onNext }) {
  const [errors, setErrors] = useState({});
  const pin = usePincodeCheck(customer.pincode);
  // Changing a field clears its message; the rest are checked again on Next.
  const set = (key, value) => {
    setCustomer((c) => ({ ...c, [key]: value }));
    setErrors((e) => {
      if (!e[key]) return e;
      const rest = { ...e };
      delete rest[key];
      return rest;
    });
  };

  function next(event) {
    event.preventDefault();
    const found = {};
    if (!PHONE.test(customer.phone)) found.phone = 'Enter a valid 10-digit mobile number.';
    if (customer.alt && !PHONE.test(customer.alt)) found.alt = 'Enter a valid 10-digit mobile number, or leave it empty.';
    if (normalizeShipping({ name: customer.name }).name.length < 2) found.name = 'Enter the customer’s full name.';
    if (!customer.payment) found.payment = 'Choose Prepaid or COD.';
    if (customer.payment === 'cod' && pin === 'nocod') found.payment = 'Cash on delivery is not available at this PIN code.';
    if (!/^[1-9][0-9]{5}$/.test(customer.pincode)) found.pincode = 'Enter a valid 6-digit PIN code.';
    if (pin === 'no') found.pincode = PIN_TEXT.no;
    if (customer.city.trim().length < 2) found.city = 'Enter the town or city.';
    if (!INDIAN_STATES.includes(customer.state)) found.state = 'Choose a state.';
    if (!customer.house.trim()) found.house = 'Enter the house number or building name.';
    if (!customer.street.trim()) found.street = 'Enter the street, area or locality.';
    if (Object.keys(found).length === 0) {
      const problem = validateShipping(shippingOf(customer));
      if (problem) found[problem.field === 'ship-address' ? 'street' : problem.field.replace('ship-', '')] = problem.message;
    }
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(`po-${first}`)?.focus();
      return;
    }
    onNext();
  }

  const input = (key, props = {}) => (
    <input
      id={`po-${key}`}
      className="input"
      value={customer[key]}
      aria-invalid={errors[key] ? true : undefined}
      aria-describedby={errors[key] ? `po-${key}-error` : undefined}
      onChange={(e) => set(key, e.target.value)}
      {...props}
    />
  );

  return (
    <form className="ap-card" onSubmit={next} noValidate>
      <div className="ap-card-body ap-po-section">
        <h2 className="ap-card-title">Pickup Address</h2>
        <p className="page-meta">
          {settings
            ? `${settings.pickup_name ? `${settings.pickup_name} / ` : ''}${settings.pickup_address}, ${settings.pickup_city}, ${settings.pickup_state} - ${settings.pickup_pincode}`
            : 'Loading…'}
        </p>
      </div>
      <div className="ap-card-body">
        <h2 className="ap-card-title">Customer Details</h2>
        <div className="form-grid form-grid-2">
          <Field id="po-phone" label="Customer number" required error={errors.phone}>
            <div className="ap-prefix">
              <span>+91</span>
              {input('phone', { inputMode: 'numeric', placeholder: '00000-00000', autoComplete: 'off', onChange: (e) => set('phone', digits(e.target.value, 10)) })}
            </div>
          </Field>
          <Field id="po-alt" label="Alternate contact number" error={errors.alt}>
            <div className="ap-prefix">
              <span>+91</span>
              {input('alt', { inputMode: 'numeric', placeholder: '00000-00000', autoComplete: 'off', onChange: (e) => set('alt', digits(e.target.value, 10)) })}
            </div>
          </Field>
          <Field id="po-name" label="Customer name" required error={errors.name}>
            {input('name', { maxLength: 80, placeholder: 'Customer’s full name', autoComplete: 'off' })}
          </Field>
          <div>
            <span className="label" id="po-payment-label">
              Payment mode<span className="ap-required" aria-hidden="true"> *</span>
            </span>
            <div className="ap-segment" role="group" aria-labelledby="po-payment-label" id="po-payment" tabIndex={-1}>
              <button type="button" aria-pressed={customer.payment === 'online'} onClick={() => set('payment', 'online')}>
                Prepaid
              </button>
              <button type="button" aria-pressed={customer.payment === 'cod'} onClick={() => set('payment', 'cod')}>
                COD
              </button>
            </div>
            {errors.payment && <p className="ap-field-error">{errors.payment}</p>}
          </div>
          <Field id="po-pincode" label="Pincode" required error={errors.pincode}>
            {input('pincode', { inputMode: 'numeric', placeholder: 'Enter 6 digit pincode', onChange: (e) => set('pincode', digits(e.target.value, 6)) })}
            {pin !== 'idle' && !errors.pincode && (
              <p className="ap-pin" data-state={pin} aria-live="polite">
                {PIN_TEXT[pin]}
              </p>
            )}
          </Field>
          <div className="form-grid form-grid-2 ap-po-city">
            <Field id="po-city" label="Town/City" required error={errors.city}>
              {input('city', { maxLength: 60 })}
            </Field>
            <Field id="po-state" label="State" required error={errors.state}>
              <select id="po-state" className="select" value={customer.state} aria-invalid={errors.state ? true : undefined} onChange={(e) => set('state', e.target.value)}>
                <option value="">Choose</option>
                {INDIAN_STATES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field id="po-house" label="House No/Building Name" required error={errors.house}>
            {input('house', { maxLength: 120 })}
          </Field>
          <Field id="po-street" label="Street/Area/Colony/Locality" required error={errors.street}>
            {input('street', { maxLength: 150 })}
          </Field>
          <Field id="po-landmark" label="Landmark">
            {input('landmark', { maxLength: 60 })}
          </Field>
        </div>
      </div>
      <div className="ap-po-actions">
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => {
            setCustomer(EMPTY_CUSTOMER);
            setErrors({});
          }}
        >
          Reset
        </button>
        <button type="submit" className="btn btn-dark">
          Next
        </button>
      </div>
    </form>
  );
}

function ProductStep({ lines, setLines, onBack, onNext }) {
  const [term, setTerm] = useState('');
  const [wanted, setWanted] = useState('');
  const [error, setError] = useState(null);
  useEffect(() => {
    const timer = setTimeout(() => setWanted(term.trim()), 300);
    return () => clearTimeout(timer);
  }, [term]);
  const found = useAsync(() => (wanted ? adminListBooks({ search: wanted }) : Promise.resolve(null)), [wanted]);
  const total = lines.reduce((sum, l) => sum + (Number(l.price) || 0) * l.quantity, 0);

  function add(book) {
    setError(null);
    setLines((current) => {
      const existing = current.find((l) => l.book.id === book.id);
      if (existing) return current.map((l) => (l.book.id === book.id ? { ...l, quantity: Math.min(l.quantity + 1, MAX_QUANTITY, book.stock_quantity) } : l));
      if (current.length >= MAX_CART_LINES) return current;
      return [...current, { book, quantity: 1, price: String(Number(book.price)) }];
    });
  }
  const change = (id, patch) => setLines((current) => current.map((l) => (l.book.id === id ? { ...l, ...patch } : l)));

  function next() {
    if (lines.length === 0) return setError('Add at least one book.');
    for (const l of lines) {
      const price = Number(l.price);
      if (l.price === '' || !Number.isFinite(price) || price < 0) return setError(`Enter a selling price for ${l.book.title}.`);
      if (price > Number(l.book.mrp)) return setError(`The price of ${l.book.title} cannot be more than its MRP (${formatPrice(l.book.mrp)}).`);
      if (l.quantity > l.book.stock_quantity) return setError(`Only ${l.book.stock_quantity} of ${l.book.title} in stock.`);
    }
    setError(null);
    onNext();
  }

  return (
    <div className="ap-card">
      <div className="ap-card-body stack-sm">
        <h2 className="ap-card-title">Product Details</h2>
        <div className="ap-search ap-po-search">
          <MagnifyingGlass size={18} aria-hidden="true" />
          <label className="visually-hidden" htmlFor="po-book-search">
            Search books by name or SKU
          </label>
          <input id="po-book-search" className="input" type="search" placeholder="Search by book name or SKU" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        {wanted && found.data && (
          <ul className="ap-po-results" aria-label="Books found">
            {found.data.books.length === 0 && <li className="page-meta">No book matches “{wanted}”.</li>}
            {found.data.books.slice(0, 8).map((book) => {
              const inOrder = lines.find((l) => l.book.id === book.id);
              const out = book.stock_quantity === 0;
              return (
                <li key={book.id}>
                  {book.image_urls?.[0] ? <img className="ap-thumb" src={book.image_urls[0]} alt="" width="44" height="60" loading="lazy" /> : <span className="ap-thumb ap-thumb-empty" aria-hidden="true" />}
                  <span className="ap-po-book">
                    <span className="ap-book-name ap-clamp">{book.title}</span>
                    <span className="ap-book-sku">
                      SKU {book.sku} · {formatPrice(book.price)} · {out ? 'Out of stock' : `${book.stock_quantity} in stock`}
                    </span>
                  </span>
                  <button type="button" className="btn btn-outline btn-sm" aria-disabled={out || undefined} onClick={() => !out && add(book)}>
                    {inOrder ? 'Add one more' : 'Add'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {found.loading && wanted && !found.data && <p className="page-meta">Searching…</p>}
      </div>

      {lines.length > 0 && (
        <div className="ap-table-wrap">
          <table className="ap-table ap-po-lines">
            <thead>
              <tr>
                <th>Book</th>
                <th>Quantity</th>
                <th>Selling price (each)</th>
                <th className="num">Amount</th>
                <th>
                  <span className="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.book.id}>
                  <td data-label="Book">
                    <span className="ap-book-name ap-clamp">{l.book.title}</span>
                    <span className="ap-book-sku">
                      SKU {l.book.sku} · MRP {formatPrice(l.book.mrp)} · {l.book.stock_quantity} in stock
                    </span>
                  </td>
                  <td data-label="Quantity">
                    <label className="visually-hidden" htmlFor={`po-qty-${l.book.id}`}>
                      Quantity of {l.book.title}
                    </label>
                    <select id={`po-qty-${l.book.id}`} className="select select-sm" value={l.quantity} onChange={(e) => change(l.book.id, { quantity: Number(e.target.value) })}>
                      {Array.from({ length: Math.max(1, Math.min(MAX_QUANTITY, l.book.stock_quantity)) }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="Selling price">
                    <label className="visually-hidden" htmlFor={`po-price-${l.book.id}`}>
                      Selling price of {l.book.title}
                    </label>
                    <div className="ap-prefix ap-prefix-sm">
                      <span>₹</span>
                      <input
                        id={`po-price-${l.book.id}`}
                        className="input input-sm"
                        inputMode="decimal"
                        value={l.price}
                        onChange={(e) => change(l.book.id, { price: e.target.value.replace(/[^0-9.]/g, '').slice(0, 9) })}
                      />
                    </div>
                  </td>
                  <td className="num tnum" data-label="Amount">
                    {formatPrice((Number(l.price) || 0) * l.quantity)}
                  </td>
                  <td>
                    <button type="button" className="ap-icon-button" aria-label={`Remove ${l.book.title}`} onClick={() => setLines((current) => current.filter((x) => x.book.id !== l.book.id))}>
                      <Trash size={18} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="ap-card-body ap-po-total">
        <span>{plural(lines.reduce((n, l) => n + l.quantity, 0), 'book')}</span>
        <strong className="tnum">Order total {formatPrice(total)}</strong>
      </div>
      {error && (
        <p className="notice ap-card-notice" data-tone="error" role="alert">
          {error}
        </p>
      )}
      <div className="ap-po-actions">
        <button type="button" className="btn btn-outline" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn btn-dark" onClick={next}>
          Next
        </button>
      </div>
    </div>
  );
}

function CourierStep({ carrier, setCarrier, settings, onBack, onNext }) {
  const ready = { xpressbees: Boolean(settings?.warehouse_name), delhivery: Boolean(settings?.delhivery_warehouse_name) };
  return (
    <div className="ap-card">
      <div className="ap-card-body stack-sm">
        <h2 className="ap-card-title">Courier Partner</h2>
        <div className="ap-po-couriers" role="radiogroup" aria-label="Courier partner">
          {Object.entries(CARRIER_NAMES).map(([value, name]) => (
            <label key={value} className="ap-po-courier" data-checked={carrier === value || undefined}>
              <input type="radio" name="po-carrier" value={value} checked={carrier === value} onChange={() => setCarrier(value)} />
              <span>
                <strong>{name}</strong>
                <span className="ap-cell-meta">
                  {settings?.default_carrier === value ? 'Default for new orders. ' : ''}
                  {ready[value] ? 'Booked automatically; the cheapest courier is chosen.' : 'Its pickup address is not set in Shipping yet, so booking will fail.'}
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className="page-meta">The parcel is booked like any website order. You can change the courier later from Logistic.</p>
      </div>
      <div className="ap-po-actions">
        <button type="button" className="btn btn-outline" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn btn-dark" onClick={onNext}>
          Next
        </button>
      </div>
    </div>
  );
}

function ReviewStep({ customer, lines, carrier, onBack, onPlaced }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const busy = useRef(false);
  const shipping = shippingOf(customer);
  const total = lines.reduce((sum, l) => sum + Number(l.price) * l.quantity, 0);
  const cod = customer.payment === 'cod';

  async function place() {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      const order = await adminPlaceOrder({
        items: lines.map((l) => ({ book_id: l.book.id, quantity: l.quantity, price: Number(l.price) })),
        shipping,
        payment: customer.payment,
        carrier,
        altPhone: customer.alt,
      });
      onPlaced(order);
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  return (
    <div className="ap-card">
      <div className="ap-card-body ap-po-review">
        <section aria-labelledby="po-r-customer">
          <h2 id="po-r-customer" className="ap-card-title">
            Customer
          </h2>
          <address className="address">
            {shipping.name}, {shipping.phone}
            {customer.alt && ` (alternate ${customer.alt})`}
            <br />
            {shipping.address}, {shipping.city}, {shipping.state} {shipping.pincode}
          </address>
        </section>
        <section aria-labelledby="po-r-pay">
          <h2 id="po-r-pay" className="ap-card-title">
            Payment & courier
          </h2>
          <dl className="ap-kv">
            <div>
              <dt>Payment mode</dt>
              <dd>{cod ? 'COD' : 'Prepaid (already paid)'}</dd>
            </div>
            <div>
              <dt>Courier partner</dt>
              <dd>{CARRIER_NAMES[carrier]}</dd>
            </div>
          </dl>
        </section>
      </div>
      <div className="ap-table-wrap">
        <table className="ap-table">
          <thead>
            <tr>
              <th>Book</th>
              <th className="num">Quantity</th>
              <th className="num">Price</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.book.id}>
                <td>
                  {l.book.title}
                  <span className="ap-book-sku">SKU {l.book.sku}</span>
                </td>
                <td className="num tnum">{l.quantity}</td>
                <td className="num tnum">{formatPrice(l.price)}</td>
                <td className="num tnum">{formatPrice(Number(l.price) * l.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ap-card-body ap-po-total">
        <span>{cod ? `Cash to collect ${formatPrice(total)}` : 'Nothing to collect'}</span>
        <strong className="tnum">Order total {formatPrice(total)}</strong>
      </div>
      {error && (
        <p className="notice ap-card-notice" data-tone="error" role="alert">
          {error}
        </p>
      )}
      <div className="ap-po-actions">
        <button type="button" className="btn btn-outline" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn btn-dark" aria-busy={working || undefined} onClick={place}>
          {working && <span className="spinner" aria-hidden="true" />}
          Place order
        </button>
      </div>
    </div>
  );
}

// ShopDeck's Place Order: an order taken by phone or WhatsApp, entered in five steps.
// It then goes through Process orders like a website order.
function AdminPlaceOrder() {
  useDocumentTitle('Place order');
  const [step, setStep] = useState(0);
  const [customer, setCustomer] = useState(EMPTY_CUSTOMER);
  const [lines, setLines] = useState([]);
  const [carrier, setCarrier] = useState(null);
  const [placed, setPlaced] = useState(null);
  const settings = useAsync(() => getShippingSettings(), []);
  const chosenCarrier = carrier ?? settings.data?.default_carrier ?? 'xpressbees';
  const go = (n) => {
    setStep(n);
    window.scrollTo({ top: 0 });
  };

  function again() {
    setCustomer(EMPTY_CUSTOMER);
    setLines([]);
    setCarrier(null);
    setPlaced(null);
    go(0);
  }

  return (
    <div className="stack-sm ap-po">
      <PageHead title="Place order" />
      <div className="ap-card ap-card-body">
        <Stepper step={step} />
      </div>
      {step === 0 && <CustomerStep customer={customer} setCustomer={setCustomer} settings={settings.data} onNext={() => go(1)} />}
      {step === 1 && <ProductStep lines={lines} setLines={setLines} onBack={() => go(0)} onNext={() => go(2)} />}
      {step === 2 && <CourierStep carrier={chosenCarrier} setCarrier={setCarrier} settings={settings.data} onBack={() => go(1)} onNext={() => go(3)} />}
      {step === 3 && (
        <ReviewStep
          customer={customer}
          lines={lines}
          carrier={chosenCarrier}
          onBack={() => go(2)}
          onPlaced={(order) => {
            // Process orders shows single-book orders unless Clubbed is chosen.
            setPlaced({ ...order, clubbed: lines.reduce((n, l) => n + l.quantity, 0) > 1 });
            go(4);
          }}
        />
      )}
      {step === 4 && placed && (
        <div className="ap-card ap-card-body ap-po-done" role="status">
          <CheckCircle size={44} weight="fill" aria-hidden="true" />
          <h2 className="ap-card-title">Order {formatOrderNumber(placed.order_number)} placed</h2>
          <p className="page-meta">It is in Process orders at the Print step, and its parcel is queued for booking.</p>
          <div className="inline-actions">
            <Link className="btn btn-dark" to={`/admin/orders?q=${placed.order_number}${placed.clubbed ? '&items=clubbed' : ''}`}>
              Open in Process orders
            </Link>
            <button type="button" className="btn btn-outline" onClick={again}>
              Place another order
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminPlaceOrder;
