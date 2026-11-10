import { Link } from 'react-router-dom';
import BookCover from './BookCover';
import PriceBlock from './PriceBlock';
import AddToCartButton from './AddToCartButton';
import SaveButton from './SaveButton';
import { bookDisplay } from '../../utils/bookDisplay';
function BookCard({ book, eager = false }) {
  const { title, author } = bookDisplay(book);
  return <article className="book-card">
    <div className="book-card-media"><SaveButton bookId={book.id} title={title} className="card-save"/>
    <Link className="card-media card-media-link" to={`/books/${book.id}`} aria-label={`View ${title}`}>
      <BookCover src={book.image_urls?.[0]} title={title} eager={eager} className="cover card-photo" />
    </Link></div>
    <div className="book-card-body">
      <h3 className="book-card-title"><Link to={`/books/${book.id}`} className="book-card-link">{title}</Link></h3>
      <p className="book-author">{author || book.category}</p>
      <PriceBlock price={book.price} mrp={book.mrp} />
      <AddToCartButton book={book} className="btn btn-primary btn-block btn-card" />
    </div>
  </article>;
}
export default BookCard;
