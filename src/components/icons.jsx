// Monoline icons on a 24px grid, 1.5px stroke, square ends (per the design system).
function Icon({ size = 22, children, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (p) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Icon>
);

export const BagIcon = (p) => (
  <Icon {...p}>
    <path d="M4.5 8.5h15l-1 12h-13z" />
    <path d="M8.5 8.5V7a3.5 3.5 0 0 1 7 0v1.5" />
  </Icon>
);

export const UserIcon = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M4.5 20.5c1-3.5 4-5.5 7.5-5.5s6.5 2 7.5 5.5" />
  </Icon>
);

export const StoreIcon = (p) => (
  <Icon {...p}>
    <path d="M3.5 9.5l1.5-5h14l1.5 5" />
    <path d="M3.5 9.5h17" />
    <path d="M5 9.5v10h14v-10" />
    <path d="M10 19.5v-5h4v5" />
  </Icon>
);

export const BookIcon = (p) => (
  <Icon {...p}>
    <path d="M4.5 4.5h6a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 0-1.5-1.5h-6z" />
    <path d="M19.5 4.5h-6A1.5 1.5 0 0 0 12 6v14a1.5 1.5 0 0 1 1.5-1.5h6z" />
  </Icon>
);

export const TagIcon = (p) => (
  <Icon {...p}>
    <path d="M3.5 3.5h8l9 9-8 8-9-9z" />
    <circle cx="8" cy="8" r="1.25" />
  </Icon>
);

export const BookmarkIcon = ({ filled, ...p }) => (
  <Icon {...p} fill={filled ? 'currentColor' : 'none'}>
    <path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" />
  </Icon>
);

export const ReceiptIcon = (p) => (
  <Icon {...p}>
    <path d="M5.5 3.5h13v17l-2.5-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2.5 1.5z" />
    <path d="M9 8.5h6M9 12h6" />
  </Icon>
);

export const PlusIcon = (p) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CheckIcon = (p) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const ArrowLeftIcon = (p) => (
  <Icon {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);
