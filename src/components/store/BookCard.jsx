import { Link } from 'react-router-dom';
import { coverOf, stockLevel } from '../../utils/format';
import BookCover from './BookCover';
import PriceBlock from './PriceBlock';
import AddToCartButton from './AddToCartButton';

function BookCard({ book, eager = false }) {
  const stock = stockLevel(book.stock_quantity);
  return (
    <article className="book-card">
      <Link to={`/books/${book.id}`} className="book-card-link">
        <div className="cover-wrap">
          <BookCover src={coverOf(book)} title={book.title} eager={eager} />
          {book.discount_percent > 0 && <span className="cover-tag">−{book.discount_percent}%</span>}
        </div>
        <h3 className="book-card-title">{book.title}</h3>
      </Link>
      <div className="book-card-foot">
        <PriceBlock price={book.price} mrp={book.mrp} />
        {stock.level !== 'in' && (
          <p className="stock-line" data-level={stock.level}>
            {stock.label}
          </p>
        )}
        <AddToCartButton book={book} label="Add" className="btn btn-quiet" />
      </div>
    </article>
  );
}

export default BookCard;
