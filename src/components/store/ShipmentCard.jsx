import { useEffect, useRef, useState } from 'react';
import { getMyShipments, SHIPMENT_STATUS_LABELS, trackOrder } from '../../services/shippingService';

// The parcel for an order: where it is, the courier and AWB, and the tracking history.
// Shows what the database knows at once, then asks the courier for an update (the
// shipping function does that at most every 10 minutes per parcel).
const MOVED = ['in_transit', 'out_for_delivery', 'delivered', 'exception', 'rto'];

// onMoved: called when fresh tracking shows the parcel has left, so the page can reload
// the order (its status changes to shipped or delivered).
function ShipmentCard({ orderId, onMoved }) {
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
            {!s.awb_number && s.kind === 'forward' && <p className="page-meta">Your parcel is being packed. Tracking appears here once it is handed to the courier.</p>}
            {history.length > 0 && (
              <ol className="parcel-history">
                {history.map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    <span className="parcel-event">{e.message || e.code}</span>
                    <span className="page-meta">
                      {[e.location, e.at].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </>
  );
}

export default ShipmentCard;
