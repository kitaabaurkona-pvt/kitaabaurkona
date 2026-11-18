// "Added to cart" animation: a copy of the book's cover lifts off the page and curves
// into the header cart, shrinking as it goes, then the cart icon gives a small bounce.
// The horizontal and vertical movements use different easings (on two nested layers),
// which is what bends the straight line into an arc.
//
// While a cover is in the air the header keeps showing the previous count, and the
// badge updates as it lands (see `cartFlights` below and SiteHeader).

const DURATION = 680;
const MAX_FLIGHTS = 4;

let inAir = 0;
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

// A tiny store for useSyncExternalStore: how many covers are flying right now.
export const cartFlights = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  count: () => inAir,
};

// The picture to copy: the photo currently shown on the card (hover can swap it), the
// cover image, or the cover box itself when the image failed to load. On a book's own
// page the buy buttons (also the phone's purchase bar) take the main gallery cover.
export function coverFrom(element) {
  const root = element?.closest('.book-card, .hero-deal, .detail, .line, .product-page');
  if (!root) return null;
  return (
    root.querySelector('.card-photo-extra[data-shown]') ??
    root.querySelector('.gallery-slide[data-active] .cover img') ??
    root.querySelector('.cover img') ??
    root.querySelector('.cover')
  );
}

function bounce(target) {
  // The header animates its own icon when the count changes; do not bounce it twice.
  if (target.querySelector('.cart-icon-motion')) return;
  const icon = target.querySelector('svg') ?? target;
  icon.animate?.(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.22) rotate(-6deg)', offset: 0.35 }, { transform: 'scale(0.96)', offset: 0.7 }, { transform: 'scale(1)' }],
    { duration: 420, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' },
  );
}

// The cart button the cover flies to: the header's, or the floating one that stands in
// for it once the header has scrolled away.
function cartTarget() {
  const onScreen = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
  };
  return [...document.querySelectorAll('.floating-cart, .cart-button')].find(onScreen) ?? null;
}

export function flyToCart(source) {
  const target = cartTarget();
  if (!source || !target || typeof source.getBoundingClientRect !== 'function' || !document.body.animate) return;
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (!from.width || !from.height || !to.width || inAir >= MAX_FLIGHTS) {
    bounce(target);
    return;
  }

  // Never larger than a thumbnail, whatever the size of the photo it starts from.
  const width = Math.min(from.width, 120);
  const height = Math.min(from.height * (width / from.width), 170);
  const startX = from.left + from.width / 2 - width / 2;
  const startY = from.top + from.height / 2 - height / 2;
  const dx = to.left + to.width / 2 - (startX + width / 2);
  const dy = to.top + to.height / 2 - (startY + height / 2);

  const across = document.createElement('div');
  across.className = 'cart-flight';
  across.setAttribute('aria-hidden', 'true');
  across.style.left = `${startX}px`;
  across.style.top = `${startY}px`;
  across.style.width = `${width}px`;
  across.style.height = `${height}px`;

  const up = document.createElement('div');
  up.className = 'cart-flight-lift';
  const card = document.createElement('div');
  card.className = 'cart-flight-card';
  const src = source.currentSrc || source.src;
  if (source.tagName === 'IMG' && src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    card.append(img);
  }
  up.append(card);
  across.append(up);
  document.body.append(across);

  inAir += 1;
  emit();

  const timing = { duration: DURATION, fill: 'forwards' };
  const animations = [
    across.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dx}px)` }], { ...timing, easing: 'cubic-bezier(0.5, 0, 0.85, 0.45)' }),
    up.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${dy}px)` }], { ...timing, easing: 'cubic-bezier(0.15, 0.55, 0.3, 1)' }),
    card.animate(
      [
        { transform: 'scale(1) rotate(0deg)', opacity: 1, boxShadow: '0 2px 6px rgb(0 0 0 / 0.12)' },
        { transform: 'scale(1.06) rotate(-3deg)', opacity: 1, boxShadow: '0 14px 30px rgb(0 0 0 / 0.22)', offset: 0.18 },
        { transform: 'scale(0.16) rotate(6deg)', opacity: 0.35, boxShadow: '0 2px 6px rgb(0 0 0 / 0.1)' },
      ],
      { ...timing, easing: 'cubic-bezier(0.55, 0, 0.7, 0.4)' },
    ),
  ];

  let done = false;
  const land = () => {
    if (done) return;
    done = true;
    across.remove();
    inAir -= 1;
    emit();
    bounce(target);
  };
  Promise.all(animations.map((a) => a.finished)).then(land, land);
  // In case the tab is hidden and animations are paused.
  setTimeout(land, DURATION + 500);
}
