import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CATEGORIES } from './content';
import './marketplace.css';

/**
 * Marketplace shell — fixed nav (desktop links / mobile drawer) + dark footer.
 * Pine/cream editorial system from the approved Prototype v2. Redeem build
 * only (routes are gated in pages/index.jsx).
 */
export default function MarketplaceLayout({ children, minimalChrome = false, chromeLabel }) {
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setDrawer(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

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

  const eduCats = CATEGORIES.filter((c) => c.group === 'education');
  const lifeCats = CATEGORIES.filter((c) => c.group === 'lifestyle');

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
      <header className="rm-nav">
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
          <button className="rm-burger" aria-label="Menu" onClick={() => setDrawer(true)}>
            <span /><span /><span />
          </button>
        </div>
      </header>

      <div className={`rm-drawer-scrim${drawer ? ' is-open' : ''}`} onClick={() => setDrawer(false)} aria-hidden="true" />
      <div role="dialog" aria-label="Menu" inert={!drawer} className={`rm-drawer${drawer ? ' is-open' : ''}`}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span className="rm-serif" style={{ fontSize: 20 }}>redeem</span>
              <button onClick={() => setDrawer(false)} aria-label="Close menu" style={{ fontSize: 22, color: 'var(--rm-mut)', minWidth: 44, minHeight: 44 }}>✕</button>
            </div>
            <Link to="/explore" style={{ fontWeight: 700 }}>Explore</Link>
            <div className="rm-mono-label" style={{ padding: '12px 0 4px' }}>Education</div>
            {eduCats.map((c) => (
              <Link key={c.id} to={`/c/${c.id}`} style={{ paddingLeft: 12, fontSize: 14, color: 'var(--rm-sub)' }}>{c.label}</Link>
            ))}
            <Link to="/dsa" style={{ paddingLeft: 12, fontSize: 14, color: 'var(--rm-pine)', fontWeight: 600 }}>DSA discovery guide</Link>
            <div className="rm-mono-label" style={{ padding: '12px 0 4px' }}>Lifestyle</div>
            {lifeCats.map((c) => (
              <Link key={c.id} to={`/c/${c.id}`} style={{ paddingLeft: 12, fontSize: 14, color: 'var(--rm-sub)' }}>{c.label}</Link>
            ))}
            <div style={{ height: 1, background: 'var(--rm-line)', margin: '14px 0' }} />
            <Link to="/how-it-works">How it works</Link>
            <Link to="/businesses">For businesses</Link>
            <Link to="/about">About</Link>
            <Link to="/winners">Lucky-draw winners</Link>
        <Link className="rm-btn" to="/explore" style={{ marginTop: 16, width: '100%' }}>Explore offers</Link>
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
