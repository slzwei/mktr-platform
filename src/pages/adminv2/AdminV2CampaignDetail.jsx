/**
 * Switchboard Campaign detail — one round-trip (GET /campaigns/:id/summary):
 * header + KPI tiles, 30d lead series, open wallet commitments, latest leads,
 * QR tags, and the draw panel when a lucky draw is live. Editing links OUT to
 * the existing designer/workspace — this screen observes, it never forks the
 * editing surface.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getMarketplaceListedFromDoc } from '@/lib/designConfigV2';
import { toast } from 'sonner';
import { queryClient } from '@/lib/queryClient';
import { useCampaignSummary, useAttention } from '@/hooks/queries/useAdminV2';
import { useDuplicateCampaign } from '@/hooks/queries/useCampaignsQuery';
import { fmtNumber, fmtSGD, fmtDate, fmtDateTime, fmtRelative, daysUntil } from '@/lib/adminV2/format';
import { STATUS_LABELS, STATUS_CHIP_CLASS, heldLabel } from '@/lib/adminV2/constants';
import { Card, Chip, PageHeader, Skeleton, ErrorState, EmptyState } from '@/components/adminv2/primitives';
import { SeriesBarChart } from '@/components/adminv2/charts';
import CampaignScoringCard from '@/components/adminv2/CampaignScoringCard';
import { useAdminV2Mobile } from '@/components/adminv2/mobile/useAdminV2Mobile';
import MobileSheet, { SheetHead, SheetMenuItem } from '@/components/adminv2/mobile/MobileSheet';

const WORKSPACE_ON = import.meta.env.VITE_CAMPAIGN_WORKSPACE_ENABLED === 'true';

function Tile({ label, value, caption, tone, style }) {
  return (
    <div style={{ flex: 1, padding: 16, borderRight: '1px solid var(--line)', boxSizing: 'border-box', ...style }}>
      <div className="av2-microcaps">{label}</div>
      <div className="av2-mono" style={{ fontSize: 20, fontWeight: 600, marginTop: 4, color: tone || 'var(--ink)' }}>{value}</div>
      {caption && <div className="av2-caption" style={{ marginTop: 2 }}>{caption}</div>}
    </div>
  );
}

export default function AdminV2CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const mobile = useAdminV2Mobile();
  const [actionsOpen, setActionsOpen] = useState(false);
  const summary = useCampaignSummary(id);
  // Zero-commitment truth comes from /attention (wallet OR package funding —
  // a legacy-package-covered campaign must NOT get a false incident banner).
  // The summary's own commitments list is wallet-only by design.
  const attention = useAttention();
  const duplicate = useDuplicateCampaign();

  const handleDuplicate = async () => {
    try {
      const res = await duplicate.mutateAsync({ id });
      const copy = res?.campaign;
      toast.success(`Duplicated as “${copy?.name || 'Copy'}” — it starts as a draft`);
      // The hook invalidates ['campaigns']; the v2 board reads ['adminV2'].
      queryClient.invalidateQueries({ queryKey: ['adminV2'] });
      if (copy?.id) navigate(`/admin/campaigns/${copy.id}`);
    } catch (err) {
      toast.error(`Duplicate failed: ${err?.response?.data?.message || err?.message || 'error'}`);
    }
  };

  if (summary.isLoading) {
    return (
      <div>
        <Skeleton height={30} width={340} style={{ maxWidth: '100%' }} />
        <div className="av2-grid12" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16, marginTop: 20 }}>
          {[5, 7, 6, 6].map((span, i) => <div key={i} style={{ gridColumn: `span ${span}` }}><Skeleton height={180} /></div>)}
        </div>
      </div>
    );
  }
  if (summary.isError) return <ErrorState error={summary.error} onRetry={summary.refetch} />;

  const { campaign: c, series, commitments, committedRemaining, committedValueCents, recent, qrTags } = summary.data;
  const draw = c.design_config?.luckyDraw;
  const drawDays = draw?.enabled ? daysUntil(draw.closesAt) : null;
  const priced = Number.isInteger(c.leadPriceCents) && c.leadPriceCents > 0;
  const zeroCommit = attention.isSuccess
    ? (attention.data?.zeroCommitCampaigns || []).some((z) => z.id === c.id)
    : false; // attention unavailable → no banner rather than a possibly-false one
  const editHref = WORKSPACE_ON ? `/admin/campaigns/${c.id}/workspace?tab=details` : `/admin/campaigns/${c.id}/edit`;
  const designHref = `/admin/campaigns/${c.id}/workspace?tab=design`;

  const metaLine = `${(c.type || '').replace(/_/g, ' ').toUpperCase()} · ${fmtDate(c.start_date)} → ${c.end_date ? fmtDate(c.end_date) : 'OPEN-ENDED'} · AGES ${c.min_age ?? '—'}–${c.max_age ?? '—'}`;

  return (
    <div>
      {mobile ? (
        <div style={{ padding: '2px 0 12px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 19, fontWeight: 800, letterSpacing: '-0.015em', lineHeight: 1.2, color: 'var(--ink)' }}>{c.name}</span>
            <span className="av2-mono" style={{ display: 'block', fontSize: 10, letterSpacing: '.09em', color: 'var(--ink-3)', marginTop: 4, textTransform: 'uppercase' }}>{metaLine}</span>
          </span>
          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            aria-label="Campaign actions"
            style={{ width: 40, height: 40, flex: 'none', background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 10, cursor: 'pointer', color: 'var(--ink)', fontSize: 16, fontWeight: 700 }}
          >
            ⋯
          </button>
        </div>
      ) : (
      <PageHeader
        title={c.name}
        meta={metaLine}
      >
        <Link to="/AdminCampaigns" className="av2-btn av2-btn--sm" style={{ textDecoration: 'none' }}>← All campaigns</Link>
        <button type="button" className="av2-btn av2-btn--sm" disabled={duplicate.isPending} onClick={handleDuplicate}>
          {duplicate.isPending ? 'Duplicating…' : 'Duplicate'}
        </button>
        <Link to={designHref} className="av2-btn av2-btn--sm" style={{ textDecoration: 'none' }}>Open designer</Link>
        <Link to={editHref} className="av2-btn av2-btn--primary av2-btn--sm" style={{ textDecoration: 'none' }}>Edit details</Link>
      </PageHeader>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        <Chip tone={c.status === 'active' ? 'ok' : c.status === 'paused' ? 'warn' : ''}>{c.status}</Chip>
        {getMarketplaceListedFromDoc(c.design_config) === true && <Chip tone="accent">Marketplace{c.slug ? ` · /${c.slug}` : ''}</Chip>}
        {draw?.enabled && <Chip tone="warn">Lucky draw{drawDays !== null && drawDays > 0 ? ` · closes ${drawDays}d` : ' · closed'}</Chip>}
        {zeroCommit && <Chip tone="bad" glyph="▲">0 open commitments — new leads will quarantine</Chip>}
      </div>

      <div className="av2-grid12" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: mobile ? 10 : 16 }}>
        {/* KPI tiles — one row on desktop, a 2×2 grid on phones */}
        <Card span={12}>
          <div style={{ display: 'flex', flexWrap: mobile ? 'wrap' : 'nowrap' }}>
            <Tile label="Leads · 30d" value={fmtNumber(summary.data.campaign ? (series?.total ?? 0) : 0)} caption={`${fmtNumber(series?.today ?? 0)} today`} style={mobile ? { flex: '1 1 50%', borderBottom: '1px solid var(--line)' } : undefined} />
            <Tile
              label="Committed demand"
              value={priced ? fmtSGD(committedValueCents) : '—'}
              caption={priced ? `${fmtNumber(committedRemaining)} leads pre-sold` : 'campaign not priced'}
              tone={zeroCommit ? 'var(--bad)' : undefined}
              style={mobile ? { flex: '1 1 50%', borderRight: 'none', borderBottom: '1px solid var(--line)' } : undefined}
            />
            <Tile label="Lead price" value={priced ? fmtSGD(c.leadPriceCents) : '—'} caption={priced ? 'per lead, external agents' : 'closed to commitments'} style={mobile ? { flex: '1 1 50%' } : undefined} />
            <Tile
              label={draw?.enabled ? 'Draw closes' : 'Ends'}
              value={draw?.enabled ? (drawDays !== null && drawDays > 0 ? `${drawDays}d` : 'closed') : (c.end_date ? fmtDate(c.end_date) : '—')}
              caption={draw?.enabled ? `${draw.winners || 1} winner${(draw.winners || 1) > 1 ? 's' : ''} · ×${draw.multiplier || 1} boost` : 'campaign end date'}
              style={mobile ? { flex: '1 1 50%', borderRight: 'none' } : undefined}
            />
          </div>
        </Card>

        {/* Lead series */}
        <Card span={7} title="Leads over time" meta="daily · SGT · last 30d">
          <div style={{ padding: 16 }}>
            <SeriesBarChart days={series?.days || []} />
          </div>
        </Card>

        {/* Open commitments */}
        <Card span={5} title="Open commitments" meta={commitments.length ? `${commitments.length} agent${commitments.length === 1 ? '' : 's'}` : undefined}>
          {commitments.length === 0 ? (
            <EmptyState
              icon={zeroCommit ? '▲' : '○'}
              title={priced ? 'No open commitments' : 'Not priced'}
              hint={priced
                ? (zeroCommit ? 'New leads will quarantine with no funded agent.' : 'No wallet commitments yet (legacy package coverage, if any, is not shown here).')
                : 'Set a lead price in Edit details to open this campaign to commitments.'}
            />
          ) : (
            commitments.map((cm) => (
              <div key={cm.assignmentId} className="av2-qrow" style={{ cursor: 'default' }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{cm.agent || '—'}</span>
                <span className="av2-mono" style={{ fontSize: 12 }}>{fmtNumber(cm.remaining)} leads</span>
                <span className="av2-mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{fmtSGD(cm.valueCents)}</span>
              </div>
            ))
          )}
        </Card>

        {/* Recent leads */}
        <Card span={7} title="Latest leads" action={<Link to={`/AdminProspects?campaign=${c.id}`} style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-text)', textDecoration: 'none' }}>All for this campaign →</Link>}>
          {recent.length === 0 ? (
            <EmptyState title="No leads yet" hint="Submissions land here as they arrive." />
          ) : (
            recent.map((p) => (
              <Link key={p.id} to={`/admin/leads/${p.id}`} className="av2-qrow" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{p.firstName} {p.lastName}</span>
                {p.quarantinedAt
                  ? <Chip tone="hold" glyph="◆">{heldLabel(p).short}</Chip>
                  : <Chip tone={STATUS_CHIP_CLASS[p.leadStatus]?.replace('av2-chip--', '') || ''}>{STATUS_LABELS[p.leadStatus] || p.leadStatus}</Chip>}
                <span className="av2-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', width: 70, textAlign: 'right' }} title={fmtDateTime(p.createdAt)}>{fmtRelative(p.createdAt)}</span>
              </Link>
            ))
          )}
        </Card>

        {/* QR tags */}
        <Card span={5} title="QR tags" meta={qrTags.length ? `${qrTags.length}` : undefined} action={<Link to="/AdminQRCodes" style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-text)', textDecoration: 'none' }}>Manage →</Link>}>
          {qrTags.length === 0 ? (
            <EmptyState title="No QR tags" hint="Generate codes from the QR Codes screen." />
          ) : (
            qrTags.map((t) => (
              <div key={t.id} className="av2-qrow" style={{ cursor: 'default' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                  <span className="av2-caption">{t.active === false ? 'inactive' : 'active'}{t.lastScanned ? ` · last scan ${fmtRelative(t.lastScanned)}` : ''}</span>
                </span>
                <span className="av2-mono" style={{ fontSize: 12, fontWeight: 600 }}>{fmtNumber(t.scanCount || 0)}</span>
                <span className="av2-caption">scans</span>
              </div>
            ))
          )}
        </Card>

        {/* Which sheet grades this campaign's leads, and the door to tune it
            (campaign-scoring-editor §3.2). Renders its own unavailable state
            while the backend flag is off. */}
        <CampaignScoringCard campaignId={c.id} />
      </div>

      {/* Mobile ⋯ actions sheet */}
      {mobile && (
        <MobileSheet open={actionsOpen} onClose={() => setActionsOpen(false)} label="Campaign actions">
          <SheetHead title={c.name} kicker={c.status} />
          <SheetMenuItem
            label="Edit details"
            sub="Dates, pricing, ages — opens the campaign workspace"
            onClick={() => { setActionsOpen(false); navigate(editHref); }}
          />
          <SheetMenuItem
            label="Open designer"
            sub="Page design lives in Studio — best on desktop"
            onClick={() => { setActionsOpen(false); navigate(designHref); }}
          />
          <SheetMenuItem
            label={duplicate.isPending ? 'Duplicating…' : 'Duplicate'}
            sub="New draft with the same design & scoring"
            onClick={() => { if (!duplicate.isPending) { setActionsOpen(false); handleDuplicate(); } }}
          />
          <SheetMenuItem
            label="All campaigns"
            sub="Back to the campaign board"
            onClick={() => { setActionsOpen(false); navigate('/AdminCampaigns'); }}
          />
        </MobileSheet>
      )}
    </div>
  );
}
