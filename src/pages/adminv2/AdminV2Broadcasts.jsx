/**
 * Email Pushes (tracker "emailpush") — the campaign-push composer + list.
 * A push is: one cohort, one campaign it is ABOUT, subject/body/CTA. The
 * backend re-gates EVERY recipient at send time (consent scoped to that
 * campaign) and carries the PR-B unsubscribe rails on every message; this
 * screen only composes drafts — sending lives on the detail screen behind a
 * confirm.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  fetchEmailBroadcasts, createEmailBroadcast, updateEmailBroadcast,
  fetchCohorts, fetchCohortFacets,
} from '@/api/adminV2';
import { fmtNumber, fmtRelative } from '@/lib/adminV2/format';
import { BROADCAST_STATUS_META } from '@/lib/adminV2/broadcasts';
import { normalizeDefinitionShape } from '@/lib/adminV2/cohorts';
import { PageHeader, Chip, Skeleton, ErrorState, EmptyState, StateRow } from '@/components/adminv2/primitives';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

function Field({ label, hint, children }) {
  return (
    <div>
      <div className="av2-microcaps" style={{ marginBottom: 6 }}>
        {label}
        {hint && <span style={{ opacity: 0.6, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}> · {hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Compose (or edit a draft of) an email push. */
export function BroadcastComposer({ broadcast = null, initialCohortId = null, onClose, onSaved }) {
  const editing = !!broadcast;
  const cohorts = useQuery({ queryKey: ['adminV2', 'cohorts'], queryFn: fetchCohorts, staleTime: 30_000 });
  const facets = useQuery({ queryKey: ['adminV2', 'cohortFacets'], queryFn: fetchCohortFacets, staleTime: 60_000 });

  const [cohortId, setCohortId] = useState(broadcast?.cohortId || initialCohortId || '');
  const [campaignId, setCampaignId] = useState(broadcast?.campaignId || '');
  const [subject, setSubject] = useState(broadcast?.subject || '');
  const [bodyText, setBodyText] = useState(broadcast?.bodyText || '');
  const [ctaLabel, setCtaLabel] = useState(broadcast?.ctaLabel || 'Learn more');

  // The send gate is scoped to the campaign the email is ABOUT — active
  // campaigns only (the backend re-checks status AND is_active at send).
  const activeCampaigns = useMemo(
    () => (facets.data?.campaigns || []).filter((c) => c.status === 'active'),
    [facets.data],
  );

  // Default the campaign from the cohort's own gate scope when it has one.
  const cohortRows = cohorts.data?.rows || [];
  useEffect(() => {
    if (editing || campaignId || !cohortId) return;
    const cohort = cohortRows.find((c) => c.id === cohortId);
    const scoped = normalizeDefinitionShape(cohort?.definition).marketingContext?.campaignId;
    if (scoped) setCampaignId(scoped);
  }, [editing, campaignId, cohortId, cohortRows]);

  const save = useMutation({
    mutationFn: () => {
      const payload = { cohortId, campaignId, subject: subject.trim(), bodyText: bodyText.trim(), ctaLabel: ctaLabel.trim() || 'Learn more' };
      return editing ? updateEmailBroadcast(broadcast.id, payload) : createEmailBroadcast(payload);
    },
    onSuccess: (r) => {
      toast.success(editing ? 'Push updated' : 'Draft created — review, test, then send');
      onSaved?.(r?.data || null);
      onClose();
    },
    onError: (e) => toast.error(e?.message || 'Save failed'),
  });

  const canSave = cohortId && campaignId && subject.trim() && bodyText.trim() && !save.isPending;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
      <DialogContent
        className="admin-v2"
        style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', maxWidth: 640, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--ink)', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, textAlign: 'left' }}>
            {editing ? 'Edit push' : 'New email push'}
          </DialogTitle>
          <DialogDescription style={{ color: 'var(--ink-2)', fontSize: 11.5, textAlign: 'left' }}>
            The email must be ABOUT the campaign you pick — every recipient is re-checked against that consent scope at send time.
          </DialogDescription>
        </DialogHeader>

        <div style={{ overflowY: 'auto', display: 'grid', gap: 14, padding: '6px 2px', flex: 1 }}>
          <Field label="Cohort" hint="who receives it">
            {cohorts.isLoading ? <Skeleton height={30} /> : (
              <select className="av2-input" value={cohortId} onChange={(e) => setCohortId(e.target.value)} aria-label="Cohort">
                <option value="">Select a cohort…</option>
                {cohortRows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.lastReachableCount != null ? ` (~${c.lastReachableCount} reachable)` : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Campaign" hint="what the email is about — CTA links to its page">
            {facets.isLoading ? <Skeleton height={30} /> : (
              <select className="av2-input" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label="Campaign">
                <option value="">Select an active campaign…</option>
                {activeCampaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </Field>

          <Field label="Subject">
            <input className="av2-input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} placeholder="e.g. Your Tokyo draw closes this week" />
          </Field>

          <Field label="Body" hint="plain text — blank line starts a new paragraph">
            <textarea
              className="av2-input"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              maxLength={5000}
              rows={8}
              style={{ resize: 'vertical', minHeight: 140, fontFamily: 'inherit' }}
              placeholder={'Hi — quick reminder that…\n\nSecond paragraph.'}
            />
          </Field>

          <Field label="Button label" hint="links to the campaign page with utm tagging">
            <input className="av2-input" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} maxLength={80} />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 10 }}>
          <button type="button" className="av2-btn" onClick={onClose} disabled={save.isPending}>Cancel</button>
          <button type="button" className="av2-btn av2-btn--primary" disabled={!canSave} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create draft'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminV2Broadcasts() {
  const broadcasts = useQuery({ queryKey: ['adminV2', 'emailBroadcasts'], queryFn: fetchEmailBroadcasts, staleTime: 15_000 });
  const [searchParams, setSearchParams] = useSearchParams();
  const prefillCohort = searchParams.get('cohort');
  const [composing, setComposing] = useState(() => !!prefillCohort);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const rows = broadcasts.data?.rows || [];

  return (
    <div>
      <PageHeader
        title="Email Pushes"
        meta={`${fmtNumber(rows.length)} PUSHES · EVERY RECIPIENT RE-GATED AT SEND TIME · UNSUBSCRIBE ON EVERY MAIL`}
      >
        <button type="button" className="av2-btn av2-btn--primary" onClick={() => setComposing(true)}>+ New push</button>
      </PageHeader>

      <div className="av2-card" style={{ overflow: 'hidden' }} role="table" aria-label="Email pushes">
        <div className="av2-thead" role="row">
          <span className="av2-microcaps" role="columnheader" style={{ flex: 1.6 }}>Subject</span>
          <span className="av2-microcaps" role="columnheader" style={{ flex: 1 }}>Cohort</span>
          <span className="av2-microcaps" role="columnheader" style={{ flex: 1 }}>Campaign</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 110, flex: 'none' }}>Status</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 150, flex: 'none', textAlign: 'right' }}>Sent / skip / fail</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 90, flex: 'none', textAlign: 'right' }}>Created</span>
        </div>

        {broadcasts.isLoading && [0, 1, 2].map((i) => (
          <div key={i} className="av2-row" role="row" style={{ cursor: 'default' }}><span role="cell" style={{ flex: 1 }}><Skeleton height={30} /></span></div>
        ))}
        {broadcasts.isError && <StateRow><ErrorState error={broadcasts.error} onRetry={broadcasts.refetch} /></StateRow>}
        {!broadcasts.isLoading && !broadcasts.isError && rows.length === 0 && (
          <StateRow>
            <EmptyState
              title="No email pushes yet"
              hint="Compose a subject/body/CTA about one campaign, pick a cohort, test it to yourself, then send."
              action={<button type="button" className="av2-btn av2-btn--primary av2-btn--sm" onClick={() => setComposing(true)}>Compose the first one</button>}
            />
          </StateRow>
        )}

        {rows.map((b) => {
          const st = BROADCAST_STATUS_META[b.status] || { label: b.status, tone: '' };
          return (
            <div
              key={b.id}
              className="av2-row"
              role="row"
              tabIndex={0}
              onClick={() => navigate(`/admin/broadcasts/${b.id}`)}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/admin/broadcasts/${b.id}`); }}
            >
              <span role="cell" style={{ flex: 1.6, fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.subject}</span>
              <span role="cell" className="av2-caption" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.cohort?.name || '—'}</span>
              <span role="cell" className="av2-caption" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.campaign?.name || '—'}</span>
              <span role="cell" style={{ width: 110, flex: 'none' }}><Chip tone={st.tone}>{st.label}</Chip></span>
              <span role="cell" className="av2-mono" style={{ width: 150, flex: 'none', fontSize: 12, textAlign: 'right' }}>
                {b.status === 'draft'
                  ? '—'
                  : <>
                      <span style={{ color: 'var(--ok)', fontWeight: 700 }}>{fmtNumber(b.sentCount)}</span>
                      <span style={{ color: 'var(--ink-3)' }}> / {fmtNumber(b.skippedCount)} / </span>
                      <span style={{ color: b.failedCount ? 'var(--bad)' : 'var(--ink-3)' }}>{fmtNumber(b.failedCount)}</span>
                    </>}
              </span>
              <span role="cell" className="av2-mono" style={{ width: 90, flex: 'none', fontSize: 10.5, color: 'var(--ink-3)', textAlign: 'right' }}>{fmtRelative(b.createdAt)}</span>
            </div>
          );
        })}
      </div>

      <div className="av2-caption" style={{ marginTop: 10 }}>
        Sends are throttled, one push at a time, with the unsubscribe footer + one-click header on every message. Cohort membership never substitutes for the send-time consent check.
      </div>

      {composing && (
        <BroadcastComposer
          initialCohortId={prefillCohort}
          onClose={() => {
            setComposing(false);
            if (prefillCohort) setSearchParams({}, { replace: true });
          }}
          onSaved={(b) => {
            queryClient.invalidateQueries({ queryKey: ['adminV2', 'emailBroadcasts'] });
            if (b?.id) navigate(`/admin/broadcasts/${b.id}`);
          }}
        />
      )}
    </div>
  );
}
