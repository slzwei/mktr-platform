/**
 * Switchboard Dashboard — the operator cockpit, laid out 1:1 with the design
 * source (claude.ai/design 57e68763 "MKTR Admin.dc.html"): five-segment health
 * strip → Needs attention + Lead flow (line chart with the funnel in-card) →
 * Recent leads + Campaign leaderboard. Every number derives from the Phase B
 * endpoints (overview / attention / series / funnel / campaigns / prospects);
 * nothing is hardcoded.
 */
import { useEffect, useState } from 'react';
import { getMarketplaceListedFromDoc } from '@/lib/designConfigV2';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAttention, useSeries, useFunnel, useCampaignLeaderboard, useProspects } from '@/hooks/queries/useAdminV2';
import { fetchProspects } from '@/api/adminV2';
import { composeAttentionRows, composeHealthStrip, SEVERITY_GLYPH } from '@/lib/adminV2/attention';
import { fmtNumber, fmtSGD, fmtRelative, fmtAgoShort, daysUntil } from '@/lib/adminV2/format';
import { HELD_REASON_LABELS } from '@/lib/adminV2/constants';
import { prospectsToCsv, downloadCsv } from '@/lib/adminV2/csv';
import { Card, PeriodSwitch, Skeleton, ErrorState } from '@/components/adminv2/primitives';

const SEVERITY_STYLE = {
  incident: { bg: 'var(--bad-soft)', fg: 'var(--bad)' },
  held: { bg: 'var(--hold-soft)', fg: 'var(--hold)' },
  warning: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  watch: { bg: 'var(--accent-soft)', fg: 'var(--accent-text)' },
};

// Glyph shapes for the health strip (state is never color alone — DS §4).
const GLYPH_PATH = {
  tri: 'M12 3 L22 20 L2 20 Z',
  dia: 'M12 2 L21 12 L12 22 L3 12 Z',
  cir: 'M12 4 a8 8 0 1 1 0 16 a8 8 0 1 1 0 -16 Z',
  sq: 'M5 5 h14 v14 H5 Z',
};
const TONE_COLOR = {
  bad: 'var(--bad)', warn: 'var(--warn)', ok: 'var(--ok)', hold: 'var(--hold)',
  accent: 'var(--accent)', 'accent-text': 'var(--accent-text)', neutral: 'var(--ink-3)',
};

const PERIOD_NOUN = { '7d': 'last 7 days', '30d': 'last 30 days', '90d': 'last 90 days' };
const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

// Compact source labels for the narrow chip column (mock vocabulary).
const SOURCE_SHORT = {
  qr_code: 'QR', website: 'Web', social_media: 'Social', advertisement: 'Ad',
  referral: 'Referral', direct: 'Direct', call_bot: 'Call bot', other: 'Other',
};

function dayLabel(isoDate) {
  // "2026-06-16" → "16/06" (axis vocabulary from the design).
  if (!isoDate || typeof isoDate !== 'string') return '';
  const [, m, d] = isoDate.split('-');
  return m && d ? `${d}/${m}` : isoDate;
}

function HealthStrip() {
  const attention = useAttention();
  if (attention.isLoading) return <div style={{ gridColumn: 'span 12' }}><Skeleton height={74} style={{ borderRadius: 14 }} /></div>;
  if (attention.isError) return <Card span={12}><ErrorState error={attention.error} onRetry={attention.refetch} /></Card>;

  const strip = composeHealthStrip(attention.data);
  return (
    <div className="av2-card" style={{ gridColumn: 'span 12', display: 'flex', overflow: 'hidden' }}>
      {strip.map((seg, i) => (
        <Link
          key={seg.id}
          to={seg.href}
          className="av2-striplink"
          style={{
            flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1,
            padding: '13px 16px', color: 'var(--ink)', textDecoration: 'none',
            borderRight: i < strip.length - 1 ? '1px solid var(--line)' : 'none',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, flex: 'none' }} aria-hidden="true">
              <path d={GLYPH_PATH[seg.shape]} fill={TONE_COLOR[seg.tone]} />
            </svg>
            <span className="av2-mono" style={{ fontSize: 15.5, fontWeight: 600, whiteSpace: 'nowrap', color: seg.valueTone ? TONE_COLOR[seg.valueTone] : 'var(--ink)' }}>
              {seg.value}
            </span>
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{seg.label}</span>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{seg.detail}</span>
        </Link>
      ))}
    </div>
  );
}

function AttentionQueue() {
  const attention = useAttention();
  if (attention.isLoading) return <Card span={5} title="Needs attention" style={{ minHeight: 330 }}><div style={{ padding: 16, display: 'grid', gap: 10 }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={44} />)}</div></Card>;
  if (attention.isError) return <Card span={5} title="Needs attention" style={{ minHeight: 330 }}><ErrorState error={attention.error} onRetry={attention.refetch} /></Card>;

  const rows = composeAttentionRows(attention.data);
  return (
    <section className="av2-card" style={{ gridColumn: 'span 5', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 330 }}>
      <header className="av2-card-head">
        <h2 className="av2-h2" style={{ margin: 0 }}>Needs attention</h2>
        {rows.length > 0 && (
          <span className="av2-mono" style={{ fontSize: 11, fontWeight: 600, background: 'var(--ink)', color: 'var(--canvas)', borderRadius: 6, padding: '1px 7px' }}>
            {rows.length}
          </span>
        )}
        <span style={{ flex: 1 }} />
      </header>
      {rows.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32, textAlign: 'center' }}>
          <svg viewBox="0 0 24 24" style={{ width: 38, height: 38 }} aria-hidden="true">
            <circle cx="12" cy="12" r="10" fill="var(--ok-soft)" />
            <path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="var(--ok)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ fontSize: 14, fontWeight: 800 }}>All clear</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', maxWidth: '36ch', lineHeight: 1.5 }}>
            Webhooks, wallets and commitments are healthy. Signals appear here the moment something needs you.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((r) => {
            const sv = SEVERITY_STYLE[r.severity];
            return (
              <Link key={r.id} to={r.href} className="av2-qrow" style={{ minHeight: 44, padding: '9px 16px' }}>
                <span className="av2-qicon" style={{ background: sv.bg, color: sv.fg }} aria-hidden="true">{SEVERITY_GLYPH[r.severity]}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.detail}</span>
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-text)', whiteSpace: 'nowrap', flex: 'none' }}>{r.cta} →</span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LeadFlow({ period }) {
  const series = useSeries(period);
  const funnel = useFunnel(period);
  if (series.isLoading || funnel.isLoading) return <Card span={7} title="Lead flow" style={{ minHeight: 330 }}><div style={{ padding: 16 }}><Skeleton height={42} width={120} /><Skeleton height={118} style={{ marginTop: 14 }} /><Skeleton height={90} style={{ marginTop: 14 }} /></div></Card>;
  if (series.isError) return <Card span={7} title="Lead flow" style={{ minHeight: 330 }}><ErrorState error={series.error} onRetry={series.refetch} /></Card>;
  if (funnel.isError) return <Card span={7} title="Lead flow" style={{ minHeight: 330 }}><ErrorState error={funnel.error} onRetry={funnel.refetch} /></Card>;

  const s = { days: [], today: 0, avgPerDay: 0, ...(series.data || {}) };
  const days = s.days.length ? s.days : [{ date: '', count: 0 }];

  // Line + area geometry (600×140 viewBox, exact math from the design source).
  const max = Math.max(4, ...days.map((d) => d.count));
  const W = 600; const TOP = 10; const BOT = 128; const H = 140;
  const n = days.length;
  const pts = days.map((d, i) => [n === 1 ? W : (i / (n - 1)) * W, BOT - (d.count / max) * (BOT - TOP)]);
  const sparkLine = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const sparkArea = `${sparkLine} L${W} ${H} L0 ${H} Z`;
  const [endX, endY] = pts[pts.length - 1];
  const avgY = BOT - (Math.min(s.avgPerDay, max) / max) * (BOT - TOP);

  let delta;
  if (s.avgPerDay >= 0.5) {
    const pct = Math.round(((s.today - s.avgPerDay) / s.avgPerDay) * 100);
    if (pct >= 3) delta = { label: `▲ ${pct}% vs avg`, bg: 'var(--ok-soft)', fg: 'var(--ok)' };
    else if (pct <= -3) delta = { label: `▼ ${Math.abs(pct)}% vs avg`, bg: 'var(--surface-2)', fg: 'var(--ink-2)' };
    else delta = { label: '≈ on avg', bg: 'var(--surface-2)', fg: 'var(--ink-2)' };
  } else {
    delta = { label: '— no baseline', bg: 'var(--surface-2)', fg: 'var(--ink-2)' };
  }

  const f = funnel.data || {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const scans = num(f.scans); const submits = num(f.submits); const assigned = num(f.assigned); const won = num(f.won);
  const fmax = Math.max(1, scans);
  const cv = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}% of` : '— of');
  const bar = (v) => (v ? Math.max((v / fmax) * 100, 2.5) : 0);
  const funnelRows = [
    { label: `QR scans${f.estimated ? ' (est.)' : ''}`, count: scans, pct: scans ? 100 : 0, conv: 'prorated to period', color: 'var(--line-strong)' },
    { label: 'Submits · OTP-verified', count: submits, pct: bar(submits), conv: `${cv(submits, scans)} scans`, color: 'var(--accent)' },
    { label: 'Assigned to agents', count: assigned, pct: bar(assigned), conv: `${cv(assigned, submits)} submits`, color: 'var(--accent)' },
    { label: 'Won', count: won, pct: bar(won), conv: `${cv(won, assigned)} assigned`, color: 'var(--ok)' },
  ];

  return (
    <section className="av2-card" style={{ gridColumn: 'span 7', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 330 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '13px 16px 0' }}>
        <h2 className="av2-h2" style={{ margin: 0 }}>Lead flow</h2>
        <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>OTP-verified submissions · {PERIOD_NOUN[period]}</span>
        <span style={{ flex: 1 }} />
        <span className="av2-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>peak {fmtNumber(max)}/day</span>
      </header>
      <div style={{ padding: '10px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}>{fmtNumber(s.today)}</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 6, padding: '3px 8px', background: delta.bg, color: delta.fg }}>{delta.label}</span>
          <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>leads today (since 00:00 SGT)</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 118, display: 'block' }} aria-hidden="true">
          <path d={sparkArea} fill="var(--accent-soft)" />
          <line x1="0" x2={W} y1={avgY.toFixed(1)} y2={avgY.toFixed(1)} stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="3 6" />
          <path d={sparkLine} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          <circle className="av2-chart-dot" cx={endX.toFixed(1)} cy={endY.toFixed(1)} r="4.5" fill="var(--accent)" style={{ animation: 'av2-livepulse 2.4s ease-in-out infinite' }} />
        </svg>
        <div className="av2-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--ink-3)' }}>
          <span>{dayLabel(days[0].date)}</span><span>┄ avg {s.avgPerDay}/day</span><span>today</span>
        </div>
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {funnelRows.map((r) => (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 170, flex: 'none', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>{r.label}</span>
              <span style={{ flex: 1, height: 18, background: 'var(--surface-2)', borderRadius: 5, overflow: 'hidden', display: 'block' }}>
                <span style={{ display: 'block', height: '100%', width: `${r.pct}%`, background: r.color, borderRadius: 5 }} />
              </span>
              <span className="av2-mono" style={{ width: 60, flex: 'none', textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{fmtNumber(r.count)}</span>
              <span style={{ width: 118, flex: 'none', textAlign: 'right', fontSize: 10.5, color: 'var(--ink-3)' }}>{r.conv}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RecentLeads() {
  const recent = useProspects({ limit: 8, sort: '-createdAt' });
  if (recent.isLoading) return <Card span={7} title="Recent leads"><div style={{ padding: 16, display: 'grid', gap: 10 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={38} />)}</div></Card>;
  if (recent.isError) return <Card span={7} title="Recent leads"><ErrorState error={recent.error} onRetry={recent.refetch} /></Card>;

  const rows = recent.data.rows;
  return (
    <section className="av2-card" style={{ gridColumn: 'span 7', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <header className="av2-card-head">
        <h2 className="av2-h2" style={{ margin: 0 }}>Recent leads</h2>
        <span className="av2-pulse" aria-hidden="true" />
        <span style={{ flex: 1 }} />
        <Link to="/AdminProspects" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent-text)', textDecoration: 'none' }}>View all →</Link>
      </header>
      {rows.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 40, textAlign: 'center' }}>
          <span className="av2-qicon" style={{ background: 'var(--surface-2)', color: 'var(--ink-3)', width: 38, height: 38, borderRadius: 11 }} aria-hidden="true">○</span>
          <div style={{ fontSize: 14, fontWeight: 800 }}>No leads in this window</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', maxWidth: '40ch', lineHeight: 1.5 }}>
            Verified submissions stream in here the moment OTP passes. Check that campaigns are live and QR placements are out.
          </div>
          <Link to="/AdminCampaigns" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent-text)', textDecoration: 'none' }}>Open Campaigns →</Link>
        </div>
      ) : (
        <div>
          {rows.map((p) => {
            const held = !!p.quarantinedAt;
            const utm = p.sourceMetadata?.utm?.utm_source;
            const agent = p.assignedAgent ? `${p.assignedAgent.firstName || ''} ${p.assignedAgent.lastName || ''}`.trim() : '';
            const search = p.phone || `${p.firstName || ''} ${p.lastName || ''}`.trim();
            return (
              <Link key={p.id} to={`/AdminProspects?q=${encodeURIComponent(search)}`} className="av2-qrow" style={{ padding: '7px 16px', minHeight: 47 }}>
                <span className="av2-mono" style={{ width: 38, flex: 'none', fontSize: 11, color: 'var(--ink-3)' }}>{fmtAgoShort(p.createdAt)}</span>
                <span style={{ flex: 1.2, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.firstName} {p.lastName}</span>
                  <span className="av2-mono" style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{p.phone || '—'}</span>
                </span>
                <span style={{ width: 100, flex: 'none' }}>
                  <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, background: 'var(--surface-2)', color: 'var(--ink-2)', borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                    {SOURCE_SHORT[p.leadSource] || p.leadSource}{utm ? ` · ${utm}` : ''}
                  </span>
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.campaign?.name || '—'}</span>
                <span style={{ width: 126, flex: 'none', display: 'flex', justifyContent: 'flex-end' }}>
                  {held ? (
                    <span style={{ fontSize: 11, fontWeight: 700, background: 'var(--hold-soft)', color: 'var(--hold)', borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                      ◆ {HELD_REASON_LABELS[p.quarantineReason] ? `Held · ${HELD_REASON_LABELS[p.quarantineReason]}` : 'Held'}
                    </span>
                  ) : agent ? (
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent}</span>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, background: 'var(--warn-soft)', color: 'var(--warn)', borderRadius: 6, padding: '2px 8px' }}>Unassigned</span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Leaderboard({ period }) {
  const campaigns = useCampaignLeaderboard(period);
  // The zero-commitment incident set comes from /attention — the server's
  // authoritative definition (wallet OR package funding, active+priced).
  // Deriving it client-side from committedRemaining (wallet-only) would flag
  // package-funded campaigns with a false red badge.
  const attention = useAttention();
  const zeroCommitIds = new Set((attention.data?.zeroCommitCampaigns || []).map((c) => c.id));
  if (campaigns.isLoading) return <Card span={5} title="Campaigns"><div style={{ padding: 16, display: 'grid', gap: 10 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={44} />)}</div></Card>;
  if (campaigns.isError) return <Card span={5} title="Campaigns"><ErrorState error={campaigns.error} onRetry={campaigns.refetch} /></Card>;

  const rows = [...campaigns.data.rows]
    .filter((c) => c.status !== 'archived' && c.status !== 'draft')
    .sort((a, b) => (b.leadsThisPeriod || 0) - (a.leadsThisPeriod || 0))
    .slice(0, 6);
  const max = Math.max(1, ...rows.map((c) => c.leadsThisPeriod || 0));
  const typeLabel = { lead_generation: 'Lead gen', quiz: 'Quiz', guided_review: 'Guided review' };

  return (
    <section className="av2-card" style={{ gridColumn: 'span 5', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <header className="av2-card-head">
        <h2 className="av2-h2" style={{ margin: 0 }}>Campaigns</h2>
        <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>by leads · {PERIOD_NOUN[period]}</span>
        <span style={{ flex: 1 }} />
        <Link to="/AdminCampaigns" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent-text)', textDecoration: 'none' }}>All →</Link>
      </header>
      {rows.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center', fontSize: 12.5, color: 'var(--ink-2)' }}>
          No campaign activity in this period.
        </div>
      ) : (
        <div>
          {rows.map((c, i) => {
            const badges = [];
            const draw = c.design_config?.luckyDraw;
            if (draw?.enabled) {
              const dd = daysUntil(draw.closesAt);
              if (dd !== null && dd <= 7) badges.push({ label: `Draw closes ${dd}d`, bg: 'var(--warn-soft)', fg: 'var(--warn)' });
              else badges.push({ label: 'Lucky draw', bg: 'var(--hold-soft)', fg: 'var(--hold)' });
            }
            if (c.status === 'paused') badges.push({ label: 'Paused', bg: 'var(--warn-soft)', fg: 'var(--warn)' });
            if (zeroCommitIds.has(c.id)) badges.push({ label: '▲ 0 commitments', bg: 'var(--bad-soft)', fg: 'var(--bad)' });
            else if (c.committedValueCents > 0) badges.push({ label: `${fmtSGD(c.committedValueCents)} committed`, bg: 'var(--accent-soft)', fg: 'var(--accent-text)' });
            if (getMarketplaceListedFromDoc(c.design_config) === true) badges.push({ label: 'Marketplace', bg: 'var(--accent-soft)', fg: 'var(--accent-text)' });
            const count = c.leadsThisPeriod || 0;
            return (
              <Link key={c.id} to={`/admin/campaigns/${c.id}`} style={{ display: 'block', padding: '10px 16px', borderBottom: '1px solid var(--line)', color: 'var(--ink)', textDecoration: 'none' }} className="av2-boardrow">
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="av2-mono" style={{ width: 20, flex: 'none', fontSize: 11, color: 'var(--ink-3)' }}>{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                  <span className="av2-mono" style={{ fontSize: 13, fontWeight: 600 }}>{fmtNumber(count)}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>leads</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '5px 0 0 30px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10.5, fontWeight: 600, background: 'var(--surface-2)', color: 'var(--ink-3)', borderRadius: 5, padding: '2px 7px' }}>
                    {typeLabel[c.type] || c.status}
                  </span>
                  {badges.map((b) => (
                    <span key={b.label} style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 5, padding: '2px 7px', background: b.bg, color: b.fg }}>{b.label}</span>
                  ))}
                </span>
                <span style={{ display: 'block', height: 4, background: 'var(--surface-2)', borderRadius: 3, margin: '8px 0 0 30px', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${count ? Math.max((count / max) * 100, 2) : 0}%`, background: 'var(--accent)', borderRadius: 3 }} />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function AdminV2Dashboard() {
  const [period, setPeriod] = useState('30d');
  const [exporting, setExporting] = useState(false);
  const queryClient = useQueryClient();
  const attention = useAttention();

  // Re-render every 15s so "updated Xm ago" stays honest without refetching.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const handleRefresh = () => queryClient.invalidateQueries({ queryKey: ['adminV2'] });

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const dateFrom = new Date(Date.now() - (PERIOD_DAYS[period] || 30) * 86400000).toISOString();
      const first = await fetchProspects({ limit: 200, page: 1, sort: '-createdAt', dateFrom });
      const rows = [...first.rows];
      const pages = Math.min(first.totalPages || 1, 15); // 3,000-row ceiling
      for (let p = 2; p <= pages; p += 1) {
        const r = await fetchProspects({ limit: 200, page: p, sort: '-createdAt', dateFrom });
        rows.push(...r.rows);
      }
      downloadCsv(`mktr-leads-${period}.csv`, prospectsToCsv(rows));
      if ((first.total || 0) > rows.length) toast.info(`Exported the ${fmtNumber(rows.length)} most recent of ${fmtNumber(first.total)} leads`);
    } catch {
      toast.error('Export failed — try again');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="av2-h1" style={{ margin: 0 }}>Dashboard</h1>
          <div className="av2-mono" style={{ marginTop: 3, fontSize: 11, color: 'var(--ink-3)' }}>
            updated {attention.dataUpdatedAt ? fmtRelative(attention.dataUpdatedAt) : '—'} · all times SGT · currency SGD
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" className="av2-btn" onClick={handleRefresh} title="Re-fetch all widgets" style={{ fontSize: 12.5, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>
          <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, flex: 'none' }} aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Refresh
        </button>
        <PeriodSwitch value={period} onChange={setPeriod} />
        <button type="button" className="av2-btn" onClick={handleExport} disabled={exporting} style={{ whiteSpace: 'nowrap' }}>
          <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, flex: 'none' }} aria-hidden="true">
            <path d="M12 4v10m0 0-4-4m4 4 4-4M5 19h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16, alignItems: 'stretch' }}>
        <HealthStrip />
        <AttentionQueue />
        <LeadFlow period={period} />
        <RecentLeads />
        <Leaderboard period={period} />
      </div>
    </div>
  );
}
