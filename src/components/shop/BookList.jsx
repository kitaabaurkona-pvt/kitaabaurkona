import BookItem from './BookItem';

/**
 * Iterates over an array of book data and renders a BookItem for each.
 * @param {object} props
 * @param {Array} props.books - Array of book objects.
 */
function BookList({ books }) {
  if (!books || books.length === 0) {
    return <p>No books found.</p>;
  }

  return (
    <section>
      {books.map((book) => (
        <BookItem key={book.id} book={book} />
      ))}
    </section>
  );
}

export default BookList;
