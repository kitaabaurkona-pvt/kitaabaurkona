import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { listCategories } from '../../services/bookService';
import { useAsync } from '../../hooks/useAsync';
import {
  COLLECTIONS,
  FICTION,
  NON_FICTION,
  UNDER_PRICE,
  categoryHref,
  dealsHref,
  regionalHref,
  tintFor,
  underPriceHref,
} from '../../utils/categories';
import { formatPrice } from '../../utils/format';
import { ChevronDownIcon } from '../icons';

const OPEN_DELAY = 120;
const CLOSE_DELAY = 150;

function CategoryLink({ name }) {
  return (
    <li>
      <Link to={categoryHref(name)} className="menu-link">
        <span className="swatch" data-tint={tintFor(name)} aria-hidden="true" />
        {name}
      </Link>
    </li>
  );
}

// Desktop "Books" menu: genres in two columns plus collections. Opens on hover after a
// short pause (so passing the mouse over it does nothing), on click, or with Enter /
// Arrow down; Escape, a click elsewhere, or leaving it closes it.
function BooksMenu() {
  const { pathname } = useLocation();
  const [openOn, setOpenOn] = useState(null);
  const open = openOn === pathname;
  const timer = useRef(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const panelId = useId();
  const categories = useAsync(() => listCategories(), []);
  const names = categories.data ?? [];
  const fiction = FICTION.filter((name) => names.includes(name));
  const nonFiction = NON_FICTION.filter((name) => names.includes(name));

  const setOpen = useCallback((value) => setOpenOn(value ? pathname : null), [pathname]);
  const later = (fn, ms) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, setOpen]);

  function onButtonKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => rootRef.current?.querySelector('.books-menu-panel a')?.focus());
    }
  }

  return (
    <div
      className="books-menu"
      ref={rootRef}
      onMouseEnter={() => later(() => setOpen(true), OPEN_DELAY)}
      onMouseLeave={() => later(() => setOpen(false), CLOSE_DELAY)}
      onBlur={(event) => {
        if (open && !rootRef.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="books-menu-button"
        aria-expanded={open}
        aria-controls={panelId}
        data-current={pathname.startsWith('/books') || undefined}
        onClick={() => {
          clearTimeout(timer.current);
          setOpen(!open);
        }}
        onKeyDown={onButtonKeyDown}
      >
        Books
        <ChevronDownIcon size={16} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            className="books-menu-panel"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="container books-menu-grid">
              {fiction.length > 0 && (
                <nav aria-label="Fiction">
                  <h2>Fiction</h2>
                  <ul>
                    {fiction.map((name) => (
                      <CategoryLink key={name} name={name} />
                    ))}
                  </ul>
                </nav>
              )}
              {nonFiction.length > 0 && (
                <nav aria-label="Non-fiction">
                  <h2>Non-fiction</h2>
                  <ul>
                    {nonFiction.map((name) => (
                      <CategoryLink key={name} name={name} />
                    ))}
                  </ul>
                </nav>
              )}
              <nav aria-label="Collections">
                <h2>Collections</h2>
                <ul>
                  <li>
                    <Link to="/books" className="menu-link">
                      All books
                    </Link>
                  </li>
                  <li>
                    <Link to={dealsHref} className="menu-link">
                      Biggest discounts
                    </Link>
                  </li>
                  <li>
                    <Link to={underPriceHref} className="menu-link">
                      Up to {formatPrice(UNDER_PRICE)}
                    </Link>
                  </li>
                  <li>
                    <Link to={regionalHref} className="menu-link">
                      {COLLECTIONS.regional.label}
                    </Link>
                  </li>
                </ul>
              </nav>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default BooksMenu;
