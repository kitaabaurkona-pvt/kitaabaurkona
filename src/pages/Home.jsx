import { Link } from 'react-router-dom';
import { listBooks } from '../services/bookService';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { coverOf, formatCount, formatPrice, stockLevel } from '../utils/format';
import BookCard from '../components/store/BookCard';
import BookCover from '../components/store/BookCover';
import PriceBlock from '../components/store/PriceBlock';
import AddToCartButton from '../components/store/AddToCartButton';
import { LoadError } from '../components/store/States';
import { FeaturedSkeleton, ShelfSkeleton } from '../components/store/Skeletons';
import { FadeIn } from '../components/motion/FadeIn';

const DEALS = 11;

// The book with the biggest discount that is in stock right now, straight from the
// catalogue: cover, title, price and one action. Nothing written about it is invented.
function Featured({ book }) {
  const stock = stockLevel(book.stock_quantity);
  const saving = Number(book.mrp) - Number(book.price);
  return (
    <FadeIn as="section" className="featured" aria-labelledby="featured-title">
      <Link to={`/books/${book.id}`} className="featured-cover" tabIndex={-1} aria-hidden="true">
        <BookCover src={coverOf(book)} title={book.title} eager />
        {book.discount_percent > 0 && <span className="cover-tag">−{book.discount_percent}%</span>}
      </Link>
      <div className="featured-body">
        <p className="eyebrow">Biggest discount in stock</p>
        <h1 id="featured-title" className="featured-title">
          <Link to={`/books/${book.id}`}>{book.title}</Link>
        </h1>
        <PriceBlock price={book.price} mrp={book.mrp} large />
        {saving > 0 && <p className="featured-saving">You save {formatPrice(saving)}</p>}
        {stock.level !== 'in' && (
          <p className="stock-line" data-level={stock.level}>
            {stock.label}
          </p>
        )}
        <div className="featured-actions">
          <AddToCartButton book={book} />
          <Link to={`/books/${book.id}`} className="btn btn-outline">
            View book
          </Link>
        </div>
      </div>
    </FadeIn>
  );
}

function Home() {
  useDocumentTitle('');
  const deals = useAsync(() => listBooks({ sort: 'discount', inStock: true, pageSize: DEALS }), []);
  const all = useAsync(() => listBooks({ pageSize: 1 }), []);
  const [featured, ...shelf] = deals.data?.books ?? [];

  return (
    <div className="container page home">
      {deals.loading && <FeaturedSkeleton />}
      {deals.error && <LoadError onRetry={deals.retry} what="books" />}
      {featured && <Featured book={featured} />}

      {(deals.loading || shelf.length > 0) && (
        <section className="section" aria-labelledby="deals-heading">
          <div className="section-head">
            <h2 id="deals-heading" className="section-title">
              Biggest discounts
            </h2>
            <Link className="section-link" to="/books?sort=discount&stock=1">
              See all
            </Link>
          </div>
          {deals.loading && <ShelfSkeleton />}
          {shelf.length > 0 && (
            <FadeIn as="ul" className="shelf">
              {shelf.map((book) => (
                <li key={book.id}>
                  <BookCard book={book} />
                </li>
              ))}
            </FadeIn>
          )}
        </section>
      )}

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
