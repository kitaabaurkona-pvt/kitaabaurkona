import { useEffect, useRef, useState } from 'react';
import { CalendarBlank } from '@phosphor-icons/react';

const dayMonth = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' });

// One date range control: the chosen days, with the two dates in a small pop-up.
function DateRange({ id = 'orders', label = 'Date Range', from, to, onChange }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!box.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const show = (day) => dayMonth.format(new Date(`${day}T00:00:00+05:30`));
  const text = from || to ? `${from ? show(from) : '…'} – ${to ? show(to) : '…'}` : label;
  return (
    <div className="ap-range" ref={box}>
      <button type="button" className="ap-range-button" data-empty={!(from || to) || undefined} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{text}</span>
        <CalendarBlank size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="ap-range-pop" role="group" aria-label={label}>
          <label className="label" htmlFor={`${id}-from`}>
            From
          </label>
          <input id={`${id}-from`} className="input input-sm" type="date" value={from} max={to || undefined} onChange={(e) => onChange({ from: e.target.value })} />
          <label className="label" htmlFor={`${id}-to`}>
            To
          </label>
          <input id={`${id}-to`} className="input input-sm" type="date" value={to} min={from || undefined} onChange={(e) => onChange({ to: e.target.value })} />
          {(from || to) && (
            <button type="button" className="btn-link" onClick={() => onChange({ from: '', to: '' })}>
              Clear dates
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default DateRange;
