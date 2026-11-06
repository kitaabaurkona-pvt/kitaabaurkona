function QuantityStepper({ value, min = 1, max, onChange, label, small = false }) {
  return (
    <div className={small ? 'stepper stepper-sm' : 'stepper'} role="group" aria-label={label}>
      <button type="button" aria-label="Decrease quantity" disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label="Increase quantity" disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

export default QuantityStepper;
