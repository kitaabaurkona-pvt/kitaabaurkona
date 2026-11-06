import { ORDER_STATUS_LABELS } from '../../utils/format';

function OrderStatus({ status }) {
  return (
    <span className="status" data-status={status}>
      {ORDER_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default OrderStatus;
