import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listBooks } from '../services/bookService';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatCount } from '../utils/format';
import BookCard from '../components/store/BookCard';
import { LoadError, Loading } from '../components/store/States';
import { SearchIcon } from '../components/icons';

function Home() {
  useDocumentTitle('');
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const deals = useAsync(() => listBooks({ sort: 'discount', inStock: true, pageSize: 8 }), []);
  const catalogue = useAsync(() => listBooks({ sort: 'title', pageSize: 8 }), []);

  function handleSearch(event) {
    event.preventDefault();
    const q = term.trim();
    navigate(q ? `/books?q=${encodeURIComponent(q)}` : '/books');
  }

  return (
    <div className="container page">
      <h1 className="visually-hidden">Kitaabaurkona bookstore</h1>

      <form className="search-form" role="search" onSubmit={handleSearch}>
        <label htmlFor="home-search" className="visually-hidden">
          Search books by title
        </label>
        <input
          id="home-search"
          className="input"
          type="search"
          placeholder="Search books by title"
          maxLength={100}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" aria-label="Search">
          <SearchIcon size={20} />
        </button>
      </form>

      <section className="section section-first" aria-labelledby="deals-heading">
        <div className="section-head">
          <h2 id="deals-heading" className="section-title">
            Biggest discounts
          </h2>
          <Link className="section-link" to="/books?sort=discount&stock=1">
            See all
          </Link>
        </div>
        {deals.loading && <Loading label="Loading books…" />}
        {deals.error && <LoadError onRetry={deals.retry} what="books" />}
        {deals.data && (
          <ul className="shelf">
            {deals.data.books.map((book, index) => (
              <li key={book.id}>
                <BookCard book={book} eager={index < 2} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="catalogue-heading">
        <div className="section-head">
          <h2 id="catalogue-heading" className="section-title">
            All books
          </h2>
          {catalogue.data && <span className="page-meta">{formatCount(catalogue.data.total)} titles</span>}
        </div>
        {catalogue.loading && <Loading label="Loading books…" />}
        {catalogue.error && <LoadError onRetry={catalogue.retry} what="books" />}
        {catalogue.data && (
          <>
            <ul className="book-grid">
              {catalogue.data.books.map((book) => (
                <li key={book.id}>
                  <BookCard book={book} />
                </li>
              ))}
            </ul>
            <div className="load-more">
              <Link to="/books" className="btn btn-outline">
                View all {formatCount(catalogue.data.total)} books
              </Link>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default Home;
