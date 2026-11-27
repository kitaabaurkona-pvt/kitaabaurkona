import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import BrandLink from '../layout/BrandLink';
import '../../styles/auth.css';

function AuthShell({ title, subtitle, backTo, backLabel, playful = false, children }) {
  useEffect(() => {
    document.title = `${title} - Kitaab Aur Kona`;
  }, [title]);

  return (
    <div className={playful ? "auth-page auth-page--login" : "auth-page"}>
      <header className="auth-header">
        {backTo && (
          <Link to={backTo} className="auth-back" aria-label={backLabel}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </Link>
        )}
        <BrandLink />
      </header>
      <main className="auth-main">
        {playful && <div className="login-books" aria-hidden="true">
          <img src="/images/hero-dawn-of-onyx.webp" alt="" />
          <img src="/images/hero-everything-about-love.webp" alt="" />
          <img src="/images/hero-heartstopper.webp" alt="" />
        </div>}
        <div className="auth-card">
          <h1 className="auth-title">{title}</h1>
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}

export default AuthShell;
