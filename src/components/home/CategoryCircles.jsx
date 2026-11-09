import { Link } from 'react-router-dom';
import Carousel from '../motion/Carousel';
import Reveal from '../motion/Reveal';
import SectionHead from './SectionHead';
import { categoryHref, orderCategories } from '../../utils/categories';

// "SHOP BY CATEGORY": a round cover for each category with books (the biggest in-stock
// deal in it), sliding like the previous store's circles.
function CategoryCircles({ summary }) {
  const names = orderCategories(Object.keys(summary)).filter((name) => summary[name].count > 0);
  if (names.length === 0) return null;
  return (
    <Reveal as="section" className="home-section circles-section" aria-labelledby="circles-heading">
      <SectionHead id="circles-heading" title="Shop by category" />
      <Carousel label="Categories" itemLabel="category" perView={{ 0: 3, 600: 4, 1024: 5 }} loop={false}>
        {names.map((name) => (
          <Link key={name} to={categoryHref(name)} className="circle">
            <span className="circle-photo">
              {summary[name].cover ? (
                <img src={summary[name].cover} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              ) : (
                <span className="circle-fallback" aria-hidden="true">
                  {name.charAt(0)}
                </span>
              )}
            </span>
            <span className="circle-label">{name}</span>
          </Link>
        ))}
      </Carousel>
    </Reveal>
  );
}

export default CategoryCircles;
