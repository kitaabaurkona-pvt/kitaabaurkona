import { Link } from 'react-router-dom';
import { coverOf, stockLevel } from '../../utils/format';
import BookCover from './BookCover';
import PriceBlock from './PriceBlock';
import AddToCartButton from './AddToCartButton';
import SaveButton from './SaveButton';

function BookCard({ book, eager = false }) {
  const stock = stockLevel(book.stock_quantity);
  return (
    <article className="book-card">
      <Link to={`/books/${book.id}`} className="book-card-link">
        <div className="cover-wrap">
          <BookCover src={coverOf(book)} title={book.title} eager={eager} />
          <div className="cover-badges">
            {book.discount_percent > 0 ? <span className="tag tag-accent">{book.discount_percent}% off</span> : <span />}
          </div>
        </div>
        <h3 className="book-card-title">{book.title}</h3>
        <PriceBlock price={book.price} mrp={book.mrp} />
        {stock.level !== 'in' && (
          <p className="stock-line" data-level={stock.level}>
            {stock.label}
          </p>
        )}
      </Link>
      <div className="book-card-actions">
        <AddToCartButton book={book} label="Add" />
        <SaveButton bookId={book.id} title={book.title} />
      </div>
    </article>
  );
}

export default BookCard;
