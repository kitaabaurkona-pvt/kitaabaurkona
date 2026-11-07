// Placeholder shapes shown while data loads, in the same layout as the real content
// so nothing jumps when it arrives. Hidden from screen readers; a status line says
// what is loading.

function LoadingLabel({ label }) {
  return (
    <p className="visually-hidden" role="status">
      {label}
    </p>
  );
}

export function BookCardSkeleton() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <span className="skeleton" />
      <span className="skeleton skeleton-text" style={{ width: '90%' }} />
      <span className="skeleton skeleton-text" style={{ width: '60%' }} />
      <span className="skeleton skeleton-text" style={{ width: '40%', height: 20 }} />
      <span className="skeleton" style={{ height: 40, marginTop: 16 }} />
    </div>
  );
}

export function BookGridSkeleton({ count = 8, label = 'Loading books…' }) {
  return (
    <>
      <LoadingLabel label={label} />
      <ul className="book-grid" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <li key={i}>
            <BookCardSkeleton />
          </li>
        ))}
      </ul>
    </>
  );
}

export function ShelfSkeleton({ count = 5, label = 'Loading books…' }) {
  return (
    <>
      <LoadingLabel label={label} />
      <ul className="shelf" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <li key={i}>
            <BookCardSkeleton />
          </li>
        ))}
      </ul>
    </>
  );
}

export function LinesSkeleton({ count = 3, label = 'Loading…' }) {
  return (
    <>
      <LoadingLabel label={label} />
      <div className="line-list" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="skeleton-line">
            <span className="skeleton" />
            <div>
              <span className="skeleton skeleton-text" style={{ width: '70%', marginTop: 0 }} />
              <span className="skeleton skeleton-text" style={{ width: '30%' }} />
              <span className="skeleton skeleton-text" style={{ width: '45%' }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function StatsSkeleton({ count = 4, label = 'Loading figures…', className = 'stat-grid' }) {
  return (
    <>
      <LoadingLabel label={label} />
      <div className={className} aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="stat">
            <span className="skeleton" style={{ width: 56, height: 28 }} />
            <span className="skeleton skeleton-text" style={{ width: '60%' }} />
          </div>
        ))}
      </div>
    </>
  );
}

export function DetailSkeleton() {
  return (
    <div className="container page">
      <LoadingLabel label="Loading book…" />
      <div className="detail" aria-hidden="true">
        <div>
          <span className="skeleton" style={{ aspectRatio: '2 / 3' }} />
        </div>
        <div>
          <span className="skeleton" style={{ height: 36, width: '80%' }} />
          <span className="skeleton skeleton-text" style={{ width: '50%' }} />
          <span className="skeleton" style={{ height: 200, marginTop: 24 }} />
          <span className="skeleton skeleton-text" style={{ width: '95%', marginTop: 32 }} />
          <span className="skeleton skeleton-text" style={{ width: '90%' }} />
          <span className="skeleton skeleton-text" style={{ width: '70%' }} />
        </div>
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="container page">
      <LoadingLabel label="Loading page…" />
      <div aria-hidden="true">
        <span className="skeleton" style={{ height: 40, width: 220 }} />
        <span className="skeleton" style={{ height: 160, marginTop: 24 }} />
        <span className="skeleton skeleton-text" style={{ width: '80%', marginTop: 24 }} />
        <span className="skeleton skeleton-text" style={{ width: '60%' }} />
      </div>
    </div>
  );
}
