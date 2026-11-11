import GenreSlider from '../components/home/GenreSlider';
import Reveal from '../components/motion/Reveal';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowRight, Heart, Detective, Sparkle, Plant, Books, BookOpen } from '@phosphor-icons/react';
import { getBooksByIds, listBooks } from '../services/bookService';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { categoryHref, underPriceHref } from '../utils/categories';
import { featuredIds } from '../utils/featuredBooks';
import { bookDisplay } from '../utils/bookDisplay';
import { LoadError } from '../components/store/States';
import { BookGridSkeleton } from '../components/store/Skeletons';
import BookCard from '../components/store/BookCard';
const genres = [
  {name:'Romance', category:'Romance', mood:'A little heart-flutter', Icon:Heart},
  {name:'Mystery', category:'Thriller & Mystery', mood:'Just one more chapter', Icon:Detective},
  {name:'Fantasy', category:'Fantasy', mood:'Somewhere far from here', Icon:Sparkle},
  {name:'Self-help', category:'Self-Help', mood:'A little room to grow', Icon:Plant},
  {name:'Manga', category:'Comics & Manga', mood:'A whole new world', Icon:Books},
];
const heroImages = ['/images/hero-dawn-of-onyx.webp','/images/hero-everything-about-love.webp','/images/hero-heartstopper.webp'];
const heroIds = ['e3f2ead5-b9e1-462a-8b47-7e868375f002','fd249dd4-5f1c-43fa-8052-dab6cf224bbc','6b811028-74fe-45aa-972d-46f3af1a3b46'];
export default function Home() {
  useDocumentTitle('Find your next favourite.');
  const featured = useAsync(() => getBooksByIds(featuredIds), []);
  const hero = useAsync(() => getBooksByIds(heroIds), []);
  const affordable = useAsync(() => listBooks({ inStock:true, maxPrice:299, pageSize:4 }), []);
  return <div className="reading-home container">
    <section className="bento-hero" aria-labelledby="hero-title">
      <div className="bento-main">
        <div className="bento-main-copy"><p className="eyebrow"><BookOpen size={17}/> Your little reading corner</p><h1 id="hero-title">What’s your <span>next read?</span></h1><p className="hero-description">Browse by genre or discover a new favourite.</p><Link to="/books?stock=1" className="btn btn-primary hero-cta">Browse books <ArrowUpRight size={20}/></Link></div>
        <div className="hero-books" aria-label="A few stories to discover">
          {heroIds.map((id, index) => {
            const book = hero.data?.find(item => item.id === id);
            if (!book) return null;

            const { title } = bookDisplay(book);
            const cover = heroImages[index];
            return (
              <Link key={id} to={`/books/${id}`} className={`hero-book hero-book-${index + 1}`} aria-label={`Explore ${title}`}>
                <img
                  src={cover}
                  srcSet={`${cover.replace('.webp', '-small.webp')} 260w, ${cover} 420w`}
                  sizes="(max-width:767px) 110px, (max-width:1023px) 150px, 185px"
                  alt={title}
                  fetchPriority={index === 0 ? 'high' : 'auto'}
                  decoding="async"
                />
              </Link>
            );
          })}
          {hero.loading && <p className="hero-loading" role="status">Finding your next read…</p>}
          {hero.error && <p className="hero-loading">Your next story is on the shelf below.</p>}
        </div>
      </div>
      <Link className="bento-small bento-budget" to={underPriceHref}><span className="feature-kicker">Read within your budget</span><h2>Books under ₹300</h2><span className="feature-link">See the books <ArrowUpRight size={21}/></span><BookOpen className="feature-icon" size={72} weight="light" aria-hidden="true"/></Link>
      <Link className="bento-small bento-fiction" to={categoryHref('Literary Fiction')}><span className="feature-kicker">Explore literary fiction</span><h2>Find your next novel</h2><span className="feature-link">Explore fiction <ArrowUpRight size={21}/></span><Sparkle className="feature-icon" size={74} weight="light" aria-hidden="true"/></Link>
    </section>
    <Reveal as="section" className="mood-section" aria-labelledby="mood-title"><div className="editorial-section-head"><div><h2 id="mood-title">Browse by genre</h2></div><Link to="/books">View all <ArrowRight size={18}/></Link></div><GenreSlider>{genres.map(({name,category,mood,Icon})=><Link key={name} className="mood-tile" to={categoryHref(category)}><Icon size={28} weight="bold" aria-hidden="true"/><span><strong>{name}</strong><small>{mood}</small></span><ArrowUpRight className="mood-arrow" size={18}/></Link>)}</GenreSlider></Reveal>
    <Reveal as="section" className="reading-feature" aria-labelledby="shelf-title"><div className="editorial-section-head"><div><h2 id="shelf-title">Books to start with</h2></div><Link to="/books">View all <ArrowRight size={18}/></Link></div>
      {featured.loading && <BookGridSkeleton count={4}/>}{featured.error && <LoadError onRetry={featured.retry} what="books"/>}
      {featured.data && <ul className="book-grid reading-shelf">{featuredIds.map(id=>featured.data.find(book=>book.id===id)).filter(Boolean).map(book=><li key={book.id}><BookCard book={book}/></li>)}</ul>}
    </Reveal>
    <Reveal as="section" className="affordable-section" aria-labelledby="affordable-title"><div className="editorial-section-head"><div><h2 id="affordable-title">₹299 & under</h2></div><Link to={underPriceHref}>₹299 & under <ArrowRight size={18}/></Link></div>
      {affordable.loading && <BookGridSkeleton count={4}/>}{affordable.error && <LoadError onRetry={affordable.retry} what="books"/>}
      {affordable.data && <ul className="book-grid">{affordable.data.books.map(book=><li key={book.id}><BookCard book={book}/></li>)}</ul>}
    </Reveal>
    <div className="reading-signoff"><BookOpen size={27} weight="light"/><p>A book, a breather,<br/>a little time for you.</p><Link to="/books" className="btn btn-outline">Find your next read <ArrowUpRight size={19}/></Link></div>
  </div>;
}
