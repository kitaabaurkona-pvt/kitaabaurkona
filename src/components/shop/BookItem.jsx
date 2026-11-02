import { Link } from 'react-router-dom';
import { formatCurrency } from '../../utils/formatCurrency';

/**
 * Individual book card / data binding.
 * @param {object} props
 * @param {object} props.book - Book data object ({ id, title, author, price, coverUrl }).
 */
function BookItem({ book }) {
  return (
    <article>
      <h3>{book.title}</h3>
      <p>{book.author}</p>
      <p>{formatCurrency(book.price)}</p>
      <Link to={`/products/${book.id}`}>View Details</Link>
    </article>
  );
}

export default BookItem;
