/**
 * Switchboard Campaign detail — one round-trip (GET /campaigns/:id/summary):
 * header + KPI tiles, 30d lead series, open wallet commitments, latest leads,
 * QR tags, and the draw panel when a lucky draw is live. Editing links OUT to
 * the existing designer/workspace — this screen observes, it never forks the
 * editing surface.
 */
import { Link, useParams } from 'react-router-dom';
import { getMarketplaceListedFromDoc } from '@/lib/designConfigV2';
import { useCampaignSummary, useAttention } from '@/hooks/queries/useAdminV2';
import { fmtNumber, fmtSGD, fmtDate, fmtDateTime, fmtRelative, daysUntil } from '@/lib/adminV2/format';
import { STATUS_LABELS, STATUS_CHIP_CLASS, HELD_REASON_LABELS } from '@/lib/adminV2/constants';
import { Card, Chip, PageHeader, Skeleton, ErrorState, EmptyState } from '@/components/adminv2/primitives';
import { SeriesBarChart } from '@/components/adminv2/charts';

const WORKSPACE_ON = import.meta.env.VITE_CAMPAIGN_WORKSPACE_ENABLED === 'true';

function Tile({ label, value, caption, tone }) {
  return (
    <div style={{ flex: 1, padding: 16, borderRight: '1px solid var(--line)' }}>
      <div className="av2-microcaps">{label}</div>
      <div className="av2-mono" style={{ fontSize: 20, fontWeight: 600, marginTop: 4, color: tone || 'var(--ink)' }}>{value}</div>
      {caption && <div className="av2-caption" style={{ marginTop: 2 }}>{caption}</div>}
    </div>
  );
}

export default function AdminV2CampaignDetail() {
  const { id } = useParams();
  const summary = useCampaignSummary(id);
  // Zero-commitment truth comes from /attention (wallet OR package funding —
  // a legacy-package-covered campaign must NOT get a false incident banner).
  // The summary's own commitments list is wallet-only by design.
  const attention = useAttention();

  if (summary.isLoading) {
    return (
      <div>
        <Skeleton height={30} width={340} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16, marginTop: 20 }}>
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

  return (
    <div>
      <PageHeader
        title={c.name}
        meta={`${(c.type || '').replace(/_/g, ' ').toUpperCase()} · ${fmtDate(c.start_date)} → ${c.end_date ? fmtDate(c.end_date) : 'OPEN-ENDED'} · AGES ${c.min_age ?? '—'}–${c.max_age ?? '—'}`}
      >
        <Link to="/AdminCampaigns" className="av2-btn av2-btn--sm" style={{ textDecoration: 'none' }}>← All campaigns</Link>
        <Link to={designHref} className="av2-btn av2-btn--sm" style={{ textDecoration: 'none' }}>Open designer</Link>
        <Link to={editHref} className="av2-btn av2-btn--primary av2-btn--sm" style={{ textDecoration: 'none' }}>Edit details</Link>
      </PageHeader>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        <Chip tone={c.status === 'active' ? 'ok' : c.status === 'paused' ? 'warn' : ''}>{c.status}</Chip>
        {getMarketplaceListedFromDoc(c.design_config) === true && <Chip tone="accent">Marketplace{c.slug ? ` · /${c.slug}` : ''}</Chip>}
        {draw?.enabled && <Chip tone="warn">Lucky draw{drawDays !== null && drawDays > 0 ? ` · closes ${drawDays}d` : ' · closed'}</Chip>}
        {zeroCommit && <Chip tone="bad" glyph="▲">0 open commitments — new leads will quarantine</Chip>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
        {/* KPI tiles */}
        <Card span={12}>
          <div style={{ display: 'flex' }}>
            <Tile label="Leads · 30d" value={fmtNumber(summary.data.campaign ? (series?.total ?? 0) : 0)} caption={`${fmtNumber(series?.today ?? 0)} today`} />
            <Tile
              label="Committed demand"
              value={priced ? fmtSGD(committedValueCents) : '—'}
              caption={priced ? `${fmtNumber(committedRemaining)} leads pre-sold` : 'campaign not priced'}
              tone={zeroCommit ? 'var(--bad)' : undefined}
            />
            <Tile label="Lead price" value={priced ? fmtSGD(c.leadPriceCents) : '—'} caption={priced ? 'per lead, external agents' : 'closed to commitments'} />
            <Tile
              label={draw?.enabled ? 'Draw closes' : 'Ends'}
              value={draw?.enabled ? (drawDays !== null && drawDays > 0 ? `${drawDays}d` : 'closed') : (c.end_date ? fmtDate(c.end_date) : '—')}
              caption={draw?.enabled ? `${draw.winners || 1} winner${(draw.winners || 1) > 1 ? 's' : ''} · ×${draw.multiplier || 1} boost` : 'campaign end date'}
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
              <div key={p.id} className="av2-qrow" style={{ cursor: 'default' }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{p.firstName} {p.lastName}</span>
                {p.quarantinedAt
                  ? <Chip tone="hold" glyph="◆">{HELD_REASON_LABELS[p.quarantineReason] || 'Held'}</Chip>
                  : <Chip tone={STATUS_CHIP_CLASS[p.leadStatus]?.replace('av2-chip--', '') || ''}>{STATUS_LABELS[p.leadStatus] || p.leadStatus}</Chip>}
                <span className="av2-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', width: 70, textAlign: 'right' }} title={fmtDateTime(p.createdAt)}>{fmtRelative(p.createdAt)}</span>
              </div>
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
      </div>
    </div>
  );
}
