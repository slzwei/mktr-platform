/**
 * Mobile bottom tab bar — the five root destinations of the ops console
 * (design source 1694f8b2 "MKTR Ops Console Mobile"). Icons stay in the
 * Switchboard geometric-glyph family (■●▲◆⋯), never a generic icon set.
 * Money covers both /AdminWallets and /AdminAgents; everything reached from
 * the More hub keeps the More tab lit.
 */
import { Link, useLocation } from 'react-router-dom';

const TABS = [
  { key: 'home', label: 'Home', to: '/AdminDashboard', icon: 'M5 5 h14 v14 H5 Z', match: [/^\/admindashboard/] },
  { key: 'leads', label: 'Leads', to: '/AdminProspects', icon: 'M12 4 a8 8 0 1 1 0 16 a8 8 0 1 1 0 -16 Z', match: [/^\/adminprospects/, /^\/admin\/leads\//] },
  { key: 'campaigns', label: 'Campaigns', to: '/AdminCampaigns', icon: 'M12 3 L22 20 L2 20 Z', match: [/^\/admincampaigns/, /^\/admin\/campaigns/] },
  { key: 'money', label: 'Money', to: '/AdminWallets', icon: 'M12 2 L21 12 L12 22 L3 12 Z', match: [/^\/adminwallets/, /^\/adminagents/] },
  {
    key: 'more', label: 'More', to: '/admin/more',
    icon: 'M6 10.3 a1.7 1.7 0 1 1 0 3.4 a1.7 1.7 0 1 1 0-3.4 M12 10.3 a1.7 1.7 0 1 1 0 3.4 a1.7 1.7 0 1 1 0-3.4 M18 10.3 a1.7 1.7 0 1 1 0 3.4 a1.7 1.7 0 1 1 0-3.4',
    match: [/^\/admin\/more/, /^\/adminpeople/, /^\/admincohorts/, /^\/admin\/cohorts/, /^\/adminbroadcasts/, /^\/admin\/broadcasts/, /^\/adminagentgroups/, /^\/adminqrcodes/, /^\/adminshortlinks/, /^\/adminusers/, /^\/adminaisettings/],
  },
];

export function activeTabKey(pathname) {
  const p = pathname.toLowerCase();
  const hit = TABS.find((t) => t.match.some((rx) => rx.test(p)));
  return hit?.key || null;
}

export default function MobileTabBar() {
  const { pathname } = useLocation();
  const active = activeTabKey(pathname);

  return (
    <nav
      aria-label="Tabs"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 80,
        display: 'flex', background: 'var(--surface)', borderTop: '1px solid var(--line)',
        padding: '4px 6px calc(6px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box',
      }}
    >
      {TABS.map((t) => {
        const on = active === t.key;
        return (
          <Link
            key={t.key}
            to={t.to}
            aria-current={on ? 'page' : undefined}
            style={{
              flex: 1, minHeight: 48, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 3,
              textDecoration: 'none', borderRadius: 10,
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 17, height: 17 }} aria-hidden="true">
              <path d={t.icon} fill={on ? 'var(--accent)' : 'var(--ink-3)'} />
            </svg>
            <span style={{ fontSize: 10, fontWeight: on ? 800 : 500, color: on ? 'var(--ink)' : 'var(--ink-3)', letterSpacing: '.01em' }}>
              {t.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
