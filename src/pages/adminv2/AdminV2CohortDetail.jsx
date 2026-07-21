/**
 * Switchboard Cohort detail (tracker "cohortui") — the WHY screen. Opens
 * with a fresh server-side resolution (?refresh=1 persists the snapshot),
 * shows the reachable split, a per-reason exclusion breakdown with plain
 * explanations, and the paged member list where every excluded person
 * carries their actual reasons. A channel switch re-asks the same question
 * per channel (email needs an address, WhatsApp needs a phone…).
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchCohort, fetchCohortMembers, fetchCohortFacets, archiveCohort } from '@/api/adminV2';
import { fmtNumber, fmtRelative, fmtDateTime } from '@/lib/adminV2/format';
import { summarizeDefinition, REASON_ORDER, REASON_META, reasonLabel, CHANNEL_OPTIONS } from '@/lib/adminV2/cohorts';
import { Card, Chip, PageHeader, Skeleton, ErrorState, EmptyState, StateRow } from '@/components/adminv2/primitives';
import CohortBuilder from '@/components/adminv2/CohortBuilder';

const PAGE_SIZE = 50;

function Tile({ label, value, caption, tone }) {
  return (
    <div style={{ flex: 1, padding: 16, borderRight: '1px solid var(--line)' }}>
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
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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
        <Skeleton height={30} width={340} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16, marginTop: 20 }}>
          {[12, 5, 7].map((span, i) => <div key={i} style={{ gridColumn: `span ${span}` }}><Skeleton height={140} /></div>)}
        </div>
      </div>
    );
  }
  if (cohort.isError) return <ErrorState error={cohort.error} onRetry={cohort.refetch} />;

  const c = cohort.data;

  return (
    <div>
      <PageHeader
        title={c.name}
        meta={`${summarizeDefinition(c.definition, facets.data).toUpperCase()} · RESOLVED ${c.lastPreviewAt ? fmtRelative(c.lastPreviewAt) : 'NOW'}`}
      >
        <Link to="/AdminCohorts" className="av2-btn av2-btn--sm" style={{ textDecoration: 'none' }}>← All cohorts</Link>
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

      {c.description && <div className="av2-caption" style={{ marginTop: -8, marginBottom: 14 }}>{c.description}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
        <Card span={12}>
          <div style={{ display: 'flex' }}>
            <Tile label="Match the filters" value={preview ? fmtNumber(preview.total) : '—'} caption="people in the group" />
            <Tile label="Reachable" value={preview ? fmtNumber(preview.reachable) : '—'} tone="var(--ok)" caption="consented · verified · not unsubscribed · 18+" />
            <Tile label="Excluded" value={excluded !== null ? fmtNumber(excluded) : '—'} tone={excluded ? 'var(--warn)' : undefined} caption="see why below" />
            <Tile
              label="Gate"
              value={preview?.gate ? (preview.gate.campaignId ? 'campaign' : 'brand-wide') : '—'}
              caption={preview?.gate ? `ages ${preview.gate.minAge}${preview.gate.maxAge ? `–${preview.gate.maxAge}` : '+'} · channel ${preview.gate.channel}` : undefined}
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
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
            <div className="av2-thead" role="row">
              <span className="av2-microcaps" role="columnheader" style={{ flex: 1.2 }}>Person</span>
              <span className="av2-microcaps" role="columnheader" style={{ width: 120, flex: 'none' }}>Phone</span>
              <span className="av2-microcaps" role="columnheader" style={{ flex: 1.4 }}>{status === 'reachable' ? 'Email' : 'Why excluded'}</span>
              <span className="av2-microcaps" role="columnheader" style={{ width: 80, flex: 'none', textAlign: 'right' }}>Seen</span>
            </div>

            {members.isLoading && <StateRow><div style={{ padding: 12 }}><Skeleton height={60} /></div></StateRow>}
            {members.isError && <StateRow><ErrorState error={members.error} onRetry={members.refetch} /></StateRow>}
            {members.isSuccess && members.data.members.length === 0 && (
              <StateRow><EmptyState title={`No ${status} members`} hint={status === 'excluded' ? 'Everyone here can be messaged.' : 'Loosen the filters or check the exclusion panel.'} /></StateRow>
            )}

            {(members.data?.members || []).map((m) => (
              <div key={m.consumerId} className="av2-row" role="row" style={{ cursor: 'default' }}>
                <span role="cell" style={{ flex: 1.2, fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(m.firstName || m.lastName) ? `${m.firstName || ''} ${m.lastName || ''}`.trim() : '—'}
                  {m.reachable && <Chip tone="ok">✓</Chip>}
                </span>
                <span role="cell" className="av2-mono" style={{ width: 120, flex: 'none', fontSize: 11.5 }}>{m.phone || '—'}</span>
                <span role="cell" style={{ flex: 1.4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {m.reachable
                    ? <span className="av2-mono" style={{ fontSize: 11, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email || '—'}</span>
                    : (m.reasons || []).map((r) => <Chip key={r} tone={REASON_META[r]?.tone || ''}>{reasonLabel(r)}</Chip>)}
                </span>
                <span role="cell" className="av2-mono" style={{ width: 80, flex: 'none', fontSize: 10.5, color: 'var(--ink-3)', textAlign: 'right' }} title={m.lastSeenAt ? fmtDateTime(m.lastSeenAt) : ''}>
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
    </div>
  );
}
