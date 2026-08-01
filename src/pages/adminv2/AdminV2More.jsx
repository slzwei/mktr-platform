/**
 * More — the mobile hub tab (design source 1694f8b2 "MKTR Ops Console
 * Mobile"). Everything that lives in the desktop sidebar but not on the four
 * main tabs: the long-tail Lead Generation screens, System screens, plus the
 * SGT clock, theme toggle and account block that the desktop topbar carries.
 * Reachable on desktop too (harmless), but only linked from mobile chrome.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminV2Shell } from '@/components/adminv2/mobile/shellContext';

const GROUPS = [
  {
    label: 'Lead generation',
    items: [
      { label: 'People', to: '/AdminPeople' },
      { label: 'Cohorts', to: '/AdminCohorts' },
      { label: 'Email Pushes', to: '/AdminBroadcasts' },
      { label: 'Agent Groups', to: '/AdminAgentGroups' },
      { label: 'QR Codes', to: '/AdminQRCodes' },
      { label: 'Short Links', to: '/AdminShortLinks' },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Users', to: '/AdminUsers' },
      { label: 'AI Settings', to: '/AdminAISettings' },
    ],
  },
];

function sgtClock() {
  return new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}

function nameOf(user) {
  return `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.fullName || 'Operator';
}

function initialsOf(user) {
  const name = nameOf(user);
  const parts = name.split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || (user?.email || 'OP').slice(0, 2).toUpperCase();
}

export default function AdminV2More() {
  const navigate = useNavigate();
  const shell = useAdminV2Shell();
  const [clock, setClock] = useState(sgtClock);

  useEffect(() => {
    const t = setInterval(() => setClock(sgtClock()), 15_000);
    return () => clearInterval(t);
  }, []);

  const theme = shell?.theme || 'light';
  const dark = theme === 'dark';

  return (
    <div style={{ maxWidth: 560 }}>
      {/* Status card: live SGT clock + theme toggle */}
      <div className="av2-card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px' }}>
        <span className="av2-pulse" aria-hidden="true" />
        <span className="av2-mono" style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1 }}>SGT {clock}</span>
        <button
          type="button"
          onClick={() => shell?.setTheme?.(dark ? 'light' : 'dark')}
          aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}
          style={{
            display: 'flex', alignItems: 'center', gap: 7, height: 36, padding: '0 12px',
            background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10,
            cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 700, color: 'var(--ink-2)',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 12 }}>{dark ? '◗' : '○'}</span>
          {dark ? 'Dark' : 'Light'}
        </button>
      </div>

      {GROUPS.map((g) => (
        <div key={g.label}>
          <div className="av2-mono" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.13em', color: 'var(--ink-3)', textTransform: 'uppercase', padding: '16px 2px 6px' }}>
            {g.label}
          </div>
          <div className="av2-card" style={{ overflow: 'hidden' }}>
            {g.items.map((item, i) => (
              <button
                key={item.to}
                type="button"
                onClick={() => navigate(item.to)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 52,
                  padding: '8px 14px', background: 'transparent', border: 'none',
                  borderBottom: i === g.items.length - 1 ? 'none' : '1px solid var(--line)',
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-ui)', color: 'var(--ink)',
                }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>{item.label}</span>
                <span style={{ color: 'var(--ink-3)' }} aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="av2-mono" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.13em', color: 'var(--ink-3)', textTransform: 'uppercase', padding: '16px 2px 6px' }}>
        Account
      </div>
      <div className="av2-card" style={{ padding: '13px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <span style={{ width: 40, height: 40, flex: 'none', borderRadius: '50%', background: 'var(--ink)', color: 'var(--canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
            {initialsOf(shell?.user)}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{nameOf(shell?.user)}</span>
            <span className="av2-mono" style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {shell?.user?.email || 'admin'} · ADMIN
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => shell?.signOut?.()}
          style={{
            width: '100%', height: 42, marginTop: 12, background: 'var(--surface-2)', border: 'none',
            borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 700, color: 'var(--ink)',
          }}
        >
          Sign out
        </button>
      </div>

      <div className="av2-mono" style={{ fontSize: 9.5, letterSpacing: '.13em', color: 'var(--ink-3)', textAlign: 'center', padding: '20px 0 6px' }}>
        MKTR OPS CONSOLE · ALL TIMES SGT
      </div>
    </div>
  );
}
