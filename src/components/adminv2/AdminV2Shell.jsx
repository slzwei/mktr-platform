/**
 * Switchboard shell — chrome laid out 1:1 with the design source
 * (claude.ai/design 57e68763 "MKTR Admin.dc.html"): fixed 228px sidebar
 * (M logo tile, mono group labels, glyphless nav, Redeem Ops footer card) and
 * a 64px canvas topbar (search → Prospects, SGT clock, theme toggle, bell,
 * avatar menu). [data-theme] dark swap persisted to localStorage. Wraps every
 * v2 admin screen; legacy pages keep their own shell until their PR lands.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import '@/styles/adminV2.css';

const THEME_KEY = 'mktr_admin_v2_theme';

// Same flag that registers the /redeem-ops routes (src/pages/index.jsx) — a
// build without it must not render a dead link in the sidebar footer.
const REDEEM_OPS_ENABLED = import.meta.env.VITE_REDEEM_OPS_ENABLED === 'true';

// Mock IA order — Agents/Groups ahead of Campaigns (design source sidebar).
const NAV = [
  {
    label: 'Overview',
    items: [{ to: '/AdminDashboard', label: 'Dashboard' }],
  },
  {
    label: 'Lead Generation',
    items: [
      { to: '/AdminProspects', label: 'Prospects' },
      { to: '/AdminAgents', label: 'Agents' },
      { to: '/AdminAgentGroups', label: 'Agent Groups' },
      { to: '/AdminCampaigns', label: 'Campaigns' },
      { to: '/AdminWallets', label: 'Wallets & Commitments' },
      { to: '/AdminQRCodes', label: 'QR Codes' },
      { to: '/AdminShortLinks', label: 'Short Links' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/AdminUsers', label: 'Users' },
      { to: '/AdminAISettings', label: 'AI Settings' },
    ],
  },
];

export function useAdminV2Theme() {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'light');
  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  return [theme, setTheme];
}

function sgtClock() {
  return new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

function initialsOf(user) {
  const name = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.fullName || '';
  if (name) {
    const parts = name.split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  }
  return (user?.email || 'OP').slice(0, 2).toUpperCase();
}

export default function AdminV2Shell({ children, fullBleed = false, legacyBridge = false }) {
  const [theme, setTheme] = useAdminV2Theme();
  const [clock, setClock] = useState(sgtClock);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    const t = setInterval(() => setClock(sgtClock()), 15_000);
    return () => clearInterval(t);
  }, []);

  // ⌘K / Ctrl+K jumps to the searchable Prospects table (the global-search
  // affordance from the design — a dedicated palette is a later pass).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navigate('/AdminProspects');
      }
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const handleSignOut = async () => {
    try {
      await logout?.();
    } finally {
      navigate('/CustomerLogin');
    }
  };

  return (
    <div className={legacyBridge ? 'admin-v2 av2-legacy-bridge' : 'admin-v2'} data-theme={theme}>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {/* ── Sidebar (228px fixed) ── */}
        <aside
          style={{
            width: 228, flex: 'none', background: 'var(--surface)',
            borderRight: '1px solid var(--line)', boxSizing: 'border-box',
            display: 'flex', flexDirection: 'column',
            position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
          }}
        >
          <Link to="/AdminDashboard" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 14px', color: 'var(--ink)', textDecoration: 'none' }}>
            <span style={{ width: 32, height: 32, flex: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15 }}>M</span>
            <span>
              <span style={{ display: 'block', fontWeight: 800, fontSize: 16, letterSpacing: '.01em', lineHeight: 1.1 }}>MKTR</span>
              <span className="av2-mono" style={{ display: 'block', fontSize: 9.5, letterSpacing: '.14em', color: 'var(--ink-3)' }}>OPS CONSOLE</span>
            </span>
          </Link>
          <nav className="av2-nav" aria-label="Admin" style={{ flex: 1, padding: '0 10px 12px' }}>
            {NAV.map((section) => (
              <div key={section.label} style={{ paddingTop: 12 }}>
                <div className="av2-mono" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.12em', color: 'var(--ink-3)', padding: '0 12px 5px', textTransform: 'uppercase' }}>
                  {section.label}
                </div>
                {section.items.map((item) => (
                  <NavLink key={item.to} to={item.to}>{item.label}</NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
            {REDEEM_OPS_ENABLED && (
              <Link to="/redeem-ops" title="Redeem Ops — partner CRM" style={{ display: 'block', border: '1.5px solid var(--line-strong)', borderRadius: 9, padding: '8px 10px', textDecoration: 'none', marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)' }}>Redeem Ops ↗</div>
                <div className="av2-mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', marginTop: 1 }}>partner CRM</div>
              </Link>
            )}
            <div className="av2-mono" style={{ fontSize: 10, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email || 'admin'}
            </div>
          </div>
        </aside>

        {/* ── Main column ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <header
            style={{
              height: 64, flex: 'none', position: 'sticky', top: 0, zIndex: 40, boxSizing: 'border-box',
              display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px',
              background: 'var(--canvas)', borderBottom: '1px solid var(--line)',
            }}
          >
            <button
              type="button"
              onClick={() => navigate('/AdminProspects')}
              title="Search leads — opens Prospects (⌘K)"
              style={{
                flex: '0 1 320px', height: 40, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px',
                background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
                boxSizing: 'border-box', cursor: 'pointer', fontFamily: 'var(--font-ui)',
              }}
            >
              <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, flex: 'none' }} aria-hidden="true">
                <path d="M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Z" fill="none" stroke="var(--ink-3)" strokeWidth="2" />
                <path d="M16.2 16.2 21 21" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textAlign: 'left' }}>Search leads, campaigns, agents</span>
              <span className="av2-mono" style={{ fontSize: 10, color: 'var(--ink-3)', border: '1px solid var(--line-strong)', borderRadius: 5, padding: '1px 5px' }}>⌘K</span>
            </button>
            <span style={{ flex: 1 }} />
            <span className="av2-mono" style={{ fontSize: 12, color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 7 }}>
              <span className="av2-pulse" aria-hidden="true" />
              SGT {clock}
            </span>
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title="Switch color theme"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              style={{
                height: 40, display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px',
                background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 10,
                cursor: 'pointer', fontFamily: 'var(--font-ui)',
              }}
            >
              {theme === 'light' ? (
                <svg viewBox="0 0 24 24" style={{ width: 15, height: 15 }} aria-hidden="true">
                  <circle cx="12" cy="12" r="4" fill="none" stroke="var(--ink-2)" strokeWidth="2" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2.1 2.1M17.4 17.4l2.1 2.1M19.5 4.5l-2.1 2.1M6.6 17.4l-2.1 2.1" stroke="var(--ink-2)" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" style={{ width: 15, height: 15 }} aria-hidden="true">
                  <path d="M20 13.5A8.5 8.5 0 0 1 10.5 4 7 7 0 1 0 20 13.5Z" fill="var(--ink-2)" />
                </svg>
              )}
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }}>{theme === 'light' ? 'Light' : 'Dark'}</span>
            </button>
            <button
              type="button"
              title="Notifications — coming soon"
              aria-label="Notifications (coming soon)"
              style={{
                width: 40, height: 40, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 10, cursor: 'default',
              }}
            >
              <svg viewBox="0 0 24 24" style={{ width: 16, height: 16 }} aria-hidden="true">
                <path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6Z" fill="none" stroke="var(--ink-2)" strokeWidth="2" strokeLinejoin="round" />
                <path d="M10 19a2 2 0 0 0 4 0" fill="none" stroke="var(--ink-2)" strokeWidth="2" />
              </svg>
            </button>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                title="Account"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                style={{
                  width: 34, height: 34, flex: 'none', borderRadius: '50%', border: 'none', cursor: 'pointer',
                  background: 'var(--ink)', color: 'var(--canvas)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700,
                  fontFamily: 'var(--font-ui)',
                }}
              >
                {initialsOf(user)}
              </button>
              {menuOpen && (
                <>
                  <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} aria-hidden="true" />
                  <div role="menu" style={{ position: 'absolute', right: 0, top: 44, zIndex: 70, width: 240, background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 12, boxShadow: 'var(--shadow)', padding: 8, boxSizing: 'border-box' }}>
                    <div style={{ padding: '6px 10px' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>Operator</div>
                      <div className="av2-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 1, overflowWrap: 'anywhere' }}>{user?.email || 'admin'}</div>
                    </div>
                    <div style={{ borderTop: '1px solid var(--line)', margin: '6px 0' }} />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleSignOut}
                      style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </header>

          <main style={fullBleed
            ? { flex: 1, width: '100%', minWidth: 0 }
            : { flex: 1, width: '100%', maxWidth: 1520, margin: '0 auto', padding: '20px 24px 48px', boxSizing: 'border-box' }}>
            {children}
          </main>
        </div>
      </div>
      {/* Toasts render through the app-wide sonner Toaster (App.jsx) — a second
          mount here would double-render every toast. */}
    </div>
  );
}
