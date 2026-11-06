import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listWishlist, removeFromWishlist } from '../services/wishlistService';
import { useAsync } from '../hooks/useAsync';
import { useCart } from '../hooks/useCart';
import { useWishlist } from '../hooks/useWishlist';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { announce } from '../utils/announce';
import { coverOf, plural, stockLevel } from '../utils/format';
import { MAX_QUANTITY } from '../utils/storeForm';
import BookCover from '../components/store/BookCover';
import PriceBlock from '../components/store/PriceBlock';
import AddToCartButton from '../components/store/AddToCartButton';
import { LoadError, Loading, StateBlock } from '../components/store/States';

function Wishlist() {
  useDocumentTitle('Wishlist');
  const { data, loading, error, retry, setData } = useAsync(() => listWishlist(), []);
  const { forget } = useWishlist();
  const { add, quantityOf } = useCart();
  const [removeFailed, setRemoveFailed] = useState(null);
  const books = data ?? [];
  const addable = books.filter((book) => book.stock_quantity > 0 && quantityOf(book.id) < Math.min(book.stock_quantity, MAX_QUANTITY));

  async function handleRemove(book) {
    setRemoveFailed(null);
    try {
      await removeFromWishlist(book.id);
      forget(book.id);
      setData(books.filter((b) => b.id !== book.id));
      announce(`${book.title} removed from wishlist`);
    } catch {
      setRemoveFailed(book.id);
    }
  }

  function addAll() {
    for (const book of addable) add(book.id, 1, Math.min(book.stock_quantity, MAX_QUANTITY));
    announce(`${plural(addable.length, 'book')} added to cart`);
  }

  return (
    <div className="container page">
      <div className="page-head">
        <h1 className="page-title">Wishlist</h1>
        {books.length > 0 && <p className="page-meta">{plural(books.length, 'book')} saved</p>}
      </div>

      {loading && !data && <Loading label="Loading your wishlist…" />}
      {error && <LoadError onRetry={retry} what="your wishlist" />}
      {data && books.length === 0 && (
        <StateBlock title="You haven't saved any books yet.">
          <Link to="/books" className="btn btn-dark">
            Browse books
          </Link>
        </StateBlock>
      )}
      {books.length > 0 && (
        <>
          {addable.length > 0 && (
            <div className="inline-actions filter-row">
              <button type="button" className="btn btn-dark" onClick={addAll}>
                Add {plural(addable.length, 'book')} to cart
              </button>
            </div>
          )}
          <ul className="line-list">
            {books.map((book) => {
              const stock = stockLevel(book.stock_quantity);
              return (
                <li key={book.id} className="line">
                  <Link to={`/books/${book.id}`} className="line-cover" tabIndex={-1} aria-hidden="true">
                    <BookCover src={coverOf(book)} title={book.title} />
                  </Link>
                  <div className="line-body">
                    <h2 className="line-title">
                      <Link to={`/books/${book.id}`}>{book.title}</Link>
                    </h2>
                    <PriceBlock price={book.price} mrp={book.mrp} />
                    {stock.level !== 'in' && (
                      <p className="stock-line" data-level={stock.level}>
                        {stock.label}
                      </p>
                    )}
                    <div className="line-actions">
                      <AddToCartButton book={book} className="btn btn-primary btn-sm" />
                      <button type="button" className="btn-link" onClick={() => handleRemove(book)}>
                        Remove
                      </button>
                    </div>
                    {removeFailed === book.id && (
                      <p className="field-message" role="alert">
                        Couldn't remove this book. Try again.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export default Wishlist;
