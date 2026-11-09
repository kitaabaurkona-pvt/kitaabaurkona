import { listBooks, listCategorySummary } from '../services/bookService';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatPrice } from '../utils/format';
import { COLLECTIONS, UNDER_PRICE, categoryHref, dealsHref, regionalHref, underPriceHref } from '../utils/categories';
import { BANNERS } from '../utils/storeInfo';
import { LoadError } from '../components/store/States';
import { BookGridSkeleton, CirclesSkeleton } from '../components/store/Skeletons';
import BookCard from '../components/store/BookCard';
import Reveal from '../components/motion/Reveal';
import HeroCarousel from '../components/home/HeroCarousel';
import CategoryCircles from '../components/home/CategoryCircles';
import TrustStrip from '../components/home/TrustStrip';
import Banner from '../components/home/Banner';
import ProductCarousel from '../components/home/ProductCarousel';
import SectionHead from '../components/home/SectionHead';

const HERO_BOOKS = 3;
const ROW = 10;
const ALL = 8;
const COMBOS = 'Box Sets & Combos';

// Laid out like the previous store: banner slider, SHOP BY CATEGORY, the black trust
// strip, the second banner, rows of deals, then ALL PRODUCTS. Every book, count and
// cover comes from the catalogue.
function Home() {
  useDocumentTitle('');
  const deals = useAsync(() => listBooks({ sort: 'discount', inStock: true, pageSize: HERO_BOOKS + ROW }), []);
  const under = useAsync(() => listBooks({ sort: 'discount', inStock: true, maxPrice: UNDER_PRICE, pageSize: ROW }), []);
  const combos = useAsync(() => listBooks({ sort: 'discount', inStock: true, category: COMBOS, pageSize: ROW }), []);
  const regional = useAsync(() => listBooks({ sort: 'discount', collection: 'regional', pageSize: ROW }), []);
  const summary = useAsync(() => listCategorySummary(), []);
  const all = useAsync(() => listBooks({ pageSize: ALL }), []);

  const dealBooks = deals.data?.books ?? [];
  const dealsRow = deals.data ? { ...deals, data: { ...deals.data, books: dealBooks.slice(HERO_BOOKS) } } : deals;

  return (
    <div className="home">
      <div className="hero-wrap">
        {/* The banner shows at once; the deal slides join it when they arrive. */}
        <HeroCarousel books={dealBooks.slice(0, HERO_BOOKS)} />
      </div>

      <div className="container">
        {summary.loading && !summary.data && <CirclesSkeleton />}
        {summary.data && <CategoryCircles summary={summary.data} />}
      </div>

      <TrustStrip />

      <Reveal className="banner-wrap">
        <Banner banner={BANNERS.trio} />
      </Reveal>

      <div className="container">
        <ProductCarousel id="deals" title="Amazing deals" href={dealsHref} state={dealsRow} autoplay={4000} />
        <ProductCarousel id="under" title={`Up to ${formatPrice(UNDER_PRICE)}`} href={underPriceHref} state={under} />
        <ProductCarousel id="combos" title={COMBOS} href={categoryHref(COMBOS)} state={combos} />
        <ProductCarousel id="regional" title={COLLECTIONS.regional.label} href={regionalHref} state={regional} />

        <section className="home-section" aria-labelledby="all-heading">
          <SectionHead id="all-heading" title="All products" href="/books" />
          {all.loading && !all.data && <BookGridSkeleton count={ALL} />}
          {all.error && <LoadError onRetry={all.retry} what="books" />}
          {all.data && (
            <ul className="book-grid">
              {all.data.books.map((book, index) => (
                <Reveal as="li" key={book.id} index={index % 4}>
                  <BookCard book={book} />
                </Reveal>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export default Home;
