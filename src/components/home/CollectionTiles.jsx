import { Link } from 'react-router-dom';
import { formatPrice, plural } from '../../utils/format';
import {
  COLLECTIONS,
  UNDER_PRICE,
  categoryHref,
  dealsHref,
  orderCategories,
  regionalHref,
  tintFor,
  underPriceHref,
} from '../../utils/categories';
import { FadeIn } from '../motion/FadeIn';
import { ArrowRightIcon } from '../icons';

function Tile({ to, label, meta, tint }) {
  return (
    <li>
      <Link to={to} className="tile" data-tint={tint}>
        <span className="tile-label">{label}</span>
        <span className="tile-meta">
          {meta}
          <ArrowRightIcon size={16} />
        </span>
      </Link>
    </li>
  );
}

// One tile per category that has books, then the collections worked out from the
// catalogue. Every count is read from the database.
function CollectionTiles({ categoryCounts, underCount, regionalCount, topDiscount }) {
  const names = orderCategories(Object.keys(categoryCounts));
  return (
    <section className="section tiles-section" aria-labelledby="browse-heading">
      <div className="section-head">
        <h2 id="browse-heading" className="section-title">
          Browse
        </h2>
      </div>
      <FadeIn as="ul" className="tiles">
        {names.map((name) => (
          <Tile key={name} to={categoryHref(name)} label={name} meta={plural(categoryCounts[name], 'book')} tint={tintFor(name)} />
        ))}
        {underCount > 0 && (
          <Tile
            to={underPriceHref}
            label={`Up to ${formatPrice(UNDER_PRICE)}`}
            meta={`${plural(underCount, 'book')} in stock`}
            tint="sand"
          />
        )}
        {regionalCount > 0 && (
          <Tile to={regionalHref} label={COLLECTIONS.regional.label} meta={plural(regionalCount, 'book')} tint="sky" />
        )}
        {topDiscount > 0 && <Tile to={dealsHref} label="Biggest discounts" meta={`Up to ${topDiscount}% off`} tint="rose" />}
      </FadeIn>
    </section>
  );
}

export default CollectionTiles;
