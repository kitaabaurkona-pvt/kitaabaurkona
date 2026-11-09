import { CashIcon, ReturnIcon, TruckIcon } from '../icons';
import { TRUST_ITEMS } from '../../utils/storeInfo';

const ICONS = { shipping: TruckIcon, cod: CashIcon, returns: ReturnIcon };

function Items({ hidden = false }) {
  return (
    <ul className="trust-items" aria-hidden={hidden || undefined}>
      {TRUST_ITEMS.map(({ id, label }) => {
        const Icon = ICONS[id];
        return (
          <li key={id} className="trust-item">
            {Icon && <Icon size={26} />}
            <span>{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

// Black band with the store's real promises. On phones it scrolls slowly in a loop
// (a second, hidden copy makes the loop seamless); elsewhere it is a still row.
function TrustStrip() {
  return (
    <section className="trust-strip" aria-label="Why shop with us">
      <div className="trust-marquee">
        <Items />
        <Items hidden />
      </div>
    </section>
  );
}

export default TrustStrip;
