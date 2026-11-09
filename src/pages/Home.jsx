import { Link } from 'react-router-dom';
import { listBooks, listCategoryCounts } from '../services/bookService';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatCount, formatPrice } from '../utils/format';
import { COLLECTIONS, UNDER_PRICE, categoryHref, dealsHref, regionalHref, underPriceHref } from '../utils/categories';
import { LoadError } from '../components/store/States';
import { SliderSkeleton, TilesSkeleton } from '../components/store/Skeletons';
import HeroSlider from '../components/home/HeroSlider';
import CollectionTiles from '../components/home/CollectionTiles';
import Shelf from '../components/home/Shelf';

const SLIDES = 5;
const SHELF = 10;
const COMBOS = 'Box Sets & Combos';

function Home() {
  useDocumentTitle('');
  const deals = useAsync(() => listBooks({ sort: 'discount', inStock: true, pageSize: SLIDES + SHELF }), []);
  const under = useAsync(() => listBooks({ sort: 'discount', inStock: true, maxPrice: UNDER_PRICE, pageSize: SHELF }), []);
  const combos = useAsync(() => listBooks({ sort: 'discount', inStock: true, category: COMBOS, pageSize: SHELF }), []);
  const regional = useAsync(() => listBooks({ sort: 'discount', collection: 'regional', pageSize: SHELF }), []);
  const counts = useAsync(() => listCategoryCounts(), []);
  const all = useAsync(() => listBooks({ pageSize: 1 }), []);

  const dealBooks = deals.data?.books ?? [];
  const dealsShelf = deals.data ? { ...deals, data: { ...deals.data, books: dealBooks.slice(SLIDES) } } : deals;

  return (
    <div className="container page home">
      {deals.loading && !deals.data && <SliderSkeleton />}
      {deals.error && <LoadError onRetry={deals.retry} what="books" />}
      {dealBooks.length > 0 && <HeroSlider books={dealBooks.slice(0, SLIDES)} />}

      {counts.loading && !counts.data && <TilesSkeleton />}
      {counts.data && (
        <CollectionTiles
          categoryCounts={counts.data}
          underCount={under.data?.total ?? 0}
          regionalCount={regional.data?.total ?? 0}
          topDiscount={dealBooks[0]?.discount_percent ?? 0}
        />
      )}

      <Shelf id="deals" title="Biggest discounts" href={dealsHref} tint="rose" state={dealsShelf} />
      <Shelf id="under" title={`Up to ${formatPrice(UNDER_PRICE)}`} href={underPriceHref} tint="sand" state={under} />
      <Shelf id="combos" title={COMBOS} href={categoryHref(COMBOS)} tint="lilac" state={combos} />
      <Shelf id="regional" title={COLLECTIONS.regional.label} href={regionalHref} tint="sky" state={regional} />

      {all.data && all.data.total > 0 && (
        <div className="home-browse">
          <Link to="/books" className="btn btn-outline">
            Browse all {formatCount(all.data.total)} books
          </Link>
        </div>
      )}
    </div>
  );
}

export default Home;
