import { Link } from 'react-router-dom';

export default function BrandLink() {
  return (
    <Link to="/" className="brand-logo brand-lockup" aria-label="Kitaab Aur Kona home">
      <img src="/images/brand/kitaab-aur-kona-dark.svg" width="230" height="44" alt="" />
    </Link>
  );
}
