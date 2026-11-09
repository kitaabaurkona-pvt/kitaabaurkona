import { Link } from 'react-router-dom';
import Carousel from '../motion/Carousel';
import BookCover from '../store/BookCover';
import PriceBlock from '../store/PriceBlock';
import AddToCartButton from '../store/AddToCartButton';
import Banner from './Banner';
import { coverOf, stockLevel } from '../../utils/format';
import { BANNERS } from '../../utils/storeInfo';

// A real book with one of the biggest discounts in stock, laid out at the banner's size.
function DealSlide({ book }) {
  const stock = stockLevel(book.stock_quantity);
  return (
    <div className="hero-deal">
      <Link to={`/books/${book.id}`} className="hero-deal-media" tabIndex={-1} aria-hidden="true">
        <BookCover src={coverOf(book)} title={book.title} />
      </Link>
      <div className="hero-deal-body">
        <p className="hero-deal-eyebrow">Biggest discounts</p>
        <h2 className="hero-deal-title">
          <Link to={`/books/${book.id}`}>{book.title}</Link>
        </h2>
        <PriceBlock price={book.price} mrp={book.mrp} discount={book.discount_percent} showOff large />
        {stock.level !== 'in' && (
          <p className="stock-line" data-level={stock.level}>
            {stock.label}
          </p>
        )}
        <div className="hero-deal-actions">
          <AddToCartButton book={book} />
          <Link to={`/books/${book.id}`} className="btn btn-outline">
            View book
          </Link>
        </div>
      </div>
    </div>
  );
}

// Top of the home page: the owner's banner first, then real deal books, sliding
// sideways every 5s like the previous store.
function HeroCarousel({ books }) {
  return (
    <Carousel label="Featured" itemLabel="slide" autoplay={5000} className="hero-carousel">
      <Banner banner={BANNERS.hero} eager className="hero-banner" />
      {books.map((book) => (
        <DealSlide key={book.id} book={book} />
      ))}
    </Carousel>
  );
}

export default HeroCarousel;
