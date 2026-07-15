/**
 * Switchboard Campaigns — the operator campaign board. Period aggregates,
 * committed-demand + draw + marketplace chips, authoritative zero-commitment
 * badges (from /attention), and rows that open the v2 detail screen. Creation
 * and design stay on the existing flows (workspace / designer) — this screen
 * observes and navigates, it does not fork the editing surface.
 */
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCampaignLeaderboard, useAttention } from '@/hooks/queries/useAdminV2';
import { fmtNumber, fmtSGD, fmtDate, daysUntil } from '@/lib/adminV2/format';
import { Chip, PageHeader, PeriodSwitch, Skeleton, ErrorState, EmptyState } from '@/components/adminv2/primitives';

const STATUS_TONE = { active: 'ok', draft: '', paused: 'warn', completed: '', archived: '' };
const TYPE_LABELS = {
  lead_generation: 'Lead gen',
  quiz: 'Quiz',
  guided_review: 'Guided review',
  brand_awareness: 'Brand',
  product_promotion: 'Promo',
  event_marketing: 'Event',
};

const WORKSPACE_ON = import.meta.env.VITE_CAMPAIGN_WORKSPACE_ENABLED === 'true';
export const newCampaignHref = () => (WORKSPACE_ON ? '/admin/campaigns/workspace' : '/admin/campaigns/new');

export default function AdminV2Campaigns() {
  // Filters live in the URL (shareable, back/forward safe) — same rule as Prospects.
  const [searchParams, setSearchParams] = useSearchParams();
  const period = ['7d', '30d', '90d'].includes(searchParams.get('period')) ? searchParams.get('period') : '30d';
  const statusFilter = searchParams.get('status') || '';
  const patch = (changes) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === '' || v === undefined) next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
  };
  const setPeriod = (p) => patch({ period: p === '30d' ? null : p });
  const setStatusFilter = (v) => patch({ status: v || null });
  const navigate = useNavigate();
  const campaigns = useCampaignLeaderboard(period);
  const attention = useAttention();
  const zeroCommitIds = useMemo(
    () => new Set((attention.data?.zeroCommitCampaigns || []).map((c) => c.id)),
    [attention.data]
  );

  const rows = useMemo(() => {
    const all = campaigns.data?.rows || [];
    const filtered = statusFilter ? all.filter((c) => c.status === statusFilter) : all;
    return [...filtered].sort((a, b) => (b.leadsThisPeriod || 0) - (a.leadsThisPeriod || 0));
  }, [campaigns.data, statusFilter]);

  const statuses = ['', 'active', 'draft', 'paused', 'archived'];

  return (
    <div>
      <PageHeader title="Campaigns" meta={`${fmtNumber(rows.length)} SHOWN${campaigns.data?.total > (campaigns.data?.rows || []).length ? ` OF ${fmtNumber(campaigns.data.total)} (NEWEST FIRST)` : ''} · SORTED BY LEADS · LAST ${period.toUpperCase()}`}>
        <PeriodSwitch value={period} onChange={setPeriod} />
        <Link to={newCampaignHref()} className="av2-btn av2-btn--primary" style={{ textDecoration: 'none' }}>
          + New campaign
        </Link>
      </PageHeader>

      {attention.isError && (
        <div className="av2-caption" style={{ color: 'var(--warn)', marginBottom: 8 }}>
          ▲ Attention feed unavailable — zero-commitment badges are hidden (they can’t be trusted right now).
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {statuses.map((s) => (
          <button
            key={s || 'all'}
            type="button"
            className="av2-btn av2-btn--sm"
            aria-pressed={statusFilter === s}
            style={statusFilter === s ? { background: 'var(--ink)', color: 'var(--canvas)', borderColor: 'var(--ink)' } : undefined}
            onClick={() => setStatusFilter(s)}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      <div className="av2-card" style={{ overflow: 'hidden' }}>
        <div className="av2-thead">
          <span className="av2-microcaps" style={{ flex: 1.6 }}>Campaign</span>
          <span className="av2-microcaps" style={{ width: 90, flex: 'none' }}>Type</span>
          <span className="av2-microcaps" style={{ flex: 1.4 }}>Signals</span>
          <span className="av2-microcaps" style={{ width: 90, flex: 'none', textAlign: 'right' }}>Leads · {period}</span>
          <span className="av2-microcaps" style={{ width: 80, flex: 'none', textAlign: 'right' }}>All-time</span>
          <span className="av2-microcaps" style={{ width: 90, flex: 'none', textAlign: 'right' }}>Ends</span>
        </div>

        {campaigns.isLoading && [0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="av2-row" style={{ cursor: 'default' }}><Skeleton height={32} /></div>
        ))}
        {campaigns.isError && <ErrorState error={campaigns.error} onRetry={campaigns.refetch} />}
        {!campaigns.isLoading && !campaigns.isError && rows.length === 0 && (
          <EmptyState title="No campaigns match" hint={statusFilter ? 'Try a different status.' : 'Create your first campaign to start capturing leads.'} />
        )}

        {rows.map((c) => {
          const draw = c.design_config?.luckyDraw;
          const drawDays = draw?.enabled ? daysUntil(draw.closesAt) : null;
          const priced = Number.isInteger(c.leadPriceCents) && c.leadPriceCents > 0;
          return (
            <div
              key={c.id}
              className="av2-row"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/admin/campaigns/${c.id}`)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/admin/campaigns/${c.id}`); } }}
            >
              <span style={{ flex: 1.6, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  <Chip tone={STATUS_TONE[c.status] ?? ''}>{c.status}</Chip>
                </span>
                <span className="av2-caption">{priced ? `${fmtSGD(c.leadPriceCents)}/lead` : 'not priced'} · {fmtNumber(c.qrTagCount || 0)} QR</span>
              </span>
              <span style={{ width: 90, flex: 'none', fontSize: 12, color: 'var(--ink-2)' }}>{TYPE_LABELS[c.type] || c.type}</span>
              <span style={{ flex: 1.4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {attention.isSuccess && zeroCommitIds.has(c.id) && <Chip tone="bad" glyph="▲">0 commitments</Chip>}
                {c.committedRemaining > 0 && <Chip tone="accent">{fmtNumber(c.committedRemaining)} committed · {fmtSGD(c.committedValueCents)}</Chip>}
                {drawDays !== null && drawDays > 0 && <Chip tone="warn">Draw closes {drawDays}d</Chip>}
                {c.design_config?.marketplaceListed === true && <Chip tone="accent">Marketplace</Chip>}
              </span>
              <span className="av2-mono" style={{ width: 90, flex: 'none', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{fmtNumber(c.leadsThisPeriod || 0)}</span>
              <span className="av2-mono" style={{ width: 80, flex: 'none', fontSize: 11, color: 'var(--ink-3)', textAlign: 'right' }}>{fmtNumber(c.leadsTotal ?? c.prospectCount ?? 0)}</span>
              <span className="av2-mono" style={{ width: 90, flex: 'none', fontSize: 10.5, color: 'var(--ink-3)', textAlign: 'right' }}>{c.end_date ? fmtDate(c.end_date) : '—'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
