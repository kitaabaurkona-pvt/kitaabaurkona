// Facts about the store shown across the site (announcement bar, trust strip, footer,
// policy pages, terms). Everything here was confirmed by the owner; nothing is a
// sample. Change it here and every place that shows it follows.

export const STORE_NAME = 'Kitaabaurkona';

export const CONTACT = {
  phone: '+91 - 8690965448',
  phoneHref: 'tel:+918690965448',
  whatsapp: '+91 - 8690965448',
  whatsappHref: 'https://wa.me/918690965448',
  hours: 'Sun-Sat, 10 AM to 6 PM',
  email: 'Kitaabaurkona@gmail.com',
  address: '59 Nakoda Nagar, Hiran Magri Sector 3, Udaipur, Rajasthan 313002',
};

// Short line under the logo in the footer.
export const BLURB =
  'Kitaabaurkona: Your destination for books across fiction, self-help, comics, and more. Discover stories that inspire, entertain, and transform.';

// Offers the owner confirmed are true for every order today. Only these are shown.
export const ANNOUNCEMENTS = ['Free shipping on all orders', 'Cash on delivery available', 'Easy returns'];

export const TRUST_ITEMS = [
  { id: 'shipping', label: 'Free shipping' },
  { id: 'cod', label: 'Cash on delivery' },
  { id: 'returns', label: 'Easy returns' },
];

// The owner's own banner artwork (copied from the previous store).
export const BANNERS = {
  hero: {
    src: '/banners/collect-the-adventure.webp',
    alt: 'Collect the adventure: manga box sets, literary fiction, spirituality, academics and gifting, curated by readers and delivered anywhere in India.',
    href: '/books',
    width: 1672,
    height: 941,
    // Smaller copies (name-480.webp …) so phones download only what they show.
    widths: [480, 828, 1280],
  },
  trio: {
    src: '/banners/must-read-trio.webp',
    alt: 'The must-read trio: Atomic Habits, The Psychology of Money and The Subtle Art of Not Giving a F*ck.',
    href: '/books?category=Box%20Sets%20%26%20Combos',
    width: 1672,
    height: 941,
    widths: [480, 828, 1280],
  },
};
