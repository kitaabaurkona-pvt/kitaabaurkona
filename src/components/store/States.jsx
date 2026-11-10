import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
export function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function StateBlock({ title, description, icon: Icon, tone, children }) {
  return (
    <div className="state" data-tone={tone} role={tone === 'error' ? 'alert' : undefined}>
      {Icon && (
        <span className="state-icon" aria-hidden="true">
          <Icon size={26} />
        </span>
      )}
      <p className="state-title">{title}</p>
      {description && <p className="state-description">{description}</p>}
      {children && <div className="state-actions">{children}</div>}
    </div>
  );
}

export function LoadError({ onRetry, what = 'this page' }) {
  return (
    <StateBlock title={`We couldn’t load ${what}.`} description="Something interrupted the request. Try again in a moment." icon={WarningCircle} tone="error">
      {onRetry && <button type="button" className="btn btn-primary" onClick={onRetry}>
        <ArrowClockwise size={18} aria-hidden="true" /> Try again
      </button>}
    </StateBlock>
  );
}
