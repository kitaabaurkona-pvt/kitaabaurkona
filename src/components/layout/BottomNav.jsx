import { NavLink } from 'react-router-dom';
import { BookIcon, BookmarkIcon, StoreIcon, TagIcon, UserIcon } from '../icons';

const TABS = [
  { to: '/', label: 'Store', Icon: StoreIcon, end: true },
  { to: '/books', label: 'Books', Icon: BookIcon },
  { to: '/offers', label: 'Offers', Icon: TagIcon },
  { to: '/wishlist', label: 'Wishlist', Icon: BookmarkIcon },
  { to: '/account', label: 'Account', Icon: UserIcon },
];

function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Main">
      {TABS.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end}>
          <Icon size={22} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default BottomNav;
