/**
 * Switchboard shell — fixed 228px sidebar with the rebuilt IA (no fleet /
 * finance / APK slots by design), 64px sticky topbar, [data-theme] dark swap
 * persisted to localStorage. Wraps every v2 admin screen; legacy pages keep
 * their own shell until their PR lands.
 */
import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Toaster } from '@/components/ui/sonner';
import '@/styles/adminV2.css';

const THEME_KEY = 'mktr_admin_v2_theme';

const NAV = [
  {
    label: 'Overview',
    items: [{ to: '/AdminDashboard', label: 'Dashboard', glyph: '◳' }],
  },
  {
    label: 'Lead Generation',
    items: [
      { to: '/AdminProspects', label: 'Prospects', glyph: '☰' },
      { to: '/AdminCampaigns', label: 'Campaigns', glyph: '▶' },
      { to: '/AdminAgents', label: 'Agents', glyph: '◉' },
      { to: '/AdminAgentGroups', label: 'Agent Groups', glyph: '◎' },
      { to: '/AdminWallets', label: 'Wallets & Commitments', glyph: '▣' },
      { to: '/AdminQRCodes', label: 'QR Codes', glyph: '⊞' },
      { to: '/AdminShortLinks', label: 'Short Links', glyph: '⤳' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/AdminUsers', label: 'Users', glyph: '⚉' },
      { to: '/AdminAISettings', label: 'AI Settings', glyph: '✳' },
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

export default function AdminV2Shell({ children }) {
  const [theme, setTheme] = useAdminV2Theme();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);

  const handleSignOut = async () => {
    try {
      await logout?.();
    } finally {
      navigate('/CustomerLogin');
    }
  };

  return (
    <div className="admin-v2" data-theme={theme}>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {/* ── Sidebar (228px fixed) ── */}
        <aside
          style={{
            width: 228, flex: 'none', background: 'var(--surface)',
            borderRight: '1px solid var(--line)', padding: '16px 12px',
            display: 'flex', flexDirection: 'column', gap: 4,
            position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
          }}
        >
          <div style={{ padding: '4px 12px 14px' }}>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em' }}>MKTR</div>
            <div className="av2-meta">ADMIN · SWITCHBOARD</div>
          </div>
          <nav className="av2-nav" aria-label="Admin">
            {NAV.map((section) => (
              <div key={section.label} style={{ marginBottom: 14 }}>
                <div className="av2-microcaps" style={{ padding: '0 12px 6px' }}>{section.label}</div>
                {section.items.map((item) => (
                  <NavLink key={item.to} to={item.to}>
                    <span aria-hidden="true" style={{ width: 16, textAlign: 'center', fontSize: 12 }}>{item.glyph}</span>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div style={{ marginTop: 'auto', padding: '10px 12px 4px', borderTop: '1px solid var(--line)' }}>
            <div className="av2-caption" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email || 'admin'}
            </div>
          </div>
        </aside>

        {/* ── Main column ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              height: 64, flex: 'none', position: 'sticky', top: 0, zIndex: 40,
              display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px',
              background: 'var(--surface)', borderBottom: '1px solid var(--line)',
            }}
          >
            <span className="av2-meta">MKTR LEAD GENERATION · {new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' }).toUpperCase()}</span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="av2-btn av2-btn--ghost av2-btn--sm"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? '☀ Light' : '☾ Dark'}
            </button>
            <button type="button" className="av2-btn av2-btn--sm" onClick={handleSignOut}>
              Sign out
            </button>
          </div>

          <main style={{ flex: 1, width: '100%', maxWidth: 1520, margin: '0 auto', padding: 24 }}>
            {children}
          </main>
        </div>
      </div>
      <Toaster position="bottom-right" theme={theme} />
    </div>
  );
}
