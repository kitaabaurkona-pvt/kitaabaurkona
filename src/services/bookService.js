import apiClient from './apiClient';
import { API_ROUTES } from '../utils/constants';

/**
 * Fetch all books, optionally filtered by query params.
 * @param {object} [params] - Optional filters (category, page, limit).
 */
export async function getBooks(params = {}) {
  const query = new URLSearchParams(params).toString();
  const endpoint = query ? `${API_ROUTES.BOOKS}?${query}` : API_ROUTES.BOOKS;
  return apiClient(endpoint);
}

/**
 * Fetch a single book by its ID.
 * @param {string|number} id
 */
export async function getBookById(id) {
  return apiClient(API_ROUTES.BOOK_BY_ID(id));
}

/**
 * Search books by a free-text query.
 * @param {string} query
 */
export async function searchBooks(query) {
  return apiClient(`${API_ROUTES.SEARCH_BOOKS}?q=${encodeURIComponent(query)}`);
}
