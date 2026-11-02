// API route constants and global configuration
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

export const API_ROUTES = {
  BOOKS: '/books',
  BOOK_BY_ID: (id) => `/books/${id}`,
  SEARCH_BOOKS: '/books/search',
  CART: '/cart',
  CART_SYNC: '/cart/sync',
  CHECKOUT: '/cart/checkout',
  LOGIN: '/auth/login',
  REGISTER: '/auth/register',
  LOGOUT: '/auth/logout',
  PROFILE: '/user/profile',
  ORDERS: '/user/orders',
};

export const CATEGORIES = [
  'Fiction',
  'Non-Fiction',
  'Science',
  'Technology',
  'History',
  'Biography',
  'Children',
  'Self-Help',
];

export const CURRENCY = 'USD';
export const LOCALE = 'en-US';
