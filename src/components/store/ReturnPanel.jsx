import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { listMyReturnRequests, withdrawReturnRequest } from '../../services/returnService';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../hooks/useToast';
import { formatDate, formatPrice } from '../../utils/format';
import { customerReturnState, formatRequestNumber, RETURN_KINDS, returnDeadline, returnErrorMessage } from '../../utils/returns';

function Withdraw({ request, onDone }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState(null);
  const busy = useRef(false);
  const { show } = useToast();

  async function withdraw() {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setFailure(null);
    try {
      await withdrawReturnRequest(request.id);
      show({ message: 'Request withdrawn' });
      onDone();
    } catch (err) {
      setFailure(returnErrorMessage(err) ?? 'The request could not be withdrawn. Try again.');
      setConfirming(false);
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  return (
    <div className="stack-sm return-withdraw">
      {confirming ? (
        <div className="inline-actions" role="group" aria-label="Confirm withdrawing">
          <button type="button" className="btn btn-danger btn-sm" aria-busy={working || undefined} onClick={withdraw}>
            {working && <span className="spinner" aria-hidden="true" />}
            Yes, withdraw
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirming(false)}>
            Keep request
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirming(true)}>
          Withdraw request
        </button>
      )}
      {failure && (
        <p className="notice" data-tone="error" role="alert">
          {failure}
        </p>
      )}
    </div>
  );
}

// "Return or exchange" on a customer's order: the way to ask (within the window), and
// where their request is.
function ReturnPanel({ order }) {
  const result = useAsync(() => listMyReturnRequests(order.id), [order.id]);
  const [now] = useState(() => Date.now());
  const requests = result.data ?? [];
  const deadline = returnDeadline(order);
  const latest = requests[0] ?? null;
  const open = requests.some((r) => r.stage !== 'closed');
  const done = requests.some((r) => r.outcome === 'passed');
  const canAsk = Boolean(deadline) && deadline.getTime() > now && !open && !done && order.origin !== 'exchange' && Boolean(result.data);

  if (!latest && !canAsk) return null;
  const state = latest ? customerReturnState(latest) : null;

  return (
    <section className="panel" aria-labelledby="return-heading">
      <div className="parcel-head">
        <h2 id="return-heading" className="panel-title">
          {latest ? `${RETURN_KINDS[latest.kind]} request ${formatRequestNumber(latest.request_number)}` : 'Return or exchange'}
        </h2>
        {state && (
          <span className="status return-status" data-tone={state.tone}>
            {state.label}
          </span>
        )}
      </div>
      <div className="stack-sm">
        {latest && (
          <>
            <p>{state.text}</p>
            <ul className="return-summary">
              {latest.items.map((i) => (
                <li key={i.sku}>
                  {i.title} × {i.quantity}
                </li>
              ))}
            </ul>
            <p className="page-meta">
              {latest.reason} · asked {formatDate(latest.created_at)}
            </p>
            {latest.refund_amount != null && latest.outcome === 'passed' && <p>{formatPrice(latest.refund_amount)} refunded.</p>}
            {latest.replacement_order_id && (
              <Link className="btn-link" to={`/orders/${latest.replacement_order_id}`}>
                View the replacement order
              </Link>
            )}
            {latest.stage === 'new' && <Withdraw request={latest} onDone={result.retry} />}
          </>
        )}
        {canAsk && (
          <>
            <p>You can return or exchange books from this order until {formatDate(deadline)}.</p>
            <div>
              <Link to={`/orders/${order.id}/return`} className="btn btn-outline">
                Return or exchange
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export default ReturnPanel;
