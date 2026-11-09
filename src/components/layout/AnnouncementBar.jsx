import Carousel from '../motion/Carousel';
import { ANNOUNCEMENTS } from '../../utils/storeInfo';

// Black strip above the header with the store's real, standing offers. Slides to the
// next one every 4s like the previous store.
function AnnouncementBar() {
  if (ANNOUNCEMENTS.length === 0) return null;
  return (
    <div className="announcement-bar">
      <Carousel label="Store offers" itemLabel="offer" autoplay={4000} arrows={false} dots={false}>
        {ANNOUNCEMENTS.map((text) => (
          <p key={text} className="announcement">
            {text}
          </p>
        ))}
      </Carousel>
    </div>
  );
}

export default AnnouncementBar;
