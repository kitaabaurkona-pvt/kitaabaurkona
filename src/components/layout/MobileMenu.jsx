import { List } from '@phosphor-icons/react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { lazyPage } from '../../utils/lazyPage';
import { whenIdle } from '../../utils/whenIdle';

// The panel and its dialog code are a separate file: most visits never open the menu, so
// it is fetched once the page is idle (or on the first tap, if that comes sooner).
const loadPanel = () => import('./MobileMenuPanel');
const MobileMenuPanel = lazyPage(loadPanel);

function MobileMenu({ bottomNav = false }) {
  const [open, setOpen] = useState(false);
  // Once opened, the panel stays mounted so it can slide out when closed.
  const [used, setUsed] = useState(false);
  const pointerOpen = useRef(false);
  const button = useRef(null);

  useEffect(() => whenIdle(() => loadPanel().catch(() => {})), []);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={bottomNav ? "bottom-nav-item" : "icon-button menu-button"}
        aria-label={bottomNav ? undefined : "Open menu"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerDown={() => {
          pointerOpen.current = true;
          loadPanel().catch(() => {});
        }}
        onKeyDown={() => {
          pointerOpen.current = false;
        }}
        onClick={() => {
          setUsed(true);
          setOpen(true);
        }}
      >
        <List size={bottomNav ? 23 : 20} weight="regular" aria-hidden="true" />
        {bottomNav && <span>Menu</span>}
      </button>
      {used && (
        <Suspense fallback={null}>
          <MobileMenuPanel open={open} setOpen={setOpen} pointerOpen={pointerOpen} menuButton={button} />
        </Suspense>
      )}
    </>
  );
}

export default MobileMenu;
