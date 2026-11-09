import { formatPrice } from '../../utils/format';

// Price, struck-through MRP and (with `showOff`) the green "70% OFF", as on the
// previous store. The percentage is the book's own discount from the database.
function PriceBlock({ price, mrp, discount = 0, showOff = false, large = false }) {
  const discounted = Number(mrp) > Number(price);
  return (
    <div className="price-block">
      <span className={large ? 'price price-lg' : 'price'}>{formatPrice(price)}</span>
      {discounted && (
        <>
          <span className="visually-hidden">MRP</span>
          <s className="mrp">{formatPrice(mrp)}</s>
          {showOff && discount > 0 && <span className="price-off">{discount}% OFF</span>}
        </>
      )}
    </div>
  );
}

export default PriceBlock;
