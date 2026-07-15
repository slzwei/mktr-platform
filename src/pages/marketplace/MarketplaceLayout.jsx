import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CATEGORIES } from './content';
import './marketplace.css';

/**
 * Marketplace shell — fixed nav (desktop links / mobile menu overlay) + dark
 * footer. Pine/cream editorial system from the approved Prototype v2; the
 * mobile menu is the full-screen pine overlay from the "DSA Guide - Mobile"
 * design (burger morphs to an X, numbered serif links stagger in, the active
 * route carries a "You are here" pill). Redeem build only (routes are gated
 * in pages/index.jsx).
 */

const MENU_LINKS = [
  { n: '01', label: 'Explore', to: '/explore' },
  { n: '02', label: 'Education', to: '/c/education' },
  { n: '03', label: 'Lifestyle', to: '/c/lifestyle' },
  { n: '04', label: 'DSA guide', to: '/dsa' },
  { n: '05', label: 'How it works', to: '/how-it-works' },
  { n: '06', label: 'For businesses', to: '/businesses' },
  { n: '07', label: 'About', to: '/about' },
];

/** Which menu entry the current path belongs to (-1 = none). */
function menuIndexForPath(pathname) {
  if (pathname === '/explore') return 0;
  if (pathname.startsWith('/c/')) {
    const id = pathname.slice(3);
    if (id === 'education') return 1;
    if (id === 'lifestyle') return 2;
    const cat = CATEGORIES.find((c) => c.id === id);
    if (cat) return cat.group === 'education' ? 1 : 2;
  }
  if (pathname === '/dsa') return 3;
  if (pathname === '/how-it-works') return 4;
  if (pathname === '/businesses') return 5;
  if (pathname === '/about') return 6;
  return -1;
}

export default function MarketplaceLayout({ children, minimalChrome = false, chromeLabel }) {
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setDrawer(false);
    const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo({ top: 0 });
  }, [location]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setDrawer(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawer]);

  const activeIndex = menuIndexForPath(location.pathname);

  if (minimalChrome) {
    return (
      <div className="rm-page">
        <header className="rm-nav">
          <div className="rm-shell rm-nav-inner" style={{ maxWidth: 720, justifyContent: 'space-between' }}>
            <span className="rm-mono-label" style={{ color: 'var(--rm-sub)' }}>{chromeLabel || 'Campaign'}</span>
            <span className="rm-mono-note" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <span className="rm-ticket rm-ticket--sm" style={{ width: 11, height: 14 }} />
              Secured by Redeem
            </span>
          </div>
        </header>
        <main style={{ flex: 1, paddingTop: 66 }}>{children}</main>
        <footer style={{ marginTop: 'auto', padding: '20px 16px 28px', textAlign: 'center' }} className="rm-mono-note">
          Powered by Redeem · MKTR PTE. LTD. · support@redeem.sg
        </footer>
      </div>
    );
  }

  return (
    <div className="rm-page">
      <a
        href="#rm-main"
        style={{ position: 'fixed', left: -9999, top: 16, zIndex: 99, background: '#17251F', color: '#FFFDF6', padding: '10px 16px', borderRadius: 8 }}
      >
        Skip to content
      </a>
      <header className={`rm-nav${drawer ? ' is-menu-open' : ''}`}>
        <div className="rm-shell rm-nav-inner">
          <Link to="/" aria-label="Redeem home" className="rm-wordmark">
            <span className="rm-ticket" />
            redeem
          </Link>
          <nav aria-label="Primary" className="rm-nav-links">
            <Link className="rm-nav-link" to="/explore">Explore</Link>
            <Link className="rm-nav-link" to="/c/education">Education</Link>
            <Link className="rm-nav-link" to="/c/lifestyle">Lifestyle</Link>
            <Link className="rm-nav-link" to="/dsa">DSA guide</Link>
            <Link className="rm-nav-link" to="/how-it-works">How it works</Link>
            <Link className="rm-nav-link" to="/businesses">For businesses</Link>
            <Link className="rm-nav-link" to="/about">About</Link>
            <Link className="rm-btn rm-nav-cta" to="/explore">Explore offers</Link>
          </nav>
          <button
            className={`rm-burger${drawer ? ' is-open' : ''}`}
            aria-label={drawer ? 'Close menu' : 'Menu'}
            aria-expanded={drawer}
            onClick={() => setDrawer(!drawer)}
          >
            <span /><span /><span />
          </button>
        </div>
      </header>

      <div role="dialog" aria-label="Menu" inert={!drawer} className={`rm-menu${drawer ? ' is-open' : ''}`}>
        <nav className="rm-menu-links" aria-label="Menu">
          {MENU_LINKS.map((l, i) => (
            <Link key={l.to} to={l.to} className={`rm-menu-link rm-menu-item${activeIndex === i ? ' is-here' : ''}`} style={{ '--i': i }}>
              <span className="rm-menu-num">{l.n}</span>
              {l.label}
              {activeIndex === i && <span className="rm-menu-here">You are here</span>}
            </Link>
          ))}
        </nav>
        <div className="rm-menu-foot rm-menu-item" style={{ '--i': MENU_LINKS.length }}>
          <div className="rm-menu-doors" aria-hidden="true"><span /><span /><span /></div>
          <Link className="rm-btn rm-btn--apricot rm-btn--big" to="/explore" style={{ width: '100%' }}>Explore offers</Link>
          <div className="rm-menu-tag">redeem.sg · verified local programmes</div>
        </div>
      </div>

      <main id="rm-main" style={{ flex: 1, paddingTop: 66 }}>{children}</main>

      <footer className="rm-footer">
        <div className="rm-shell" style={{ paddingTop: 'clamp(40px, 5vw, 64px)', paddingBottom: 28 }}>
          <div className="rm-footer-cols">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 220 }}>
              <span className="rm-wordmark" style={{ color: '#F6F2E6' }}>
                <span className="rm-ticket" />
                redeem
              </span>
              <div style={{ fontSize: 12.5, lineHeight: 1.6, color: '#9DB3A3', maxWidth: '30ch' }}>
                Discover experiences and rewards worth showing up for — from verified Singapore businesses.
              </div>
              <div style={{ fontFamily: 'var(--rm-mono)', fontSize: 10, lineHeight: 1.7, color: '#7E958A' }}>
                MKTR PTE. LTD. · UEN 202507548M<br />support@redeem.sg
              </div>
            </div>
            <div>
              <div className="rm-footer-head">Discover</div>
              <div className="rm-footer-links">
                <Link to="/explore">Explore all offers</Link>
                <Link to="/c/education">Education</Link>
                <Link to="/c/lifestyle">Lifestyle</Link>
                <Link to="/dsa">DSA discovery</Link>
                <Link to="/winners">Lucky-draw winners</Link>
              </div>
            </div>
            <div>
              <div className="rm-footer-head">Company</div>
              <div className="rm-footer-links">
                <Link to="/how-it-works">How it works</Link>
                <Link to="/businesses">For businesses</Link>
                <Link to="/about">About &amp; trust</Link>
              </div>
            </div>
            <div>
              <div className="rm-footer-head">Legal</div>
              <div className="rm-footer-links">
                <Link to="/personal-data-policy">Personal Data Protection Policy</Link>
                <Link to="/leads/privacy">Leads privacy</Link>
                <Link to="/legal/terms">Terms of use</Link>
                <Link to="/legal/dnc">DNC information</Link>
              </div>
            </div>
          </div>
          <div style={{ borderTop: '1px solid rgba(200,213,203,0.18)', marginTop: 36, paddingTop: 18, display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', fontFamily: 'var(--rm-mono)', fontSize: 10, color: '#7E958A' }}>
            <span>© {new Date().getFullYear()} MKTR PTE. LTD. All rights reserved.</span>
            <span>Redeem is a service of MKTR PTE. LTD.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
