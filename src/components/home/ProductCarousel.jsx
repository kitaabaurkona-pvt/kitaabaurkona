import Carousel from '../motion/Carousel';
import Reveal from '../motion/Reveal';
import BookCard from '../store/BookCard';
import { CarouselSkeleton } from '../store/Skeletons';
import { LoadError } from '../store/States';
import SectionHead from './SectionHead';

// A titled row of book cards that slides like the previous store's product rows.
// Not shown at all when it has no books.
function ProductCarousel({ id, title, href, state, autoplay = 0 }) {
  const books = state.data?.books ?? [];
  if (state.loading && !state.data) {
    return (
      <section className="home-section" aria-labelledby={`${id}-heading`}>
        <SectionHead id={`${id}-heading`} title={title} href={href} />
        <CarouselSkeleton />
      </section>
    );
  }
  if (state.error) {
    return (
      <section className="home-section" aria-labelledby={`${id}-heading`}>
        <SectionHead id={`${id}-heading`} title={title} href={href} />
        <LoadError onRetry={state.retry} what="books" />
      </section>
    );
  }
  if (books.length === 0) return null;
  return (
    <Reveal as="section" className="home-section product-row" aria-labelledby={`${id}-heading`}>
      <SectionHead id={`${id}-heading`} title={title} href={href} />
      <Carousel label={title} itemLabel="book" perView={{ 0: 2, 768: 3, 1024: 4 }} autoplay={autoplay} loop={false}>
        {books.map((book) => (
          <BookCard key={book.id} book={book} />
        ))}
      </Carousel>
    </Reveal>
  );
}

export default ProductCarousel;
