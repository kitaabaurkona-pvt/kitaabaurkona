import { motion, useReducedMotion } from 'motion/react';
import { usePreferences } from '../../hooks/usePreferences';
import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { MagnifyingGlass, User, Tote, BookmarkSimple } from '@phosphor-icons/react';
import { useAuth } from '../../hooks/useAuth';
import { useCart } from '../../hooks/useCart';
import { useCartLines } from '../../hooks/useCartLines';
import { CATEGORIES, FICTION, NON_FICTION, categoryHref, underPriceHref, regionalHref } from '../../utils/categories';
import { searchBooks } from '../../services/bookService';
import { useAsync } from '../../hooks/useAsync';
import { bookDisplay } from '../../utils/bookDisplay';
import NavMenu from './NavMenu';
import MobileMenu from './MobileMenu';
export default function SiteHeader() {
 const systemReduced=useReducedMotion(); const {motion:motionPreference}=usePreferences(); const reduceMotion=systemReduced || motionPreference==='reduce';
 const {isAuthenticated}=useAuth(); const {count}=useCart(); const {cartOpen,openCart}=useCartLines();
 const location=useLocation();
 const [term,setTerm]=useState(()=>new URLSearchParams(location.search).get('q') || '');
 const [focused,setFocused]=useState(false);
 useEffect(()=>{setTerm(new URLSearchParams(location.search).get('q') || '');setFocused(false);},[location.pathname,location.search]);
 const navigate=useNavigate();
 const [suggestionTerm,setSuggestionTerm]=useState('');
 useEffect(()=>{const timer=setTimeout(()=>setSuggestionTerm(term.trim()),200);return()=>clearTimeout(timer);},[term]);
 const suggestions=useAsync(async () => {
   if(suggestionTerm.length<2)return {books:[],total:0};
   const result=await searchBooks({search:suggestionTerm,pageSize:24});
   const query=suggestionTerm.toLowerCase();
   const score=book=>{const title=bookDisplay(book).title.toLowerCase().replace(/^the /,'');return (title===query?100:0)+(title.startsWith(query)?50:0)+(book.category!=='Box Sets & Combos'?10:0);};
   return {...result,books:[...result.books].sort((a,b)=>score(b)-score(a)).slice(0,4)};
 },[suggestionTerm]);
 const showSuggestions=focused&&term.trim().length>=2;
 const links=names=>names.map(c=>({to:categoryHref(c),label:c}));
 const groups=[{label:'Fiction',links:links(FICTION)},{label:'Non-fiction',links:links(NON_FICTION.filter(c=>c!=='Box Sets & Combos'))},{label:'Explore more',links:[{to:underPriceHref,label:'₹299 & under'},{to:categoryHref('Box Sets & Combos'),label:'Box sets & combos'},{to:regionalHref,label:'Regional editions'},{to:'/books',label:'Browse books'}]}];
 function search(e){e.preventDefault(); setFocused(false); const q=term.trim();navigate(q ? `/books?q=${encodeURIComponent(q)}`:'/books');}
 if(location.pathname==='/checkout')return <header className="checkout-header container"><Link to="/" className="brand-logo" aria-label="Kitaab Aur Kona home"><img src="/images/brand/emblem-header.webp" alt="" width="44" height="44"/><span className="brand-word">Kitaab Aur Kona</span></Link><Link to="/cart" className="checkout-back">Back to cart</Link></header>;
 return <header className="site-header">
  <div className="container header-top">
   <div className="header-left"><MobileMenu/><Link to="/" className="brand-logo" aria-label="Kitaab Aur Kona home"><img src="/images/brand/emblem-header.webp" alt="" width="48" height="48"/><span className="brand-word">Kitaab Aur Kona</span></Link></div>
   <form className="header-search" role="search" onSubmit={search} onFocus={()=>setFocused(true)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setFocused(false);}} onKeyDown={e=>{if(e.key==='Escape')setFocused(false);}}><label className="visually-hidden" htmlFor="header-search">Search books by title</label><MagnifyingGlass size={23}/><input id="header-search" type="search" placeholder="Search books by title" value={term} maxLength={100} onChange={e=>setTerm(e.target.value)}/><button type="submit" aria-label="Search books"><ArrowSearch/></button>{showSuggestions&&<section className="search-suggestions" aria-label="Search suggestions"><p className="suggestion-heading">Matching books</p>{suggestions.loading || term.trim()!==suggestionTerm ? <p role="status">Finding books…</p> : suggestions.error ? <p>Suggestions are unavailable. You can still search.</p> : suggestions.data?.books.length ? <ul>{suggestions.data.books.map(book=><li key={book.id}><Link to={`/books/${book.id}`} onClick={()=>setFocused(false)}><img src={book.image_urls?.[0]} alt=""/><span><strong>{bookDisplay(book).title}</strong><small>{bookDisplay(book).author || book.category}</small></span></Link></li>)}</ul> : <p>No matching titles. Try another title or browse all books.</p>}<Link className="search-all-link" to={`/books?q=${encodeURIComponent(term.trim())}`} onClick={()=>setFocused(false)}>See all results for “{term.trim()}”</Link></section>}</form>
   <div className="header-right"><Link className="icon-button header-wishlist" to="/wishlist" aria-label="Wishlist"><BookmarkSimple size={24}/></Link><Link className="header-utility" aria-label={isAuthenticated ? 'Account' : 'Sign in'} to={isAuthenticated?'/account':'/sign-in'}><User size={25}/><span>{isAuthenticated?'Account':'Sign in'}</span></Link><button className="header-utility cart-button" onClick={openCart} aria-label={`Cart, ${count} ${count===1?'item':'items'}`} aria-haspopup="dialog" aria-expanded={cartOpen}><motion.div key={count} className="cart-icon-motion" initial={false} animate={{ scale: reduceMotion || !count ? 1 : [1, 1.18, 1], rotate: reduceMotion || !count ? 0 : [0, -7, 0] }} transition={{ duration: 0.32 }}><Tote size={26}/></motion.div><span>Cart{count>0?` (${count})`:''}</span>{count>0&&<small className="mobile-cart-count" aria-hidden="true">{count>99?'99+':count}</small>}</button></div>
  </div>
  <nav className="header-nav" aria-label="Main"><div className="container header-nav-row"><NavLink to="/books" className="nav-link">Browse books</NavLink><NavMenu label="Categories" links={CATEGORIES.map(c=>({to:categoryHref(c),label:c}))} groups={groups}/><Link to={underPriceHref} className="nav-link">Budget reads</Link><Link to="/about" className="nav-link nav-about">Our story</Link></div></nav>
 </header>;
}
function ArrowSearch(){return <span aria-hidden="true">Search</span>;}
