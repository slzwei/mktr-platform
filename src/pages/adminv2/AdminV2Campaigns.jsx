/**
 * Switchboard Campaigns — the operator campaign board. Period aggregates,
 * committed-demand + draw + marketplace chips, authoritative zero-commitment
 * badges (from /attention), and rows that open the v2 detail screen. Creation
 * and design stay on the existing flows (workspace / designer) — this screen
 * observes and navigates, it does not fork the editing surface.
 */
import { useEffect, useMemo, useState } from 'react';
import { getMarketplaceListedFromDoc } from '@/lib/designConfigV2';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCampaignLeaderboard, useAttention } from '@/hooks/queries/useAdminV2';
import { fmtNumber, fmtSGD, fmtDate, daysUntil } from '@/lib/adminV2/format';
import { Chip, PageHeader, PeriodSwitch, Skeleton, ErrorState, EmptyState } from '@/components/adminv2/primitives';
import CampaignTypeSelectionDialog from '@/components/campaigns/CampaignTypeSelectionDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { toast } from 'sonner';
import { queryClient } from '@/lib/queryClient';
import * as campaignSvc from '@/services/campaignService';

/**
 * Bulk row actions (select → act). Eligibility mirrors the server rules:
 * launch-state flips only between active/paused (a draft is LAUNCHED from its
 * workspace, never from a bulk bar), archive accepts any non-archived status,
 * and permanent delete is archived-only (the server 400s otherwise and 409s
 * on pending commissions — per-row failures surface in the summary toast).
 */
const BULK_ACTIONS = [
  { key: 'pause', label: 'Pause', eligible: (c) => c.status === 'active', run: (id) => campaignSvc.setCampaignLaunchState(id, { state: 'paused' }) },
  { key: 'activate', label: 'Resume', eligible: (c) => c.status === 'paused', run: (id) => campaignSvc.setCampaignLaunchState(id, { state: 'active' }) },
  { key: 'archive', label: 'Archive', eligible: (c) => c.status !== 'archived', run: (id) => campaignSvc.archiveCampaign(id) },
  { key: 'restore', label: 'Restore', eligible: (c) => c.status === 'archived', run: (id) => campaignSvc.restoreCampaign(id) },
  { key: 'delete', label: 'Delete', destructive: true, eligible: (c) => c.status === 'archived', run: (id) => campaignSvc.permanentDeleteCampaign(id) },
];

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
  // "+ New campaign" opens the type chooser first — the v2 rebuild had linked
  // straight to the workspace, silently defaulting every campaign to
  // lead_generation (the workspace honors ?type=; classic always sent it).
  const [typeSelectOpen, setTypeSelectOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [confirmAction, setConfirmAction] = useState(null); // BULK_ACTIONS entry | null
  const [bulkBusy, setBulkBusy] = useState(false);
  const handleCreateCampaign = (type) => {
    setTypeSelectOpen(false);
    navigate(`${newCampaignHref()}?type=${type}`);
  };
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

  // Selection follows the visible list — switching filter/period deselects
  // anything no longer on screen so "N selected" never counts hidden rows.
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(rows.map((c) => c.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allVisibleSelected = rows.length > 0 && rows.every((c) => selected.has(c.id));
  const toggleAll = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(rows.map((c) => c.id)));
  };

  const selectedRows = rows.filter((c) => selected.has(c.id));
  const eligibleFor = (action) => selectedRows.filter(action.eligible);

  const runBulk = async (action) => {
    const targets = eligibleFor(action);
    if (!targets.length) return;
    setBulkBusy(true);
    const results = await Promise.allSettled(targets.map((c) => action.run(c.id)));
    const failed = results
      .map((r, i) => (r.status === 'rejected' ? { name: targets[i].name, reason: r.reason } : null))
      .filter(Boolean);
    const okCount = targets.length - failed.length;
    if (okCount) toast.success(`${action.label}: ${okCount} campaign${okCount === 1 ? '' : 's'} done`);
    for (const f of failed) {
      toast.error(`${action.label} failed — ${f.name}: ${f.reason?.response?.data?.message || f.reason?.message || 'error'}`);
    }
    queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    queryClient.invalidateQueries({ queryKey: ['adminV2'] });
    setBulkBusy(false);
    setConfirmAction(null);
    setSelected(new Set());
  };

  return (
    <div>
      <PageHeader title="Campaigns" meta={`${fmtNumber(rows.length)} SHOWN${campaigns.data?.total > (campaigns.data?.rows || []).length ? ` OF ${fmtNumber(campaigns.data.total)} (NEWEST FIRST)` : ''} · SORTED BY LEADS · LAST ${period.toUpperCase()}`}>
        <PeriodSwitch value={period} onChange={setPeriod} />
        <button
          type="button"
          className="av2-btn av2-btn--primary"
          onClick={() => setTypeSelectOpen(true)}
        >
          + New campaign
        </button>
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

      {selected.size > 0 && (
        <div data-testid="bulk-bar" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)' }}>
          <span className="av2-microcaps">{selected.size} selected</span>
          {BULK_ACTIONS.map((a) => {
            const n = eligibleFor(a).length;
            return (
              <button
                key={a.key}
                type="button"
                className="av2-btn av2-btn--sm"
                disabled={bulkBusy || n === 0}
                style={a.destructive && n > 0 ? { color: 'var(--bad)', borderColor: 'var(--bad)' } : undefined}
                onClick={() => setConfirmAction(a)}
              >
                {a.label}{n > 0 && n !== selected.size ? ` (${n})` : ''}
              </button>
            );
          })}
          <button type="button" className="av2-btn av2-btn--sm" disabled={bulkBusy} onClick={() => setSelected(new Set())} style={{ marginLeft: 'auto' }}>
            Clear
          </button>
        </div>
      )}

      <div className="av2-card" style={{ overflow: 'hidden' }}>
        <div className="av2-thead">
          <span style={{ width: 26, flex: 'none', display: 'flex', alignItems: 'center' }}>
            <input
              type="checkbox"
              aria-label="Select all visible campaigns"
              checked={allVisibleSelected}
              onChange={toggleAll}
              style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
          </span>
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
              <span style={{ width: 26, flex: 'none', display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  aria-label={`Select ${c.name}`}
                  checked={selected.has(c.id)}
                  onChange={() => toggleSelected(c.id)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
              </span>
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
                {getMarketplaceListedFromDoc(c.design_config) === true && <Chip tone="accent">Marketplace</Chip>}
              </span>
              <span className="av2-mono" style={{ width: 90, flex: 'none', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{fmtNumber(c.leadsThisPeriod || 0)}</span>
              <span className="av2-mono" style={{ width: 80, flex: 'none', fontSize: 11, color: 'var(--ink-3)', textAlign: 'right' }}>{fmtNumber(c.leadsTotal ?? c.prospectCount ?? 0)}</span>
              <span className="av2-mono" style={{ width: 90, flex: 'none', fontSize: 10.5, color: 'var(--ink-3)', textAlign: 'right' }}>{c.end_date ? fmtDate(c.end_date) : '—'}</span>
            </div>
          );
        })}
      </div>
      <CampaignTypeSelectionDialog
        open={typeSelectOpen}
        onOpenChange={setTypeSelectOpen}
        onSelect={handleCreateCampaign}
      />
      <ConfirmDialog
        open={confirmAction != null}
        onOpenChange={(open) => { if (!open && !bulkBusy) setConfirmAction(null); }}
        title={confirmAction ? `${confirmAction.label} ${eligibleFor(confirmAction).length} campaign${eligibleFor(confirmAction).length === 1 ? '' : 's'}?` : ''}
        description={confirmAction ? [
          confirmAction.key === 'delete'
            ? 'Permanent deletion cannot be undone. Campaigns with pending or approved commissions are refused by the server.'
            : confirmAction.key === 'archive'
              ? 'Archived campaigns stop accepting signups and move to the archived filter; restore them anytime.'
              : confirmAction.key === 'activate'
                ? 'Resumes paused campaigns. Drafts are never launched from here — use the campaign workspace.'
                : 'Paused campaigns stop accepting public signups until resumed.',
          eligibleFor(confirmAction).length !== selected.size
            ? ` ${selected.size - eligibleFor(confirmAction).length} of the selected campaigns are not eligible and will be skipped.`
            : '',
        ].join('') : ''}
        onConfirm={() => confirmAction && runBulk(confirmAction)}
        confirmText={confirmAction?.destructive ? 'Delete' : 'Continue'}
        pending={bulkBusy}
        pendingText='Working…'
        destructive={confirmAction?.destructive === true}
      />
    </div>
  );
}
