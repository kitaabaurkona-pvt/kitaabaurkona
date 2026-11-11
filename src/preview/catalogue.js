import catalogue from './catalogue.json';
import { COLLECTIONS } from '../utils/categories';
export const previewBooks = catalogue;
export function previewList({ search = '', sort = 'title', inStock, category, maxPrice, collection, page = 0, pageSize = 24 } = {}) {
  let books = catalogue.filter(b => (!search || b.title.toLowerCase().includes(search.toLowerCase())) && (!inStock || b.stock_quantity > 0) && (!category || b.category === category) && (!maxPrice || b.price <= maxPrice) && (!COLLECTIONS[collection] || COLLECTIONS[collection].languages.some(l => b.title.toLowerCase().includes(l.toLowerCase()))));
  books = [...books].sort((a,b) => sort === 'price_asc' ? a.price-b.price : sort === 'price_desc' ? b.price-a.price : sort === 'discount' ? b.discount_percent-a.discount_percent : a.title.localeCompare(b.title));
  return { books: books.slice(page*pageSize, (page+1)*pageSize), total: books.length };
}
