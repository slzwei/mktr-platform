/**
 * Email Push detail (tracker "emailpush") — the send console + send log.
 * Draft → confirm dialog (live reachable estimate under THIS campaign's
 * consent scope + the "must be about this campaign" reminder) → the backend
 * worker sends throttled with a per-recipient gate; this screen polls the
 * live counts while active, offers Cancel (≤1 iteration to stop) and Resume
 * (continues pending rows only, never re-sends), and renders the
 * who/when/status/why log.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  fetchEmailBroadcast, fetchEmailBroadcastRecipients, sendEmailBroadcast,
  cancelEmailBroadcast, deleteEmailBroadcast, testEmailBroadcast,
  previewCohortDefinition,
} from '@/api/adminV2';
import { fmtNumber, fmtRelative, fmtDateTime } from '@/lib/adminV2/format';
import {
  BROADCAST_STATUS_META, RECIPIENT_STATUS_META, broadcastReasonLabel,
  broadcastReasonMeta, definitionWithCampaignScope, ACTIVE_BROADCAST_STATUSES,
} from '@/lib/adminV2/broadcasts';
import { Card, Chip, PageHeader, Skeleton, ErrorState, EmptyState, StateRow } from '@/components/adminv2/primitives';
import { BroadcastComposer } from './AdminV2Broadcasts';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';

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

export default function AdminV2BroadcastDetail() {
  const { id } = useParams();
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const [confirmSend, setConfirmSend] = useState(false);
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const broadcast = useQuery({
    queryKey: ['adminV2', 'emailBroadcast', id],
    queryFn: () => fetchEmailBroadcast(id),
    refetchInterval: (q) => (ACTIVE_BROADCAST_STATUSES.includes(q.state.data?.status) ? 3000 : false),
  });
  const b = broadcast.data;
  const active = ACTIVE_BROADCAST_STATUSES.includes(b?.status);

  const recipients = useQuery({
    queryKey: ['adminV2', 'emailBroadcastRecipients', id, status, page],
    queryFn: () => fetchEmailBroadcastRecipients(id, { status, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    enabled: broadcast.isSuccess && b?.status !== 'draft',
    placeholderData: (prev) => prev,
    refetchInterval: active ? 5000 : false,
  });

  // The estimate the confirm dialog shows — the definition re-aimed at THIS
  // campaign (exactly what the backend freezes and gates on).
  const estimate = useQuery({
    queryKey: ['adminV2', 'broadcastEstimate', id, b?.campaignId],
    queryFn: () => previewCohortDefinition(
      definitionWithCampaignScope(b.cohort.definition, b.campaignId), 'email',
    ),
    enabled: confirmSend && !!b?.cohort?.definition && !!b?.campaignId,
    staleTime: 30_000,
  });

  const refetchAll = () => {
    queryClient.invalidateQueries({ queryKey: ['adminV2', 'emailBroadcast', id] });
    queryClient.invalidateQueries({ queryKey: ['adminV2', 'emailBroadcastRecipients', id] });
    queryClient.invalidateQueries({ queryKey: ['adminV2', 'emailBroadcasts'] });
  };

  const send = useMutation({
    mutationFn: ({ resume = false } = {}) => sendEmailBroadcast(id, { resume }),
    onSuccess: () => { toast.success('Sending started'); setConfirmSend(false); refetchAll(); },
    onError: (e) => { toast.error(e?.message || 'Send failed to start'); setConfirmSend(false); refetchAll(); },
  });
  const cancel = useMutation({
    mutationFn: () => cancelEmailBroadcast(id),
    onSuccess: () => { toast.success('Cancelling — the worker stops within one send'); refetchAll(); },
    onError: (e) => { toast.error(e?.message || 'Cancel failed'); refetchAll(); },
  });
  const test = useMutation({
    mutationFn: () => testEmailBroadcast(id),
    onSuccess: (r) => toast.success(`Test sent to ${r?.data?.sentTo || 'your email'}`),
    onError: (e) => toast.error(e?.message || 'Test send failed'),
  });
  const destroy = useMutation({
    mutationFn: () => deleteEmailBroadcast(id),
    onSuccess: () => {
      toast.success('Draft deleted');
      queryClient.invalidateQueries({ queryKey: ['adminV2', 'emailBroadcasts'] });
      navigate('/AdminBroadcasts');
    },
    onError: (e) => toast.error(e?.message || 'Delete failed'),
  });

  if (broadcast.isLoading) {
    return (
      <div>
        <Skeleton height={30} width={340} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16, marginTop: 20 }}>
          {[12, 12].map((span, i) => <div key={i} style={{ gridColumn: `span ${span}` }}><Skeleton height={140} /></div>)}
        </div>
      </div>
    );
  }
  if (broadcast.isError) return <ErrorState error={broadcast.error} onRetry={broadcast.refetch} />;

  const st = BROADCAST_STATUS_META[b.status] || { label: b.status, tone: '' };
  const counts = b.liveCounts || {};
  const remaining = (counts.pending || 0) + (counts.attempting || 0);

  return (
    <div>
      <PageHeader
        title={b.subject}
        meta={`${(b.cohort?.name || '—').toUpperCase()} → ${(b.campaign?.name || '—').toUpperCase()} · ${st.label.toUpperCase()}`}
      >
        <Link to="/AdminBroadcasts" className="av2-btn av2-btn--sm" style={{ textDecoration: 'none' }}>← All pushes</Link>
        {b.status === 'draft' && (
          <>
            <button type="button" className="av2-btn av2-btn--sm" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" className="av2-btn av2-btn--sm" disabled={test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? 'Sending test…' : 'Send test to my email'}
            </button>
            <button
              type="button"
              className="av2-btn av2-btn--sm"
              style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}
              disabled={destroy.isPending}
              onClick={() => destroy.mutate()}
            >
              Delete
            </button>
            <button type="button" className="av2-btn av2-btn--sm av2-btn--primary" onClick={() => setConfirmSend(true)}>Send…</button>
          </>
        )}
        {active && (
          <button
            type="button"
            className="av2-btn av2-btn--sm"
            style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}
            disabled={cancel.isPending || b.status === 'cancelling'}
            onClick={() => cancel.mutate()}
          >
            {b.status === 'cancelling' ? 'Cancelling…' : 'Cancel send'}
          </button>
        )}
        {(b.status === 'interrupted' || b.status === 'failed') && (
          <>
            {b.status === 'interrupted' && (
              <button type="button" className="av2-btn av2-btn--sm av2-btn--primary" disabled={send.isPending} onClick={() => send.mutate({ resume: true })}>
                Resume
              </button>
            )}
            <button
              type="button"
              className="av2-btn av2-btn--sm"
              style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Cancel remaining
            </button>
          </>
        )}
      </PageHeader>

      {b.lastError && (
        <div className="av2-caption" style={{ marginTop: -8, marginBottom: 14, color: 'var(--bad)' }}>{b.lastError}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
        <Card span={12}>
          <div style={{ display: 'flex' }}>
            <Tile label="Recipients" value={b.status === 'draft' ? '—' : fmtNumber(b.totalRecipients)} caption={b.status === 'draft' ? 'resolved at send' : 'claimed at send start'} />
            <Tile label="Sent" value={fmtNumber(counts.sent ?? b.sentCount)} tone="var(--ok)" caption="accepted by the mail server" />
            <Tile label="Skipped" value={fmtNumber(counts.skipped ?? b.skippedCount)} tone="var(--warn)" caption="gate said no at send time" />
            <Tile label="Failed" value={fmtNumber(counts.failed ?? b.failedCount)} tone={(counts.failed ?? b.failedCount) ? 'var(--bad)' : undefined} caption="transport errors" />
            {active && <Tile label="Remaining" value={fmtNumber(remaining)} caption="throttled queue" />}
          </div>
        </Card>

        <Card span={12} title="Message" meta={b.hostChoice ? `BRAND ${b.hostChoice}` : undefined}>
          <div style={{ padding: 16, display: 'grid', gap: 10 }}>
            <div className="av2-caption" style={{ whiteSpace: 'pre-wrap' }}>{b.bodyText}</div>
            <div className="av2-mono" style={{ fontSize: 11.5, color: 'var(--ink-2)', overflowWrap: 'anywhere' }}>
              CTA “{b.ctaLabel}” → {b.ctaUrl || b.ctaUrlPreview || '—'}
            </div>
            <div className="av2-caption">
              Every mail carries the unsubscribe footer + one-click header (PR-B rails). Recipients are re-checked against the “{b.campaign?.name || '—'}” consent scope at the moment of their send.
            </div>
          </div>
        </Card>

        {b.status !== 'draft' && (
          <Card
            span={12}
            title="Send log"
            meta={recipients.data ? `${fmtNumber(recipients.data.total)} ${status === 'all' ? 'rows' : status}` : undefined}
            action={(
              <div className="av2-seg" role="group" aria-label="Recipient status">
                {['all', 'sent', 'skipped', 'failed', 'pending'].map((s) => (
                  <button key={s} type="button" aria-pressed={status === s} onClick={() => { setStatus(s); setPage(0); }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          >
            <div role="table" aria-label="Send log">
              <div className="av2-thead" role="row">
                <span className="av2-microcaps" role="columnheader" style={{ flex: 1.6 }}>Email</span>
                <span className="av2-microcaps" role="columnheader" style={{ width: 110, flex: 'none' }}>Status</span>
                <span className="av2-microcaps" role="columnheader" style={{ flex: 1.4 }}>Why</span>
                <span className="av2-microcaps" role="columnheader" style={{ width: 130, flex: 'none', textAlign: 'right' }}>When</span>
              </div>

              {recipients.isLoading && <StateRow><div style={{ padding: 12 }}><Skeleton height={60} /></div></StateRow>}
              {recipients.isError && <StateRow><ErrorState error={recipients.error} onRetry={recipients.refetch} /></StateRow>}
              {recipients.isSuccess && recipients.data.recipients.length === 0 && (
                <StateRow><EmptyState title={`No ${status === 'all' ? '' : status} rows`} hint="Rows appear once the send starts claiming recipients." /></StateRow>
              )}

              {(recipients.data?.recipients || []).map((r) => {
                const rst = RECIPIENT_STATUS_META[r.status] || { label: r.status, tone: '' };
                const meta = r.reason ? broadcastReasonMeta(r.reason) : null;
                return (
                  <div key={r.id} className="av2-row" role="row" style={{ cursor: 'default' }}>
                    <span role="cell" className="av2-mono" style={{ flex: 1.6, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.email || '—'}
                    </span>
                    <span role="cell" style={{ width: 110, flex: 'none' }}><Chip tone={rst.tone}>{rst.label}</Chip></span>
                    <span role="cell" style={{ flex: 1.4, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      {r.reason ? <Chip tone={meta?.tone || ''}>{broadcastReasonLabel(r.reason)}</Chip> : <span className="av2-caption">—</span>}
                      {r.error && <span className="av2-caption" style={{ color: 'var(--bad)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }} title={r.error}>{r.error}</span>}
                    </span>
                    <span role="cell" className="av2-mono" style={{ width: 130, flex: 'none', fontSize: 10.5, color: 'var(--ink-3)', textAlign: 'right' }} title={r.sentAt ? fmtDateTime(r.sentAt) : ''}>
                      {r.sentAt ? fmtRelative(r.sentAt) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>

            {recipients.isSuccess && recipients.data.total > PAGE_SIZE && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', padding: '10px 14px' }}>
                <span className="av2-caption">
                  {fmtNumber(page * PAGE_SIZE + 1)}–{fmtNumber(Math.min((page + 1) * PAGE_SIZE, recipients.data.total))} of {fmtNumber(recipients.data.total)}
                </span>
                <button type="button" className="av2-btn av2-btn--sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</button>
                <button type="button" className="av2-btn av2-btn--sm" disabled={(page + 1) * PAGE_SIZE >= recipients.data.total} onClick={() => setPage((p) => p + 1)}>Next →</button>
              </div>
            )}
          </Card>
        )}
      </div>

      {editing && (
        <BroadcastComposer
          broadcast={b}
          onClose={() => setEditing(false)}
          onSaved={() => refetchAll()}
        />
      )}

      <AlertDialog open={confirmSend} onOpenChange={(open) => { if (!open) setConfirmSend(false); }}>
        <AlertDialogContent className="admin-v2" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)' }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: 'var(--ink)' }}>Send “{b.subject}”?</AlertDialogTitle>
            <AlertDialogDescription style={{ color: 'var(--ink-2)' }} asChild>
              <div>
                <p style={{ margin: '0 0 8px' }}>
                  {estimate.isLoading && 'Estimating the reachable audience…'}
                  {estimate.isError && 'Estimate unavailable — the backend still gates every recipient at send time.'}
                  {estimate.data && (
                    <>Approximately <b>{fmtNumber(estimate.data.reachable)}</b> of {fmtNumber(estimate.data.total)} people in “{b.cohort?.name}” are reachable under this campaign's consent scope right now. Each one is re-checked at the moment of their send.</>
                  )}
                </p>
                <p style={{ margin: 0 }}>
                  This email must be ABOUT “{b.campaign?.name}” — recipients consented to that scope, throttled sending starts immediately, and every mail carries the unsubscribe rails.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); send.mutate({}); }}
              disabled={send.isPending}
            >
              {send.isPending ? 'Starting…' : 'Send now'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
