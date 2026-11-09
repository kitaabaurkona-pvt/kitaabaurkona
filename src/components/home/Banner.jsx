import { Link } from 'react-router-dom';

// A full-width piece of the owner's banner artwork that links somewhere real.
function Banner({ banner, eager = false, className = '' }) {
  return (
    <Link to={banner.href} className={`banner ${className}`.trim()}>
      <img
        src={banner.src}
        alt={banner.alt}
        width={banner.width}
        height={banner.height}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={eager ? 'high' : undefined}
      />
    </Link>
  );
}

export default Banner;
