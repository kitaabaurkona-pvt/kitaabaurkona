import { useEffect, useRef, useState } from 'react';
import { getMyShipments, SHIPMENT_STATUS_LABELS, trackOrder } from '../../services/shippingService';
import { formatDate } from '../../utils/format';

// The parcel for an order: where it is, the courier and AWB, and the tracking history.
// Shows what the database knows at once, then asks the courier for an update (the
// shipping function does that at most every 10 minutes per parcel).
const MOVED = ['in_transit', 'out_for_delivery', 'delivered', 'exception', 'rto'];

// onMoved: called when fresh tracking shows the parcel has left, so the page can reload
// the order (its status changes to shipped or delivered).
function ShipmentCard({ orderId, placedAt, onMoved }) {
  const [shipments, setShipments] = useState(null);
  // The latest callback, without re-running the tracking request when it changes.
  const movedRef = useRef(onMoved);
  useEffect(() => {
    movedRef.current = onMoved;
  }, [onMoved]);

  useEffect(() => {
    let active = true;
    getMyShipments(orderId).then(
      (rows) => {
        if (!active) return;
        setShipments(rows);
        if (rows.some((s) => s.awb_number)) {
          trackOrder(orderId).then(
            (fresh) => {
              if (!active || !fresh.length) return;
              setShipments(fresh);
              const before = new Set(rows.map((s) => s.status));
              if (fresh.some((s) => MOVED.includes(s.status) && !before.has(s.status))) movedRef.current?.();
            },
            () => {},
          );
        }
      },
      () => active && setShipments([]),
    );
    return () => {
      active = false;
    };
  }, [orderId]);

  const visible = (shipments ?? []).filter((s) => s.status !== 'cancelled');
  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((s) => {
        const history = Array.isArray(s.history) ? s.history : [];
        if (s.kind === 'forward') return <DeliverySteps key={`forward-${s.awb_number ?? 'pending'}`} shipment={s} history={history} placedAt={placedAt} />;
        return (
          <section key={`${s.kind}-${s.awb_number ?? 'pending'}`} className="panel" aria-labelledby={`parcel-${s.kind}`}>
            <div className="parcel-head">
              <h2 id={`parcel-${s.kind}`} className="panel-title">
                {s.kind === 'reverse' ? 'Return pickup' : 'Delivery'}
              </h2>
              <span className="status" data-status={s.status}>
                {SHIPMENT_STATUS_LABELS[s.status] ?? s.status}
              </span>
            </div>
            {s.awb_number && (
              <dl className="parcel-facts">
                {s.courier_name && (
                  <div>
                    <dt>Courier</dt>
                    <dd>{s.courier_name.replace(/\s*\d+(\.\d+)?\s*K\.?G\.?$/i, '')}</dd>
                  </div>
                )}
                <div>
                  <dt>Tracking number</dt>
                  <dd className="tnum">{s.awb_number}</dd>
                </div>
              </dl>
            )}
            <History history={history} />
          </section>
        );
      })}
    </>
  );
}

function History({ history }) {
  if (history.length === 0) return null;
  return (
    <ol className="parcel-history">
      {history.map((e, i) => (
        <li key={`${e.at}-${i}`}>
          <span className="parcel-event">{e.message || e.code}</span>
          <span className="page-meta">{[e.location, e.at].filter(Boolean).join(' · ')}</span>
        </li>
      ))}
    </ol>
  );
}

// The delivery as the customer follows it: Order placed → Shipped → Delivered. Booking
// with the courier happens behind the scenes; the courier and tracking number appear
// once the courier has picked the parcel up.
const STEP_OF = { in_transit: 1, out_for_delivery: 1, exception: 1, rto: 1, delivered: 2 };
const PROBLEMS = ['exception', 'rto', 'cancel_requested'];

function DeliverySteps({ shipment: s, history, placedAt }) {
  const step = STEP_OF[s.status] ?? 0;
  const shipped = step >= 1;
  const steps = [
    { label: 'Order placed', detail: placedAt ? formatDate(placedAt) : '' },
    { label: 'Shipped', detail: '' },
    { label: 'Delivered', detail: '' },
  ];
  return (
    <section className="panel" aria-labelledby="parcel-forward">
      <h2 id="parcel-forward" className="panel-title">
        Delivery
      </h2>
      <ol className="order-steps">
        {steps.map((item, i) => (
          <li key={item.label} data-state={i < step || step === 2 ? 'done' : i === step ? 'current' : 'todo'} aria-current={i === step ? 'step' : undefined}>
            <span className="order-step-dot" aria-hidden="true" />
            <span className="order-step-label">{item.label}</span>
            {item.detail && <span className="order-step-detail">{item.detail}</span>}
          </li>
        ))}
      </ol>
      {PROBLEMS.includes(s.status) && (
        <p className="notice" role="status">
          {SHIPMENT_STATUS_LABELS[s.status]}
        </p>
      )}
      {shipped && s.awb_number && (
        <dl className="parcel-facts">
          {s.courier_name && (
            <div>
              <dt>Courier</dt>
              <dd>{courierName(s.courier_name)}</dd>
            </div>
          )}
          <div>
            <dt>Tracking number</dt>
            <dd className="tnum">{s.awb_number}</dd>
          </div>
        </dl>
      )}
      {!shipped && <p className="page-meta">Tracking appears here once the courier picks up your parcel.</p>}
      {shipped && <History history={history} />}
    </section>
  );
}

// "Delhivery Surface 0.5 K.G" → "Delhivery Surface".
const courierName = (name) => name.replace(/\s*\d+(\.\d+)?\s*K\.?G\.?$/i, '');

export default ShipmentCard;
