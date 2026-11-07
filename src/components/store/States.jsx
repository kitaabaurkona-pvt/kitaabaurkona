export function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function StateBlock({ title, icon: Icon, children }) {
  return (
    <div className="state">
      {Icon && (
        <span className="state-icon" aria-hidden="true">
          <Icon size={26} />
        </span>
      )}
      <p className="state-title">{title}</p>
      {children && <div className="state-actions">{children}</div>}
    </div>
  );
}

export function LoadError({ onRetry, what = 'this page' }) {
  return (
    <StateBlock title={`Couldn't load ${what}. Check your connection and try again.`}>
      <button type="button" className="btn btn-dark" onClick={onRetry}>
        Try again
      </button>
    </StateBlock>
  );
}
