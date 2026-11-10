import { Link } from 'react-router-dom';

// The browser picks the copy that suits the screen: a phone loads the 480 or 828 pixel
// wide file, a desktop the full one. Banners are never wider than the store's 1280px.
const SIZES = '(min-width: 1280px) 1280px, 100vw';

function srcSetOf(banner) {
  if (!banner.widths?.length) return undefined;
  const copies = banner.widths.map((w) => `${banner.src.replace(/.webp$/, `-${w}.webp`)} ${w}w`);
  return [...copies, `${banner.src} ${banner.width}w`].join(', ');
}

// A piece of the owner's banner artwork that links somewhere real.
function Banner({ banner, eager = false, className = '' }) {
  return (
    <Link to={banner.href} className={`banner ${className}`.trim()}>
      <img
        src={banner.src}
        srcSet={srcSetOf(banner)}
        sizes={SIZES}
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
