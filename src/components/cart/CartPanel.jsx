import { Suspense, useEffect, useState } from 'react';
import { useCartLines } from '../../hooks/useCartLines';
import { lazyPage } from '../../utils/lazyPage';
import { whenIdle } from '../../utils/whenIdle';

// The slide-out cart and its dialog code are a separate file, fetched once the page is
// idle (or when the cart is opened, if that comes sooner), so they are not part of what
// the first screen waits for.
const loadDialog = () => import('./CartPanelDialog');
const CartPanelDialog = lazyPage(loadDialog);

function CartPanel() {
  const { cartOpen } = useCartLines();
  // Once opened, the panel stays mounted so it can slide out when closed.
  const [used, setUsed] = useState(cartOpen);
  if (cartOpen && !used) setUsed(true);

  useEffect(() => whenIdle(() => loadDialog().catch(() => {})), []);

  if (!used) return null;
  return (
    <Suspense fallback={null}>
      <CartPanelDialog />
    </Suspense>
  );
}

export default CartPanel;
