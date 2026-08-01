/**
 * Switchboard Cohorts (tracker "cohortui") — saved audience definitions for
 * curated pushes. List shows the last-known reachable/total snapshot (counts
 * re-resolve live on open); create/edit runs through CohortBuilder's
 * preview-as-you-type dialog; rows open the detail screen that explains WHY
 * each excluded person is excluded.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchCohorts, fetchCohortFacets, archiveCohort } from '@/api/adminV2';
import { fmtNumber, fmtRelative } from '@/lib/adminV2/format';
import { summarizeDefinition } from '@/lib/adminV2/cohorts';
import { Chip, PageHeader, Skeleton, ErrorState, EmptyState, StateRow } from '@/components/adminv2/primitives';
import CohortBuilder from '@/components/adminv2/CohortBuilder';
import { useAdminV2Mobile } from '@/components/adminv2/mobile/useAdminV2Mobile';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';

export default function AdminV2Cohorts() {
  const cohorts = useQuery({ queryKey: ['adminV2', 'cohorts'], queryFn: fetchCohorts, staleTime: 30_000 });
  const facets = useQuery({ queryKey: ['adminV2', 'cohortFacets'], queryFn: fetchCohortFacets, staleTime: 60_000 });
  const [building, setBuilding] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mobile = useAdminV2Mobile();

  const archive = useMutation({
    mutationFn: (id) => archiveCohort(id),
    onSuccess: () => {
      toast.success('Cohort archived');
      queryClient.invalidateQueries({ queryKey: ['adminV2', 'cohorts'] });
      setConfirmArchive(null);
    },
    onError: (e) => { toast.error(e?.message || 'Archive failed'); setConfirmArchive(null); },
  });

  const rows = cohorts.data?.rows || [];

  // Shared overlays — mounted by both the mobile and desktop branches so the
  // builder/confirm state machines stay single-sourced.
  const overlays = (
    <>
      {building && <CohortBuilder onClose={() => setBuilding(false)} onSaved={(c) => { if (c?.id) navigate(`/admin/cohorts/${c.id}`); }} />}

      <AlertDialog open={!!confirmArchive} onOpenChange={(open) => { if (!open) setConfirmArchive(null); }}>
        <AlertDialogContent className="admin-v2" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)' }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: 'var(--ink)' }}>Archive “{confirmArchive?.name}”?</AlertDialogTitle>
            <AlertDialogDescription style={{ color: 'var(--ink-2)' }}>
              It disappears from this list. Nothing is deleted — past sends keep their history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); archive.mutate(confirmArchive.id); }}
              disabled={archive.isPending}
              style={{ background: 'var(--bad)', color: '#fff' }}
            >
              {archive.isPending ? 'Archiving…' : 'Archive'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  /* ── Mobile (design 1694f8b2): meta row + cohort cards ── */
  if (mobile) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 2px 10px' }}>
          <span className="av2-mono" style={{ flex: 1, minWidth: 0, fontSize: 10, letterSpacing: '.12em', color: 'var(--ink-3)', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {fmtNumber(rows.length)} cohort{rows.length === 1 ? '' : 's'} · consent-gated
          </span>
          <button type="button" onClick={() => setBuilding(true)} style={{ flex: 'none', height: 38, display: 'flex', alignItems: 'center', gap: 5, padding: '0 12px', background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 700 }}>
            + New cohort
          </button>
        </div>

        {cohorts.isLoading && (
          <div style={{ display: 'grid', gap: 8 }}>
            {[0, 1, 2].map((i) => <Skeleton key={i} height={104} style={{ borderRadius: 14 }} />)}
          </div>
        )}
        {cohorts.isError && <div className="av2-card"><ErrorState error={cohorts.error} onRetry={cohorts.refetch} /></div>}
        {!cohorts.isLoading && !cohorts.isError && rows.length === 0 && (
          <div className="av2-card">
            <EmptyState
              title="No cohorts yet"
              hint="A cohort is a saved audience definition — “everyone from the Tokyo draw” — that stays current on its own."
              action={<button type="button" className="av2-btn av2-btn--primary av2-btn--sm" onClick={() => setBuilding(true)}>Build the first one</button>}
            />
          </div>
        )}

        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map((c) => {
            const hasSnap = c.lastReachableCount !== null && c.lastReachableCount !== undefined;
            const totalSnap = c.lastTotalCount ?? 0;
            const excludedSnap = hasSnap ? Math.max(0, totalSnap - c.lastReachableCount) : null;
            const gate = c.definition?.marketingContext?.campaignId ? 'campaign' : 'brand-wide';
            return (
              <div
                key={c.id}
                className="av2-card"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/admin/cohorts/${c.id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) navigate(`/admin/cohorts/${c.id}`); }}
                style={{ padding: '12px 13px', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                  <button
                    type="button"
                    className="av2-btn av2-btn--ghost av2-btn--sm"
                    style={{ flex: 'none', color: 'var(--bad)' }}
                    onClick={(e) => { e.stopPropagation(); setConfirmArchive(c); }}
                  >
                    Archive
                  </button>
                </div>
                <div className="av2-mono" style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {summarizeDefinition(c.definition, facets.data)} · {c.lastPreviewAt ? `snapshot ${fmtRelative(c.lastPreviewAt)}` : 'no snapshot yet'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 10 }}>
                  {[
                    ['match', hasSnap ? fmtNumber(totalSnap) : '—', 'var(--ink)'],
                    ['reachable', hasSnap ? fmtNumber(c.lastReachableCount) : '—', 'var(--ok)'],
                    ['excluded', hasSnap ? fmtNumber(excludedSnap) : '—', excludedSnap ? 'var(--warn)' : 'var(--ink-3)'],
                  ].map(([label, value, color]) => (
                    <span key={label}>
                      <span className="av2-mono" style={{ display: 'block', fontSize: 14, fontWeight: 600, color }}>{value}</span>
                      <span style={{ display: 'block', fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 1 }}>{label}</span>
                    </span>
                  ))}
                  <span style={{ marginLeft: 'auto', flex: 'none' }}><Chip tone="accent">{gate}</Chip></span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="av2-caption" style={{ padding: '14px 4px 0', lineHeight: 1.5 }}>
          Reachable = consented ∧ phone-verified ∧ not unsubscribed ∧ 18+ (binding safeguard) — every send re-checks each person again at send time.
        </div>

        {overlays}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Cohorts"
        meta={`${fmtNumber(rows.length)} SAVED · MEMBERSHIP RESOLVES LIVE · COUNTS BELOW ARE LAST SNAPSHOT`}
      >
        <button type="button" className="av2-btn av2-btn--primary" onClick={() => setBuilding(true)}>+ New cohort</button>
      </PageHeader>

      <div className="av2-card" style={{ overflow: 'hidden' }} role="table" aria-label="Cohorts">
        <div className="av2-thead" role="row">
          <span className="av2-microcaps" role="columnheader" style={{ flex: 1.2 }}>Name</span>
          <span className="av2-microcaps" role="columnheader" style={{ flex: 2 }}>Definition</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 140, flex: 'none', textAlign: 'right' }}>Reachable / total</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 100, flex: 'none', textAlign: 'right' }}>Snapshot</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 130, flex: 'none', textAlign: 'right' }}>Actions</span>
        </div>

        {cohorts.isLoading && [0, 1, 2].map((i) => (
          <div key={i} className="av2-row" role="row" style={{ cursor: 'default' }}><span role="cell" style={{ flex: 1 }}><Skeleton height={30} /></span></div>
        ))}
        {cohorts.isError && <StateRow><ErrorState error={cohorts.error} onRetry={cohorts.refetch} /></StateRow>}
        {!cohorts.isLoading && !cohorts.isError && rows.length === 0 && (
          <StateRow>
            <EmptyState
              title="No cohorts yet"
              hint="A cohort is a saved audience definition — “everyone from the Tokyo draw” — that stays current on its own."
              action={<button type="button" className="av2-btn av2-btn--primary av2-btn--sm" onClick={() => setBuilding(true)}>Build the first one</button>}
            />
          </StateRow>
        )}

        {rows.map((c) => (
          <div
            key={c.id}
            className="av2-row"
            role="row"
            tabIndex={0}
            onClick={() => navigate(`/admin/cohorts/${c.id}`)}
            onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/admin/cohorts/${c.id}`); }}
          >
            <span role="cell" style={{ flex: 1.2, fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
            <span role="cell" className="av2-caption" style={{ flex: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={summarizeDefinition(c.definition, facets.data)}>
              {summarizeDefinition(c.definition, facets.data)}
            </span>
            <span role="cell" className="av2-mono" style={{ width: 140, flex: 'none', fontSize: 12.5, textAlign: 'right' }}>
              {c.lastReachableCount === null || c.lastReachableCount === undefined
                ? '—'
                : <><span style={{ color: 'var(--ok)', fontWeight: 700 }}>{fmtNumber(c.lastReachableCount)}</span><span style={{ color: 'var(--ink-3)' }}> / {fmtNumber(c.lastTotalCount ?? 0)}</span></>}
            </span>
            <span role="cell" className="av2-mono" style={{ width: 100, flex: 'none', fontSize: 10.5, color: 'var(--ink-3)', textAlign: 'right' }}>
              {c.lastPreviewAt ? fmtRelative(c.lastPreviewAt) : '—'}
            </span>
            <span role="cell" style={{ width: 130, flex: 'none', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <Link
                to={`/admin/cohorts/${c.id}`}
                className="av2-btn av2-btn--sm"
                style={{ textDecoration: 'none' }}
                onClick={(e) => e.stopPropagation()}
              >
                Open
              </Link>
              <button
                type="button"
                className="av2-btn av2-btn--sm"
                style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}
                onClick={(e) => { e.stopPropagation(); setConfirmArchive(c); }}
              >
                Archive
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="av2-caption" style={{ marginTop: 10 }}>
        Reachable = consented ∧ phone-verified ∧ not unsubscribed ∧ 18+ (binding safeguard) — every send re-checks each person again at send time.
      </div>

      {overlays}
    </div>
  );
}
