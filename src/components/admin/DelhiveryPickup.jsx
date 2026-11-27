import { useState } from 'react';
import { requestDelhiveryPickup } from '../../services/shippingService';
import { useToast } from '../../hooks/useToast';

// Today's date in India, as YYYY-MM-DD.
const indiaToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

// Delhivery collects parcels only when asked: a date, a time and how many parcels.
function DelhiveryPickup({ waiting, onDone }) {
  const [date, setDate] = useState(indiaToday);
  const [time, setTime] = useState('14:00');
  const [count, setCount] = useState(() => String(Math.max(1, waiting)));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const { show } = useToast();

  async function submit(event) {
    event.preventDefault();
    if (working) return;
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 500) return setError('Enter how many parcels (1 to 500).');
    if (!/^\d{2}:\d{2}$/.test(time)) return setError('Choose a pickup time.');
    setWorking(true);
    setError(null);
    try {
      const r = await requestDelhiveryPickup({ date, time, count: n });
      show({ message: `Delhivery pickup ${r.pickup_id} requested for ${r.date} at ${r.time}` });
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <form className="panel stack-sm" onSubmit={submit} noValidate aria-labelledby="dl-pickup-heading">
      <h2 id="dl-pickup-heading" className="panel-title">
        Delhivery pickup
      </h2>
      <p className="page-meta">{waiting === 1 ? '1 Delhivery parcel is' : `${waiting} Delhivery parcels are`} booked and waiting to be collected.</p>
      <div className="form-grid form-grid-2">
        <div>
          <label className="label" htmlFor="dl-pickup-date">
            Date
          </label>
          <input id="dl-pickup-date" className="input" type="date" min={indiaToday()} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="dl-pickup-time">
            Time
          </label>
          <input id="dl-pickup-time" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="dl-pickup-count">
            Parcels
          </label>
          <input id="dl-pickup-count" className="input" inputMode="numeric" maxLength={3} value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} />
        </div>
      </div>
      {error && (
        <p className="notice" data-tone="error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button type="submit" className="btn btn-dark" aria-busy={working}>
          {working && <span className="spinner" aria-hidden="true" />}
          Request Delhivery pickup
        </button>
      </div>
    </form>
  );
}

export default DelhiveryPickup;
