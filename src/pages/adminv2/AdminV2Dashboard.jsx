/**
 * Switchboard Dashboard — the operator cockpit. Every number derives from the
 * Phase B endpoints (overview / attention / series / funnel / campaigns);
 * nothing is hardcoded. Period recomputes every widget; charts are token-driven
 * div bars (exact design fidelity, no chart lib).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useOverview, useAttention, useSeries, useFunnel, useCampaignLeaderboard, useProspects } from '@/hooks/queries/useAdminV2';
import { composeAttentionRows, composeHealthCells, SEVERITY_GLYPH } from '@/lib/adminV2/attention';
import { fmtNumber, fmtSGD, fmtRelative, daysUntil } from '@/lib/adminV2/format';
import { STATUS_LABELS, STATUS_CHIP_CLASS, SOURCE_LABELS, HELD_REASON_LABELS, UTM_LABELS } from '@/lib/adminV2/constants';
import { Card, Chip, PeriodSwitch, Skeleton, ErrorState, EmptyState, PageHeader } from '@/components/adminv2/primitives';

const SEVERITY_STYLE = {
  incident: { bg: 'var(--bad-soft)', fg: 'var(--bad)' },
  held: { bg: 'var(--hold-soft)', fg: 'var(--hold)' },
  warning: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  watch: { bg: 'var(--accent-soft)', fg: 'var(--accent-text)' },
};

const TONE_FG = { bad: 'var(--bad)', warn: 'var(--warn)', ok: 'var(--ok)', hold: 'var(--hold)', accent: 'var(--ink)', neutral: 'var(--ink)' };

function Sparkline({ days }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 44 }} aria-hidden="true">
      {days.map((d) => (
        <div
          key={d.date}
          title={`${d.date}: ${d.count}`}
          style={{
            flex: 1,
            height: `${Math.max(4, (d.count / max) * 100)}%`,
            borderRadius: 2,
            background: d.isToday ? 'var(--accent)' : 'var(--accent-soft)',
          }}
        />
      ))}
    </div>
  );
}

function KpiCard({ period }) {
  const series = useSeries(period);
  const overview = useOverview(period);
  if (series.isLoading || overview.isLoading) {
    return (
      <Card span={5}><div style={{ padding: 16 }}><Skeleton height={42} width={120} /><Skeleton height={44} style={{ marginTop: 14 }} /><Skeleton height={14} width={220} style={{ marginTop: 10 }} /></div></Card>
    );
  }
  if (series.isError) return <Card span={5}><ErrorState error={series.error} onRetry={series.refetch} /></Card>;

  const s = series.data;
  const p = overview.data?.prospects;
  const delta = s.avgPerDay > 0 ? Math.round(((s.today - s.avgPerDay) / s.avgPerDay) * 100) : null;
  return (
    <Card span={5}>
      <div style={{ padding: 16 }}>
        <div className="av2-microcaps">Leads today</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span className="av2-kpi av2-mono">{fmtNumber(s.today)}</span>
          {delta !== null && (
            <span className="av2-mono" style={{ fontSize: 12.5, fontWeight: 600, color: delta >= 0 ? 'var(--ok)' : 'var(--ink-3)' }}>
              {delta >= 0 ? '+' : ''}{delta}% vs {s.avgPerDay}/day avg
            </span>
          )}
        </div>
        <div style={{ marginTop: 12 }}><Sparkline days={s.days} /></div>
        <div className="av2-caption" style={{ marginTop: 10 }}>
          {fmtNumber(s.total)} OTP-verified submissions · last {period}
          {p && <> · {fmtNumber(p.assigned)} assigned · {fmtNumber(p.converted)} won ({p.conversionRate}%)</>}
        </div>
      </div>
    </Card>
  );
}

function HealthStrip() {
  const attention = useAttention();
  if (attention.isLoading) return <Card span={7}><div style={{ display: 'flex', gap: 12, padding: 16 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={62} style={{ flex: 1 }} />)}</div></Card>;
  if (attention.isError) return <Card span={7}><ErrorState error={attention.error} onRetry={attention.refetch} /></Card>;

  const cells = composeHealthCells(attention.data);
  return (
    <Card span={7}>
      <div style={{ display: 'flex' }}>
        {cells.map((c, i) => (
          <div key={c.id} style={{ flex: 1, padding: '16px', borderRight: i < cells.length - 1 ? '1px solid var(--line)' : 'none' }}>
            <div className="av2-mono" style={{ fontSize: 17, fontWeight: 600, color: TONE_FG[c.tone] || 'var(--ink)' }}>{c.value}</div>
            <div className="av2-caption" style={{ marginTop: 4 }}>{c.caption}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AttentionQueue() {
  const attention = useAttention();
  if (attention.isLoading) return <Card span={5} title="Needs attention"><div style={{ padding: 16, display: 'grid', gap: 10 }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={44} />)}</div></Card>;
  if (attention.isError) return <Card span={5} title="Needs attention"><ErrorState error={attention.error} onRetry={attention.refetch} /></Card>;

  const rows = composeAttentionRows(attention.data);
  return (
    <Card span={5} title="Needs attention" meta={rows.length ? `${rows.length} item${rows.length === 1 ? '' : 's'}` : undefined}>
      {rows.length === 0 ? (
        <EmptyState icon="✓" title="All clear" hint="No incidents, holds, or deadlines on the rail." />
      ) : (
        rows.map((r) => {
          const sv = SEVERITY_STYLE[r.severity];
          return (
            <Link key={r.id} to={r.href} className="av2-qrow">
              <span className="av2-qicon" style={{ background: sv.bg, color: sv.fg }} aria-hidden="true">{SEVERITY_GLYPH[r.severity]}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{r.title}</span>
                <span className="av2-caption" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.detail}</span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-text)', flex: 'none' }}>{r.cta} →</span>
            </Link>
          );
        })
      )}
    </Card>
  );
}

function LeadFlow({ period }) {
  const series = useSeries(period);
  if (series.isLoading) return <Card span={7} title="Lead flow"><div style={{ padding: 16 }}><Skeleton height={160} /></div></Card>;
  if (series.isError) return <Card span={7} title="Lead flow"><ErrorState error={series.error} onRetry={series.refetch} /></Card>;

  const { days } = series.data;
  const max = Math.max(1, ...days.map((d) => d.count));
  const labelEvery = Math.max(1, Math.floor(days.length / 6));
  return (
    <Card span={7} title="Lead flow" meta={`daily · SGT midnight buckets · last ${period}`}>
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: days.length > 40 ? 1 : 3, height: 150 }}>
          {days.map((d) => (
            <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }} title={`${d.date}: ${d.count} leads`}>
              <div style={{ height: `${Math.max(2, (d.count / max) * 100)}%`, borderRadius: 2, background: d.isToday ? 'var(--accent)' : 'var(--accent-soft)' }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', marginTop: 6 }}>
          {days.map((d, i) => (
            <span key={d.date} className="av2-mono" style={{ flex: 1, fontSize: 9, color: 'var(--ink-3)', textAlign: 'center' }}>
              {i % labelEvery === 0 ? d.date.slice(5).split('-').reverse().join('/') : ''}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Funnel({ period }) {
  const funnel = useFunnel(period);
  if (funnel.isLoading) return <Card span={5} title="Funnel"><div style={{ padding: 16, display: 'grid', gap: 10 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={30} />)}</div></Card>;
  if (funnel.isError) return <Card span={5} title="Funnel"><ErrorState error={funnel.error} onRetry={funnel.refetch} /></Card>;

  const f = funnel.data;
  const stages = [
    { label: `Scans${f.estimated ? ' (est.)' : ''}`, value: f.scans },
    { label: 'Submits', value: f.submits },
    { label: 'Assigned', value: f.assigned },
    { label: 'Won', value: f.won },
  ];
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <Card span={5} title="Funnel" meta={`last ${period}`}>
      <div style={{ padding: 16, display: 'grid', gap: 10 }}>
        {stages.map((s) => (
          <div key={s.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span className="av2-caption">{s.label}</span>
              <span className="av2-mono" style={{ fontSize: 12, fontWeight: 600 }}>{fmtNumber(s.value)}</span>
            </div>
            <div style={{ height: 10, borderRadius: 5, background: 'var(--surface-2)' }}>
              <div style={{ width: `${(s.value / max) * 100}%`, height: '100%', borderRadius: 5, background: 'var(--accent)' }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RecentLeads() {
  const recent = useProspects({ limit: 8, sort: '-createdAt' });
  if (recent.isLoading) return <Card span={7} title="Recent leads"><div style={{ padding: 16, display: 'grid', gap: 10 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={36} />)}</div></Card>;
  if (recent.isError) return <Card span={7} title="Recent leads"><ErrorState error={recent.error} onRetry={recent.refetch} /></Card>;

  const rows = recent.data.rows;
  return (
    <Card span={7} title="Recent leads" action={<Link to="/AdminProspects" style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-text)', textDecoration: 'none' }}>All prospects →</Link>}>
      {rows.length === 0 ? (
        <EmptyState title="No leads yet" hint="New submissions stream in here live." />
      ) : (
        rows.map((p) => {
          const held = !!p.quarantinedAt;
          const utm = p.sourceMetadata?.utm?.utm_source;
          return (
            <div key={p.id} className="av2-qrow" style={{ cursor: 'default' }}>
              <span style={{ flex: 1.3, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{p.firstName} {p.lastName}</span>
                <span className="av2-caption" style={{ display: 'block' }}>
                  {SOURCE_LABELS[p.leadSource] || p.leadSource}{utm ? ` · ${UTM_LABELS[utm] || utm}` : ''}{p.campaign ? ` · ${p.campaign.name}` : ''}
                </span>
              </span>
              {held ? (
                <Chip tone="hold" glyph="◆">{HELD_REASON_LABELS[p.quarantineReason] || 'Held'}</Chip>
              ) : p.assignedAgent ? (
                <Chip tone="">{p.assignedAgent.firstName}</Chip>
              ) : (
                <Chip tone="warn">Unassigned</Chip>
              )}
              <Chip tone={STATUS_CHIP_CLASS[p.leadStatus]?.replace('av2-chip--', '') || ''}>{STATUS_LABELS[p.leadStatus] || p.leadStatus}</Chip>
              <span className="av2-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', width: 64, textAlign: 'right', flex: 'none' }}>{fmtRelative(p.createdAt)}</span>
            </div>
          );
        })
      )}
    </Card>
  );
}

function Leaderboard({ period }) {
  const campaigns = useCampaignLeaderboard(period);
  if (campaigns.isLoading) return <Card span={12} title="Campaign leaderboard"><div style={{ padding: 16, display: 'grid', gap: 10 }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={36} />)}</div></Card>;
  if (campaigns.isError) return <Card span={12} title="Campaign leaderboard"><ErrorState error={campaigns.error} onRetry={campaigns.refetch} /></Card>;

  const rows = [...campaigns.data.rows]
    .filter((c) => c.status !== 'archived' && c.status !== 'draft')
    .sort((a, b) => (b.leadsThisPeriod || 0) - (a.leadsThisPeriod || 0))
    .slice(0, 6);
  const max = Math.max(1, ...rows.map((c) => c.leadsThisPeriod || 0));

  return (
    <Card span={12} title="Campaign leaderboard" meta={`top ${rows.length} by leads · last ${period}`}>
      {rows.length === 0 ? (
        <EmptyState title="No active campaigns" hint="Launch a campaign to start the board." />
      ) : (
        rows.map((c) => {
          const draw = c.design_config?.luckyDraw;
          const drawDays = draw?.enabled ? daysUntil(draw.closesAt) : null;
          const priced = Number.isInteger(c.leadPriceCents) && c.leadPriceCents > 0;
          const zeroCommit = priced && c.status === 'active' && !(c.committedRemaining > 0);
          return (
            <div key={c.id} className="av2-qrow" style={{ cursor: 'default' }}>
              <span style={{ flex: 1.4, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                <span className="av2-caption">{c.status}{priced ? ` · ${fmtSGD(c.leadPriceCents)}/lead` : ''}</span>
              </span>
              <span style={{ flex: 1.2, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {zeroCommit && <Chip tone="bad" glyph="▲">0 commitments</Chip>}
                {c.committedRemaining > 0 && <Chip tone="accent">{fmtNumber(c.committedRemaining)} committed · {fmtSGD(c.committedValueCents)}</Chip>}
                {drawDays !== null && drawDays > 0 && <Chip tone="warn">Draw closes {drawDays}d</Chip>}
                {c.design_config?.marketplaceListed === true && <Chip tone="accent">Marketplace</Chip>}
              </span>
              <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--surface-2)' }}>
                  <span style={{ display: 'block', width: `${((c.leadsThisPeriod || 0) / max) * 100}%`, height: '100%', borderRadius: 4, background: 'var(--accent)' }} />
                </span>
                <span className="av2-mono" style={{ fontSize: 12, fontWeight: 600, width: 44, textAlign: 'right' }}>{fmtNumber(c.leadsThisPeriod || 0)}</span>
              </span>
            </div>
          );
        })
      )}
    </Card>
  );
}

export default function AdminV2Dashboard() {
  const [period, setPeriod] = useState('30d');
  return (
    <div>
      <PageHeader title="Dashboard" meta="LEAD GENERATION · OTP-VERIFIED SUBMISSIONS · SGT">
        <PeriodSwitch value={period} onChange={setPeriod} />
      </PageHeader>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
        <KpiCard period={period} />
        <HealthStrip />
        <AttentionQueue />
        <LeadFlow period={period} />
        <Funnel period={period} />
        <RecentLeads />
        <Leaderboard period={period} />
      </div>
    </div>
  );
}
