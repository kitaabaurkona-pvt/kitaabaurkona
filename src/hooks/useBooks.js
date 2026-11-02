import { useState, useEffect, useCallback } from 'react';
import { getBooks, getBookById, searchBooks } from '../services/bookService';

/**
 * Custom hook for fetching and managing book data.
 * Handles loading state, errors, and exposes fetch actions.
 */
export function useBooks() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchBooks = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getBooks(params);
      setBooks(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBookById = useCallback(async (id) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getBookById(id);
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const search = useCallback(async (query) => {
    setLoading(true);
    setError(null);
    try {
      const data = await searchBooks(query);
      setBooks(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch all books on mount
  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  return { books, loading, error, fetchBooks, fetchBookById, search };
}
