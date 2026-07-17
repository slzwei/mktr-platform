/**
 * Topbar attention bell — live alerts, not a placeholder. Reads the same
 * GET /dashboard/attention aggregate as the dashboard (shared query key, plus
 * a gentle 2-min poll since refetchOnWindowFocus is off globally) composed
 * through composeAttentionRows, so the bell and the "Needs attention" queue
 * can never disagree. The badge counts actionable severities
 * (incident / held / warning); watch-tier rows list in the panel unbadged.
 * Every row deep-links to its pre-filtered screen.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchAttention } from '@/api/adminV2';
import { composeAttentionRows, SEVERITY_GLYPH } from '@/lib/adminV2/attention';
import { fmtRelative } from '@/lib/adminV2/format';
import { Skeleton } from '@/components/adminv2/primitives';

const ACTIONABLE = new Set(['incident', 'held', 'warning']);
const TONE = { incident: 'var(--bad)', held: 'var(--hold)', warning: 'var(--warn)', watch: 'var(--ink-3)' };

export default function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const attention = useQuery({
    queryKey: ['adminV2', 'attention'],
    queryFn: fetchAttention,
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const rows = composeAttentionRows(attention.data);
  const actionable = rows.filter((r) => ACTIONABLE.has(r.severity));
  const badge = actionable.length;
  // Rows arrive severity-sorted, so the first actionable row is the worst.
  const badgeTone = TONE[actionable[0]?.severity] || 'var(--warn)';

  // Zero rows only means "all clear" once the feed actually loaded.
  const bellLabel = attention.isLoading
    ? 'Notifications — loading'
    : attention.isError
      ? 'Notifications — couldn’t load alerts'
      : badge > 0
        ? `Notifications — ${badge} item${badge === 1 ? '' : 's'} need attention`
        : 'Notifications — all clear';

  const go = (href) => {
    setOpen(false);
    navigate(href);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={bellLabel}
        aria-label={bellLabel}
        aria-expanded={open}
        style={{
          width: 40, height: 40, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 10, cursor: 'pointer',
          position: 'relative',
        }}
      >
        <svg viewBox="0 0 24 24" style={{ width: 16, height: 16 }} aria-hidden="true">
          <path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6Z" fill="none" stroke="var(--ink-2)" strokeWidth="2" strokeLinejoin="round" />
          <path d="M10 19a2 2 0 0 0 4 0" fill="none" stroke="var(--ink-2)" strokeWidth="2" />
        </svg>
        {badge > 0 && (
          <span
            className="av2-mono"
            aria-hidden="true"
            style={{
              position: 'absolute', top: -5, right: -5, minWidth: 17, height: 17, padding: '0 4px',
              borderRadius: 9, background: badgeTone, color: '#fff', fontSize: 9.5, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
              border: '2px solid var(--canvas)',
            }}
          >
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} aria-hidden="true" />
          {/* Plain popover of buttons/links — deliberately NOT role="menu",
              which would promise arrow-key/focus semantics this doesn't have.
              Tab walks the real <button>s; Escape closes. */}
          <div
            aria-label="Notifications"
            style={{
              position: 'absolute', right: 0, top: 44, zIndex: 70, width: 340,
              background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 12,
              boxShadow: 'var(--shadow)', boxSizing: 'border-box', overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
              <span className="av2-microcaps">Needs attention</span>
              <span style={{ flex: 1 }} />
              <span className="av2-mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>
                {attention.dataUpdatedAt ? `updated ${fmtRelative(attention.dataUpdatedAt)}` : ''}
              </span>
            </div>

            <div style={{ maxHeight: 380, overflowY: 'auto', padding: 6 }}>
              {attention.isLoading && [0, 1].map((i) => (
                <div key={i} style={{ padding: 4 }}><Skeleton height={40} /></div>
              ))}
              {attention.isError && (
                <div style={{ padding: '14px 10px', display: 'grid', gap: 8, justifyItems: 'start' }}>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Couldn’t load alerts.</span>
                  <button type="button" className="av2-btn av2-btn--sm" onClick={() => attention.refetch()}>Retry</button>
                </div>
              )}
              {!attention.isLoading && !attention.isError && rows.length === 0 && (
                <div style={{ padding: '18px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>All clear</div>
                  <div className="av2-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 3 }}>nothing needs attention right now</div>
                </div>
              )}
              {rows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => go(r.href)}
                  style={{
                    display: 'flex', width: '100%', alignItems: 'flex-start', gap: 9, textAlign: 'left',
                    background: 'transparent', border: 'none', borderRadius: 8, padding: '8px 10px',
                    cursor: 'pointer', fontFamily: 'var(--font-ui)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span aria-hidden="true" style={{ flex: 'none', fontSize: 11, lineHeight: '17px', color: TONE[r.severity] || 'var(--ink-3)' }}>
                    {SEVERITY_GLYPH[r.severity] || '●'}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>{r.title}</span>
                    <span className="av2-mono" style={{ display: 'block', fontSize: 10, color: 'var(--ink-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.detail}</span>
                  </span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => go('/AdminDashboard')}
              className="av2-mono"
              style={{
                display: 'block', width: '100%', padding: '9px 12px', textAlign: 'left',
                background: 'transparent', border: 'none', borderTop: '1px solid var(--line)',
                fontSize: 10.5, color: 'var(--ink-2)', cursor: 'pointer',
              }}
            >
              Open dashboard →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
