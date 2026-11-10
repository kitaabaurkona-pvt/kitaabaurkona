import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDownIcon } from '../icons';

const OPEN_DELAY = 120;
const CLOSE_DELAY = 150;

// A dropdown in the header's nav row (FICTION, NON-FICTION, MORE). Opens on hover after
// a short pause (so passing over it does nothing), on click, or with Enter / Arrow down;
// Escape, a click elsewhere, moving away or leaving it with Tab closes it.
// links: [{ to, label }]
function NavMenu({ label, links, groups, current = false }) {
  const { pathname, search } = useLocation();
  const here = pathname + search;
  const [openOn, setOpenOn] = useState(null);
  const open = openOn === here;
  const timer = useRef(null);
  // After Escape the menu stays shut while the pointer is still over it.
  const dismissed = useRef(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const panelId = useId();

  const setOpen = useCallback((value) => setOpenOn(value ? here : null), [here]);
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
        clearTimeout(timer.current);
        dismissed.current = true;
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
      dismissed.current = false;
      setOpen(true);
      requestAnimationFrame(() => rootRef.current?.querySelector('.nav-menu-panel a')?.focus());
    }
  }

  if (links.length === 0) return null;

  return (
    <div
      className="nav-menu"
      ref={rootRef}
      onMouseEnter={() => {
        if (!dismissed.current) later(() => setOpen(true), OPEN_DELAY);
      }}
      onMouseLeave={() => {
        dismissed.current = false;
        later(() => setOpen(false), CLOSE_DELAY);
      }}
      onBlur={(event) => {
        if (open && !rootRef.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="nav-link nav-menu-button"
        aria-expanded={open}
        aria-controls={panelId}
        data-current={current || undefined}
        onClick={() => {
          clearTimeout(timer.current);
          dismissed.current = false;
          setOpen(!open);
        }}
        onKeyDown={onButtonKeyDown}
      >
        {label}
        <ChevronDownIcon size={14} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            className={groups ? "nav-menu-panel grouped-book-menu" : "nav-menu-panel"}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15, ease: [0.25, 0.8, 0.25, 1] }}
          >
            {groups ? <div className="book-menu-groups">{groups.map(group => <section key={group.label}><h3>{group.label}</h3><ul>{group.links.map(link => <li key={link.to}><Link to={link.to} className="nav-menu-link">{link.label}</Link></li>)}</ul></section>)}</div> : <ul>
              {links.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="nav-menu-link">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default NavMenu;
