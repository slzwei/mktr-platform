/**
 * Switchboard Cohort detail (tracker "cohortui") — the WHY screen. Opens
 * with a fresh server-side resolution (?refresh=1 persists the snapshot),
 * shows the reachable split, a per-reason exclusion breakdown with plain
 * explanations, and the paged member list where every excluded person
 * carries their actual reasons. A channel switch re-asks the same question
 * per channel (email needs an address, WhatsApp needs a phone…).
 */
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchCohort, fetchCohortMembers, fetchCohortFacets, archiveCohort } from '@/api/adminV2';
import { fmtNumber, fmtRelative, fmtDateTime } from '@/lib/adminV2/format';
import { summarizeDefinition, REASON_ORDER, REASON_META, reasonLabel, CHANNEL_OPTIONS } from '@/lib/adminV2/cohorts';
import { Card, Chip, PageHeader, Skeleton, ErrorState, EmptyState, StateRow } from '@/components/adminv2/primitives';
import CohortBuilder from '@/components/adminv2/CohortBuilder';
import { useAdminV2Mobile } from '@/components/adminv2/mobile/useAdminV2Mobile';
import MobileSheet, { SheetHead, SheetMenuItem } from '@/components/adminv2/mobile/MobileSheet';

const PAGE_SIZE = 50;

function Tile({ label, value, caption, tone, style }) {
  return (
    <div style={{ flex: 1, padding: 16, borderRight: '1px solid var(--line)', boxSizing: 'border-box', ...style }}>
      <div className="av2-microcaps">{label}</div>
      <div className="av2-mono" style={{ fontSize: 20, fontWeight: 600, marginTop: 4, color: tone || 'var(--ink)' }}>{value}</div>
      {caption && <div className="av2-caption" style={{ marginTop: 2 }}>{caption}</div>}
    </div>
  );
}

export default function AdminV2CohortDetail() {
  const { id } = useParams();
  const [channel, setChannel] = useState('all');
  const [status, setStatus] = useState('excluded'); // the WHY view is the point — land on it
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const mobile = useAdminV2Mobile();

  // refresh=1: recompute + persist the snapshot every time the screen opens.
  const cohort = useQuery({
    queryKey: ['adminV2', 'cohort', id],
    queryFn: () => fetchCohort(id, { refresh: true }),
  });
  const facets = useQuery({ queryKey: ['adminV2', 'cohortFacets'], queryFn: fetchCohortFacets, staleTime: 60_000 });
  const members = useQuery({
    queryKey: ['adminV2', 'cohortMembers', id, status, channel, page],
    queryFn: () => fetchCohortMembers(id, { status, channel, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    enabled: cohort.isSuccess,
    placeholderData: (prev) => prev,
  });

  const archive = useMutation({
    mutationFn: () => archiveCohort(id),
    onSuccess: () => {
      toast.success('Cohort archived');
      queryClient.invalidateQueries({ queryKey: ['adminV2', 'cohorts'] });
      navigate('/AdminCohorts');
    },
    onError: (e) => toast.error(e?.message || 'Archive failed'),
  });

  const preview = cohort.data?.preview;
  const byReason = preview?.byReason || {};
  const excluded = preview ? preview.excluded : null;
  const reasonsPresent = useMemo(
    () => REASON_ORDER.filter((r) => (byReason[r] ?? 0) > 0),
    [byReason],
  );

  if (cohort.isLoading) {
    return (
      <div>
        <Skeleton height={30} width={340} style={{ maxWidth: '100%' }} />
        <div className="av2-grid12" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16, marginTop: 20 }}>
          {[12, 5, 7].map((span, i) => <div key={i} style={{ gridColumn: `span ${span}` }}><Skeleton height={140} /></div>)}
        </div>
      </div>
    );
  }
  if (cohort.isError) return <ErrorState error={cohort.error} onRetry={cohort.refetch} />;

  const c = cohort.data;
  const metaLine = `${summarizeDefinition(c.definition, facets.data).toUpperCase()} · RESOLVED ${c.lastPreviewAt ? fmtRelative(c.lastPreviewAt) : 'NOW'}`;

  return (
    <div>
      {mobile ? (
        <div style={{ padding: '2px 0 12px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 18, fontWeight: 800, letterSpacing: '-0.015em', lineHeight: 1.25, color: 'var(--ink)' }}>{c.name}</span>
            <span className="av2-mono" style={{ display: 'block', fontSize: 10, letterSpacing: '.09em', color: 'var(--ink-3)', marginTop: 4, textTransform: 'uppercase' }}>{metaLine}</span>
          </span>
          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            aria-label="Cohort actions"
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
        <Link to="/AdminCohorts" className="av2-btn av2-btn--sm" style={{ textDecoration: 'none' }}>← All cohorts</Link>
        <Link to={`/AdminBroadcasts?cohort=${id}`} className="av2-btn av2-btn--sm av2-btn--primary" style={{ textDecoration: 'none' }}>Push email</Link>
        <button type="button" className="av2-btn av2-btn--sm" onClick={() => setEditing(true)}>Edit definition</button>
        <button
          type="button"
          className="av2-btn av2-btn--sm"
          style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}
          disabled={archive.isPending}
          onClick={() => archive.mutate()}
        >
          {archive.isPending ? 'Archiving…' : 'Archive'}
        </button>
      </PageHeader>
      )}

      {c.description && <div className="av2-caption" style={{ marginTop: mobile ? 0 : -8, marginBottom: 14 }}>{c.description}</div>}

      <div className="av2-grid12" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: mobile ? 10 : 16 }}>
        <Card span={12}>
          {/* KPI tiles — one row on desktop, a 2×2 grid on phones */}
          <div style={{ display: 'flex', flexWrap: mobile ? 'wrap' : 'nowrap' }}>
            <Tile label="Match the filters" value={preview ? fmtNumber(preview.total) : '—'} caption="people in the group" style={mobile ? { flex: '1 1 50%', borderBottom: '1px solid var(--line)' } : undefined} />
            <Tile label="Reachable" value={preview ? fmtNumber(preview.reachable) : '—'} tone="var(--ok)" caption="consented · verified · not unsubscribed · 18+" style={mobile ? { flex: '1 1 50%', borderRight: 'none', borderBottom: '1px solid var(--line)' } : undefined} />
            <Tile label="Excluded" value={excluded !== null ? fmtNumber(excluded) : '—'} tone={excluded ? 'var(--warn)' : undefined} caption="see why below" style={mobile ? { flex: '1 1 50%' } : undefined} />
            <Tile
              label="Gate"
              value={preview?.gate ? (preview.gate.campaignId ? 'campaign' : 'brand-wide') : '—'}
              caption={preview?.gate ? `ages ${preview.gate.minAge}${preview.gate.maxAge ? `–${preview.gate.maxAge}` : '+'} · channel ${preview.gate.channel}` : undefined}
              style={mobile ? { flex: '1 1 50%', borderRight: 'none' } : undefined}
            />
          </div>
        </Card>

        <Card span={5} title="Why people are excluded" meta={excluded ? `${fmtNumber(excluded)} people` : undefined}>
          {!preview ? <div style={{ padding: 16 }}><Skeleton height={80} /></div> : reasonsPresent.length === 0 ? (
            <EmptyState icon="✓" title="Nobody is excluded" hint="Everyone matching the filters can be messaged." />
          ) : (
            <div style={{ padding: '6px 0' }}>
              {reasonsPresent.map((r) => (
                <div key={r} className="av2-qrow" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                  <span style={{ width: 130, flex: 'none', paddingTop: 1 }}>
                    <Chip tone={REASON_META[r].tone}>{REASON_META[r].label}</Chip>
                  </span>
                  <span className="av2-caption" style={{ flex: 1 }}>{REASON_META[r].hint}</span>
                  <span className="av2-mono" style={{ fontSize: 13, fontWeight: 700 }}>{fmtNumber(byReason[r])}</span>
                </div>
              ))}
              <div className="av2-caption" style={{ padding: '8px 14px 10px' }}>
                A person can be excluded for several reasons at once — counts overlap.
              </div>
            </div>
          )}
        </Card>

        <Card
          span={7}
          title="Members"
          meta={members.data ? `${fmtNumber(members.data.total)} ${status}` : undefined}
          action={(
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: mobile ? 'wrap' : undefined, justifyContent: mobile ? 'flex-end' : undefined, minWidth: mobile ? 0 : undefined }}>
              <div className="av2-seg" role="group" aria-label="Member status">
                {['reachable', 'excluded', 'all'].map((s) => (
                  <button key={s} type="button" aria-pressed={status === s} onClick={() => { setStatus(s); setPage(0); }}>
                    {s}
                  </button>
                ))}
              </div>
              <select
                className="av2-input"
                value={channel}
                onChange={(e) => { setChannel(e.target.value); setPage(0); }}
                aria-label="Channel"
                style={{ width: 150, padding: '4px 8px', fontSize: 12 }}
              >
                {CHANNEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </span>
          )}
        >
          <div role="table" aria-label="Cohort members">
            <div className="av2-thead" role="row" style={mobile ? { minWidth: 0 } : undefined}>
              <span className="av2-microcaps" role="columnheader" style={{ flex: 1.2, minWidth: 0 }}>Person</span>
              <span className="av2-microcaps" role="columnheader" style={{ width: mobile ? 92 : 120, flex: 'none' }}>Phone</span>
              <span className="av2-microcaps" role="columnheader" style={{ flex: 1.4, minWidth: 0 }}>{status === 'reachable' ? 'Email' : 'Why excluded'}</span>
              <span className="av2-microcaps" role="columnheader" style={{ width: mobile ? 56 : 80, flex: 'none', textAlign: 'right' }}>Seen</span>
            </div>

            {members.isLoading && <StateRow><div style={{ padding: 12 }}><Skeleton height={60} /></div></StateRow>}
            {members.isError && <StateRow><ErrorState error={members.error} onRetry={members.refetch} /></StateRow>}
            {members.isSuccess && members.data.members.length === 0 && (
              <StateRow><EmptyState title={`No ${status} members`} hint={status === 'excluded' ? 'Everyone here can be messaged.' : 'Loosen the filters or check the exclusion panel.'} /></StateRow>
            )}

            {(members.data?.members || []).map((m) => (
              <div key={m.consumerId} className="av2-row" role="row" style={{ cursor: 'default', minWidth: mobile ? 0 : undefined }}>
                <span role="cell" style={{ flex: 1.2, minWidth: 0, fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {/* Person cell links into the Lead Profile PERSON view when a
                      signup anchor exists — a Link inside the cell keeps the
                      table's row/cell roles intact (admin-people-directory
                      §3.6). state.from brings the operator back here. */}
                  {m.latestProspectId ? (
                    <Link
                      to={`/admin/leads/${m.latestProspectId}?view=profile`}
                      state={{ from: `${location.pathname}${location.search}` }}
                      title="Open person profile"
                      style={{ color: 'var(--accent-text)', textDecoration: 'none' }}
                    >
                      {(m.firstName || m.lastName) ? `${m.firstName || ''} ${m.lastName || ''}`.trim() : '—'}
                    </Link>
                  ) : ((m.firstName || m.lastName) ? `${m.firstName || ''} ${m.lastName || ''}`.trim() : '—')}
                  {m.reachable && <Chip tone="ok">✓</Chip>}
                </span>
                <span role="cell" className="av2-mono" style={{ width: mobile ? 92 : 120, flex: 'none', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.phone || '—'}</span>
                <span role="cell" style={{ flex: 1.4, minWidth: 0, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {m.reachable
                    ? <span className="av2-mono" style={{ fontSize: 11, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email || '—'}</span>
                    : (m.reasons || []).map((r) => <Chip key={r} tone={REASON_META[r]?.tone || ''}>{reasonLabel(r)}</Chip>)}
                </span>
                <span role="cell" className="av2-mono" style={{ width: mobile ? 56 : 80, flex: 'none', fontSize: 10.5, color: 'var(--ink-3)', textAlign: 'right' }} title={m.lastSeenAt ? fmtDateTime(m.lastSeenAt) : ''}>
                  {m.lastSeenAt ? fmtRelative(m.lastSeenAt) : '—'}
                </span>
              </div>
            ))}
          </div>

          {members.isSuccess && members.data.total > PAGE_SIZE && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', padding: '10px 14px' }}>
              <span className="av2-caption">
                {fmtNumber(page * PAGE_SIZE + 1)}–{fmtNumber(Math.min((page + 1) * PAGE_SIZE, members.data.total))} of {fmtNumber(members.data.total)}
              </span>
              <button type="button" className="av2-btn av2-btn--sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</button>
              <button type="button" className="av2-btn av2-btn--sm" disabled={(page + 1) * PAGE_SIZE >= members.data.total} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          )}
        </Card>
      </div>

      {editing && (
        <CohortBuilder
          cohort={c}
          onClose={() => setEditing(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['adminV2', 'cohort', id] })}
        />
      )}

      {/* Mobile ⋯ actions sheet */}
      {mobile && (
        <MobileSheet open={actionsOpen} onClose={() => setActionsOpen(false)} label="Cohort actions">
          <SheetHead title={c.name} kicker={`resolved ${c.lastPreviewAt ? fmtRelative(c.lastPreviewAt) : 'now'}`} />
          <SheetMenuItem
            label="Push email"
            sub="Compose an email push to this cohort"
            onClick={() => { setActionsOpen(false); navigate(`/AdminBroadcasts?cohort=${id}`); }}
          />
          <SheetMenuItem
            label="Edit definition"
            sub="Filters, age gate, consent scope"
            onClick={() => { setActionsOpen(false); setEditing(true); }}
          />
          <SheetMenuItem
            label={archive.isPending ? 'Archiving…' : 'Archive'}
            sub="Hidden from the list — past sends keep their history"
            danger
            onClick={() => { if (!archive.isPending) { setActionsOpen(false); archive.mutate(); } }}
          />
          <SheetMenuItem
            label="All cohorts"
            sub="Back to the cohort list"
            onClick={() => { setActionsOpen(false); navigate('/AdminCohorts'); }}
          />
        </MobileSheet>
      )}
    </div>
  );
}
