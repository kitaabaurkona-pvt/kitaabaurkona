import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { X } from '@phosphor-icons/react';
import { getOrder } from '../services/orderService';
import { listMyReturnRequests, requestReturn, RETURN_PHOTO_ACCEPT, ReturnPhotoError, uploadReturnPhoto } from '../services/returnService';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import { formatDate, formatOrderNumber, formatPrice } from '../utils/format';
import { RETURN_PHOTO_LIMIT, RETURN_PHOTO_REASONS, RETURN_REASONS, RETURN_WINDOW_DAYS, returnDeadline, returnErrorMessage, UPI_PATTERN } from '../utils/returns';
import BookCover from '../components/store/BookCover';
import { LoadError, StateBlock } from '../components/store/States';
import { LinesSkeleton } from '../components/store/Skeletons';

async function load(id) {
  const [order, requests] = await Promise.all([getOrder(id), listMyReturnRequests(id)]);
  return { order, requests };
}

// Photos chosen for the request: shown at once, uploaded one by one.
function PhotoPicker({ photos, onChange, required, error }) {
  const input = useRef(null);
  const [failure, setFailure] = useState(null);
  const room = RETURN_PHOTO_LIMIT - photos.length;
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(files) {
    setFailure(null);
    const chosen = [...files].slice(0, room);
    if (files.length > room) setFailure(`Add up to ${RETURN_PHOTO_LIMIT} photos.`);
    for (const file of chosen) {
      const entry = { key: `${file.name}-${file.lastModified}-${Math.random()}`, preview: URL.createObjectURL(file), path: null, state: 'uploading' };
      onChange((list) => [...list, entry]);
      try {
        const path = await uploadReturnPhoto(file);
        onChange((list) => list.map((p) => (p.key === entry.key ? { ...p, path, state: 'done' } : p)));
      } catch (err) {
        URL.revokeObjectURL(entry.preview);
        onChange((list) => list.filter((p) => p.key !== entry.key));
        setFailure(err instanceof ReturnPhotoError ? err.message : 'The photo could not be uploaded. Try again.');
      }
    }
  }

  return (
    <fieldset className="return-fieldset">
      <legend className="label">
        Photos{required ? ' (needed for this reason)' : ''}
      </legend>
      <div className="return-photos">
        {photos.map((p) => (
          <div key={p.key} className="return-photo" aria-busy={p.state === 'uploading' || undefined}>
            <img src={p.preview} alt="" />
            {p.state === 'uploading' && <span className="spinner" aria-label="Uploading" />}
            <button
              type="button"
              className="return-photo-remove"
              aria-label="Remove this photo"
              onClick={() => {
                URL.revokeObjectURL(p.preview);
                onChange((list) => list.filter((x) => x.key !== p.key));
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
        {room > 0 && (
          <button type="button" className="return-photo-add" onClick={() => input.current?.click()}>
            Add photo
          </button>
        )}
      </div>
      <input
        ref={input}
        id="return-photo-input"
        className="visually-hidden"
        type="file"
        accept={RETURN_PHOTO_ACCEPT}
        multiple
        tabIndex={-1}
        onChange={(e) => {
          add(e.target.files ?? []);
          e.target.value = '';
        }}
      />
      {(failure || error) && (
        <p className="field-message" role="alert">
          {failure || error}
        </p>
      )}
    </fieldset>
  );
}

function ReturnForm({ order }) {
  const navigate = useNavigate();
  const { show } = useToast();
  const [kind, setKind] = useState('return');
  const [picked, setPicked] = useState(() => (order.order_items.length === 1 ? { [order.order_items[0].sku]: order.order_items[0].quantity } : {}));
  const [reason, setReason] = useState('');
  const [remark, setRemark] = useState('');
  const [upi, setUpi] = useState('');
  const [photos, setPhotos] = useState([]);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const cod = order.payment_method === 'cod' && Number(order.amount_paid ?? 0) === 0;
  const needsPhoto = RETURN_PHOTO_REASONS.includes(reason);
  const items = Object.entries(picked).map(([sku, quantity]) => ({ sku, quantity }));
  const value = order.order_items.reduce((sum, i) => sum + (picked[i.sku] ?? 0) * Number(i.unit_price), 0);

  async function submit(event) {
    event.preventDefault();
    if (busy.current) return;
    const next = {};
    if (items.length === 0) next.items = 'Choose the books to send back.';
    if (!reason) next.reason = 'Choose a reason.';
    if (reason === 'Other' && !remark.trim()) next.remark = 'Tell us what is wrong.';
    if (needsPhoto && !photos.some((p) => p.path)) next.photos = 'Add a photo that shows the problem.';
    if (kind === 'return' && upi.trim() && !UPI_PATTERN.test(upi.trim())) next.upi = 'That UPI ID does not look right.';
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length) return;
    if (photos.some((p) => p.state === 'uploading')) return setFailure('Wait for the photos to finish uploading.');
    busy.current = true;
    setWorking(true);
    try {
      await requestReturn({ orderId: order.id, kind, items, reason, remark: remark.trim(), photos: photos.map((p) => p.path).filter(Boolean), refundUpi: kind === 'return' ? upi.trim() : '' });
      show({ message: kind === 'exchange' ? 'Exchange request sent' : 'Return request sent' });
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (err) {
      setFailure(returnErrorMessage(err) ?? 'Your request could not be sent. Try again.');
      busy.current = false;
      setWorking(false);
    }
  }

  return (
    <form className="stack return-form" onSubmit={submit} noValidate>
      <fieldset className="return-fieldset">
        <legend className="label">What would you like?</legend>
        <div className="return-choice" role="radiogroup" aria-label="Return or exchange">
          {[
            ['return', 'Return', 'Send the books back for a refund'],
            ['exchange', 'Exchange', 'Get the same books again'],
          ].map(([value, title, text]) => (
            <label key={value} className="return-option" data-checked={kind === value || undefined}>
              <input type="radio" name="return-kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
              <span className="return-option-title">{title}</span>
              <span className="page-meta">{text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="return-fieldset">
        <legend className="label">Books to send back</legend>
        <ul className="return-lines">
          {order.order_items.map((item) => {
            const on = picked[item.sku] != null;
            return (
              <li key={item.sku} className="return-line" data-checked={on || undefined}>
                <label className="return-line-pick">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setPicked((current) => {
                        const next = { ...current };
                        if (on) delete next[item.sku];
                        else next[item.sku] = item.quantity;
                        return next;
                      })
                    }
                  />
                  <span className="return-line-cover">
                    <BookCover src={item.image_url} title={item.title} />
                  </span>
                  <span className="return-line-body">
                    <span className="return-line-title">{item.title}</span>
                    <span className="page-meta">
                      {formatPrice(item.unit_price)} × {item.quantity}
                    </span>
                  </span>
                </label>
                {on && item.quantity > 1 && (
                  <div className="return-line-qty">
                    <label className="visually-hidden" htmlFor={`return-qty-${item.sku}`}>
                      Copies of {item.title}
                    </label>
                    <select id={`return-qty-${item.sku}`} className="select select-sm" value={picked[item.sku]} onChange={(e) => setPicked((c) => ({ ...c, [item.sku]: Number(e.target.value) }))}>
                      {Array.from({ length: item.quantity }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n} {n === 1 ? 'copy' : 'copies'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {errors.items && (
          <p className="field-message" role="alert">
            {errors.items}
          </p>
        )}
      </fieldset>

      <div>
        <label className="label" htmlFor="return-reason">
          Reason
        </label>
        <select id="return-reason" className="select" value={reason} aria-invalid={Boolean(errors.reason) || undefined} onChange={(e) => setReason(e.target.value)}>
          <option value="">Choose a reason</option>
          {RETURN_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {errors.reason && (
          <p className="field-message" role="alert">
            {errors.reason}
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="return-remark">
          Tell us more
        </label>
        <textarea id="return-remark" className="textarea" rows={3} maxLength={300} value={remark} aria-invalid={Boolean(errors.remark) || undefined} onChange={(e) => setRemark(e.target.value)} />
        {errors.remark && (
          <p className="field-message" role="alert">
            {errors.remark}
          </p>
        )}
      </div>

      <PhotoPicker photos={photos} onChange={setPhotos} required={needsPhoto} error={errors.photos} />

      {kind === 'return' && cod && (
        <div>
          <label className="label" htmlFor="return-upi">
            UPI ID for your refund
          </label>
          <input id="return-upi" className="input" autoComplete="off" placeholder="name@bank" value={upi} aria-invalid={Boolean(errors.upi) || undefined} onChange={(e) => setUpi(e.target.value)} />
          {errors.upi && (
            <p className="field-message" role="alert">
              {errors.upi}
            </p>
          )}
        </div>
      )}

      {items.length > 0 && kind === 'return' && <p className="return-value">Refund value: {formatPrice(value)}</p>}

      {failure && (
        <p className="notice" data-tone="error" role="alert">
          {failure}
        </p>
      )}
      <div className="inline-actions">
        <button type="submit" className="btn btn-dark" aria-busy={working || undefined}>
          {working && <span className="spinner" aria-hidden="true" />}
          {kind === 'exchange' ? 'Request exchange' : 'Request return'}
        </button>
        <Link to={`/orders/${order.id}`} className="btn btn-outline">
          Back to order
        </Link>
      </div>
    </form>
  );
}

// A customer's return or exchange request for a delivered order (within the window).
function ReturnRequest() {
  const { id } = useParams();
  const { data, loading, error, retry } = useAsync(() => load(id), [id]);
  const [now] = useState(() => Date.now());
  useDocumentTitle('Return or exchange');
  const order = data?.order;

  let body;
  if (loading && !data) body = <LinesSkeleton count={3} label="Loading order…" />;
  else if (error) body = <LoadError onRetry={retry} what="this order" />;
  else if (!order) {
    body = (
      <StateBlock title="This order could not be found.">
        <Link to="/orders" className="btn btn-dark">
          View your orders
        </Link>
      </StateBlock>
    );
  } else {
    const deadline = returnDeadline(order);
    const open = data.requests.find((r) => r.stage !== 'closed');
    const done = data.requests.some((r) => r.outcome === 'passed');
    let blocked = null;
    if (order.origin === 'exchange') blocked = 'This order is a replacement. Contact us if something is wrong with it.';
    else if (!deadline) blocked = 'Only a delivered order can be returned or exchanged.';
    else if (open) blocked = 'This order already has a return or exchange request.';
    else if (done) blocked = 'This order was already returned or exchanged.';
    else if (deadline.getTime() < now) blocked = `The ${RETURN_WINDOW_DAYS}-day return window closed on ${formatDate(deadline)}.`;
    body = blocked ? (
      <StateBlock title={blocked}>
        <Link to={`/orders/${order.id}`} className="btn btn-dark">
          Back to order
        </Link>
      </StateBlock>
    ) : (
      <ReturnForm order={order} />
    );
  }

  return (
    <div className="container page page-narrow">
      <nav aria-label="Breadcrumb">
        <ol className="breadcrumb">
          <li>
            <Link to="/orders">Orders</Link>
          </li>
          {order && (
            <li>
              <Link to={`/orders/${order.id}`}>{formatOrderNumber(order.order_number)}</Link>
            </li>
          )}
          <li aria-current="page">Return or exchange</li>
        </ol>
      </nav>
      <h1 className="page-title">Return or exchange</h1>
      {body}
    </div>
  );
}

export default ReturnRequest;
