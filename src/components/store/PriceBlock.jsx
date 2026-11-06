import { formatPrice } from '../../utils/format';

function PriceBlock({ price, mrp, large = false }) {
  const discounted = Number(mrp) > Number(price);
  return (
    <div className="price-block">
      <span className={large ? 'price price-lg' : 'price'}>{formatPrice(price)}</span>
      {discounted && (
        <>
          <span className="visually-hidden">MRP</span>
          <s className="mrp">{formatPrice(mrp)}</s>
        </>
      )}
    </div>
  );
}

export default PriceBlock;
