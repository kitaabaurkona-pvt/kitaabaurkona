import { Link } from 'react-router-dom';
import { COLLECTIONS, UNDER_PRICE, categoryHref, dealsHref, orderCategories, regionalHref, underPriceHref } from '../../utils/categories';
import { formatPrice } from '../../utils/format';

function Links({ items, hidden = false }) {
  return (
    <ul aria-hidden={hidden || undefined}>
      {items.map((item) => (
        <li key={item.to}>
          <Link to={item.to} tabIndex={hidden ? -1 : undefined}>
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// A slow ribbon of every category and collection, scrolling across the page between
// sections. A second, hidden copy makes the loop seamless; hovering or focusing it pauses
// it. With Reduce animations it is a still row you can scroll sideways.
function CategoryRibbon({ categories }) {
  const items = [
    ...orderCategories(categories).map((name) => ({ to: categoryHref(name), label: name })),
    { to: dealsHref, label: 'Biggest discounts' },
    { to: underPriceHref, label: `Up to ${formatPrice(UNDER_PRICE)}` },
    { to: regionalHref, label: COLLECTIONS.regional.label },
  ];
  return (
    <nav className="ribbon" aria-label="All categories">
      <div className="ribbon-track">
        <Links items={items} />
        <Links items={items} hidden />
      </div>
    </nav>
  );
}

export default CategoryRibbon;
