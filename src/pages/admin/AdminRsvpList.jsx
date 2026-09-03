import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useRsvpEvents, useCreateRsvpEvent, useDeleteRsvpEvent } from '@/hooks/queries/useRsvp';
import { Chip, PageHeader, Skeleton, ErrorState, EmptyState } from '@/components/adminv2/primitives';
import { fmtDate } from '@/lib/adminV2/format';
import { rsvpPublicUrl } from '@/lib/brand';

/**
 * /admin/rsvp — every RSVP page at a glance (docs/plans/rsvp-pages.md §6).
 * Rows open the designer; drafts with no responses can be deleted here; live
 * events are closed from the designer and purged later (P3).
 */

const STATUS_TONE = { published: 'ok', draft: '', closed: 'warn' };

export default function AdminRsvpList() {
  const navigate = useNavigate();
  const { data: events, isLoading, isError, error, refetch } = useRsvpEvents();
  const create = useCreateRsvpEvent();
  const remove = useDeleteRsvpEvent();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [organiserName, setOrganiserName] = useState('');

  const submitCreate = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      const ev = await create.mutateAsync({ title: title.trim(), organiserName: organiserName.trim() });
      navigate(`/admin/rsvp/${ev.id}`);
    } catch (err) {
      toast.error(err?.message || 'Could not create the event');
    }
  };

  const onDelete = async (ev) => {
    if (!window.confirm(`Delete "${ev.title}"? This draft has no responses.`)) return;
    try {
      await remove.mutateAsync(ev.id);
      toast.success('Deleted');
    } catch (err) {
      toast.error(err?.message || 'Could not delete');
    }
  };

  return (
    <div>
      <PageHeader title="RSVP pages" meta={events ? `${events.length} event${events.length === 1 ? '' : 's'} · rsvp.redeem.sg` : 'rsvp.redeem.sg'}>
        <button type="button" className="av2-btn av2-btn--primary" onClick={() => setCreating((v) => !v)}>New event</button>
      </PageHeader>

      {creating ? (
        <form onSubmit={submitCreate} className="av2-card" style={{ padding: 14, marginBottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'end' }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Event title
            <input className="av2-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Launch night" maxLength={120} required style={{ display: 'block', width: '100%', marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Organiser
            <input className="av2-input" value={organiserName} onChange={(e) => setOrganiserName(e.target.value)} placeholder="Acme Pte Ltd" maxLength={120} style={{ display: 'block', width: '100%', marginTop: 4 }} />
          </label>
          <button type="submit" className="av2-btn av2-btn--primary" disabled={create.isPending}>Create</button>
        </form>
      ) : null}

      {isLoading ? <Skeleton height={140} /> : isError ? <ErrorState error={error} onRetry={refetch} /> : !events?.length ? (
        <EmptyState icon="✉" title="No RSVP pages yet" hint="Create one, design it, publish it, share the link." />
      ) : (
        <div className="av2-card" style={{ overflow: 'hidden' }}>
          <div role="table" aria-label="RSVP pages">
            <div role="row" className="av2-thead" style={{ display: 'grid', gridTemplateColumns: '2fr 1.6fr 100px 80px 120px 120px auto', gap: 10, padding: '8px 14px' }}>
              {['Event', 'Link', 'Status', 'Going', 'Closes', 'Updated', ''].map((h) => <div key={h} role="columnheader">{h}</div>)}
            </div>
            {events.map((ev) => (
              <div key={ev.id} role="row" className="av2-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1.6fr 100px 80px 120px 120px auto', gap: 10, padding: '10px 14px', alignItems: 'center', borderTop: '1px solid var(--line)' }}>
                <div role="cell">
                  <button type="button" onClick={() => navigate(`/admin/rsvp/${ev.id}`)} style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontWeight: 700, fontSize: 13.5, color: 'var(--ink)', textAlign: 'left' }}>{ev.title}</button>
                  {ev.organiserName ? <div className="av2-caption">{ev.organiserName}</div> : null}
                </div>
                <div role="cell" className="av2-mono" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {ev.slug ? <a href={rsvpPublicUrl(ev.slug)} target="_blank" rel="noreferrer">rsvp.redeem.sg/{ev.slug}</a> : <span style={{ color: 'var(--ink-3)' }}>no link yet</span>}
                </div>
                <div role="cell"><Chip tone={STATUS_TONE[ev.status] ?? ''}>{ev.status}</Chip></div>
                <div role="cell" className="av2-mono">{ev.goingCount ?? 0}{ev.capacity ? ` / ${ev.capacity}` : ''}</div>
                <div role="cell" className="av2-caption">{ev.closesAt ? fmtDate(ev.closesAt) : '—'}</div>
                <div role="cell" className="av2-caption">{fmtDate(ev.updatedAt)}</div>
                <div role="cell" style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={() => navigate(`/admin/rsvp/${ev.id}/responses`)}>Responses</button>
                  {ev.status === 'draft' && !ev.responseCount ? (
                    <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" aria-label={`Delete ${ev.title}`} onClick={() => onDelete(ev)}>Delete</button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
