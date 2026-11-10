import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCartLines } from '../hooks/useCartLines';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatPrice } from '../utils/format';
import { bookDisplay } from '../utils/bookDisplay';
import { INDIAN_STATES, normalizeShipping, validateShipping } from '../utils/storeForm';
const initial = {name:'',phone:'',address:'',city:'',state:'',pincode:''};
export default function PreviewCheckout(){
 useDocumentTitle('Checkout preview');
 const cart=useCartLines(); const [done,setDone]=useState(false); const [error,setError]=useState(null); const [form,setForm]=useState(initial);
 function set(key){return event=>{let value=event.target.value;if(key==='phone'||key==='pincode')value=value.replace(/\D/g,'').slice(0,key==='phone'?10:6);setForm(f=>({...f,[key]:value}));if(error?.field===`ship-${key}`)setError(null);};}
 function submit(event){event.preventDefault();const issue=validateShipping(normalizeShipping(form));if(issue){setError(issue);document.getElementById(issue.field.replace('ship-','preview-'))?.focus();return;}setError(null);setDone(true);window.scrollTo(0,0);}
 function fieldProps(key){return {id:`preview-${key}`,name:key,value:form[key],onChange:set(key),required:true,'aria-invalid':error?.field===`ship-${key}`||undefined,'aria-describedby':error?.field===`ship-${key}`?`preview-${key}-error`:undefined};}
 function fieldError(key){return error?.field===`ship-${key}`?<p id={`preview-${key}-error`} className="field-message" role="alert">{error.message}</p>:null;}
 if(done)return <div className="container page"><p className="eyebrow">Preview complete</p><h1 className="page-title">That’s the checkout flow.</h1><p>No order was placed. No payment was taken. Your sample details were not saved.</p><p>{cart.totals.count} {cart.totals.count===1?'book':'books'} · Books subtotal {formatPrice(cart.totals.subtotal)}</p><div className="confirmation-actions"><Link className="btn btn-primary" to="/books">Keep exploring</Link><button type="button" className="btn btn-outline" onClick={()=>setDone(false)}>Back to review</button></div></div>;
 if(cart.loading||cart.pending)return <div className="container page"><p role="status">Preparing your books…</p></div>;
 if(!cart.totals.count||cart.blocked)return <div className="container page"><h1 className="page-title">Your next read is waiting.</h1><p>Add an available book to preview checkout.</p><Link to="/books" className="btn btn-primary">Find a book</Link></div>;
 return <div className="container page checkout-page"><div className="page-head"><h1 className="page-title">Checkout</h1><p className="page-meta">Review your books and delivery details.</p></div>
 <div className="checkout-context"><p><strong>{cart.totals.count} {cart.totals.count===1?'book':'books'} · {formatPrice(cart.totals.subtotal)}</strong><small>Books subtotal. Delivery cost is unavailable in this preview.</small></p><Link to="/cart">Edit cart</Link></div>
 <p className="notice preview-checkout-notice">Demo checkout · Use sample details. Nothing will be ordered or charged.</p>
 <form className="two-col" onSubmit={submit} noValidate><div className="stack"><section className="panel" aria-labelledby="delivery-heading"><h2 className="panel-title" id="delivery-heading">Delivery details</h2><p className="page-meta">All six fields are required for delivery.</p><div className="form-grid form-grid-2">
 <div><label className="label" htmlFor="preview-name">Full name</label><input className="input" autoComplete="name" maxLength={80} {...fieldProps('name')}/>{fieldError('name')}</div>
 <div><label className="label" htmlFor="preview-phone">Mobile number</label><input className="input" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10} {...fieldProps('phone')}/>{fieldError('phone')}</div>
 <div className="span-2"><label className="label" htmlFor="preview-address">House, street and area</label><textarea className="textarea" autoComplete="street-address" maxLength={300} rows={3} {...fieldProps('address')}/>{fieldError('address')}</div>
 <div><label className="label" htmlFor="preview-pincode">PIN code</label><input className="input" inputMode="numeric" autoComplete="postal-code" maxLength={6} {...fieldProps('pincode')}/>{fieldError('pincode')}</div>
 <div><label className="label" htmlFor="preview-city">City</label><input className="input" autoComplete="address-level2" maxLength={60} {...fieldProps('city')}/>{fieldError('city')}</div>
 <div className="span-2"><label className="label" htmlFor="preview-state">State</label><select className="select" autoComplete="address-level1" {...fieldProps('state')}><option value="">Choose a state</option>{INDIAN_STATES.map(s=><option key={s}>{s}</option>)}</select>{fieldError('state')}</div>
 </div></section><section className="panel"><h2 className="panel-title">Payment</h2><p>Cash on delivery</p><p className="page-meta">Payment is not collected in this preview. Delivery availability is not confirmed.</p></section></div>
 <aside><section className="summary" aria-labelledby="review-heading"><h2 className="summary-head" id="review-heading">Order summary</h2><div className="summary-body"><ul className="checkout-review">{cart.lines.filter(l=>l.available).map(l=><li key={l.id}><img src={l.book.image_urls?.[0]} alt=""/><span><strong>{bookDisplay(l.book).title}</strong><small>Qty {l.quantity}</small></span><span className="review-price">{formatPrice(l.book.price*l.quantity)}</span></li>)}</ul><dl className="summary-rows"><div className="summary-total"><dt>Books subtotal</dt><dd>{formatPrice(cart.totals.subtotal)}</dd></div><div><dt>Delivery</dt><dd>Not calculated</dd></div></dl><button className="btn btn-primary btn-block" type="submit">Preview confirmation</button><p className="checkout-safe-note">This button does not place an order.</p></div></section></aside></form></div>;
}
