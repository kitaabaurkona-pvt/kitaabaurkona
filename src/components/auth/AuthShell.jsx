import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../../styles/auth.css';

function AuthShell({ title, backTo, backLabel, children }) {
  useEffect(() => {
    document.title = `${title} - Kitaab Aur Kona`;
  }, [title]);

  return (
    <div className="auth-page">
      <header className="auth-header">
        <Link to={backTo} className="auth-back" aria-label={backLabel}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
        </Link>
        <Link to="/" className="auth-brand">
          <img src="/images/brand/emblem-transparent.png" alt="" width="28" height="28" />
          Kitaab Aur Kona
        </Link>
      </header>
      <main className="auth-main">
        <div className="auth-card">
          <h1 className="auth-title">{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}

export default AuthShell;
