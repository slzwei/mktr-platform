import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useRsvpEvent, useUpdateRsvpResponse } from '@/hooks/queries/useRsvp';
import { fetchRsvpResponses, downloadRsvpCsv } from '@/api/rsvp';
import { useQuery } from '@tanstack/react-query';
import { Chip, PageHeader, Skeleton, ErrorState, EmptyState } from '@/components/adminv2/primitives';
import { fmtDate } from '@/lib/adminV2/format';

/**
 * /admin/rsvp/:id/responses — who is coming (docs/plans/rsvp-pages.md §6).
 * Cursor-paged table with the event's custom fields as columns, a server CSV
 * export (formula-injection guarded there), and per-attendee cancel /
 * reactivate (a reactivation needs a free seat — the server decides).
 */

const BUILTIN = ['name', 'email', 'phone'];
const fmtAnswer = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v == null ? '' : String(v));

export default function AdminRsvpResponses() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: event, isLoading: eventLoading, isError, error, refetch } = useRsvpEvent(id);
  const [cursors, setCursors] = useState(['']); // one entry per loaded page
  const [busyId, setBusyId] = useState(null);
  const update = useUpdateRsvpResponse();

  const pages = useQuery({
    queryKey: ['rsvp', 'responses', id, cursors.join('|')],
    queryFn: async () => {
      const out = [];
      for (const cursor of cursors) out.push(await fetchRsvpResponses(id, { cursor: cursor || undefined }));
      return out;
    },
    enabled: !!id,
  });
  const rows = useMemo(() => (pages.data || []).flatMap((p) => p.responses), [pages.data]);
  const nextCursor = pages.data?.length ? pages.data[pages.data.length - 1].nextCursor : null;
  const customFields = useMemo(() => (event?.layout?.fields || []).filter((f) => !BUILTIN.includes(f.key)), [event]);

  const setStatus = async (row, status) => {
    setBusyId(row.id);
    try {
      await update.mutateAsync({ id, responseId: row.id, patch: { status } });
      await pages.refetch();
      toast.success(status === 'cancelled' ? 'Cancelled' : 'Reactivated');
    } catch (err) {
      toast.error(err?.data?.code === 'full' ? 'The event is full — no seat to give back' : err?.message || 'Could not update');
    } finally {
      setBusyId(null);
    }
  };

  const exportCsv = async () => {
    try {
      const { truncated } = await downloadRsvpCsv(id, `rsvp-${event?.slug || id}-responses.csv`);
      if (truncated) toast.warning('Export capped at 5,000 rows');
    } catch (err) {
      toast.error(err?.message || 'Export failed');
    }
  };

  if (eventLoading) return <Skeleton height={160} />;
  if (isError || !event) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <div>
      <PageHeader title={event.title} meta={`${event.goingCount ?? 0} going${event.capacity ? ` of ${event.capacity}` : ''} · ${event.responseCount ?? 0} responses`}>
        <button type="button" className="av2-btn av2-btn--ghost" onClick={() => navigate(`/admin/rsvp/${id}`)}>← Designer</button>
        <button type="button" className="av2-btn av2-btn--primary" onClick={exportCsv} disabled={!rows.length}>Download CSV</button>
      </PageHeader>

      {pages.isLoading ? <Skeleton height={140} /> : pages.isError ? <ErrorState error={pages.error} onRetry={pages.refetch} /> : !rows.length ? (
        <EmptyState icon="○" title="No responses yet" hint={event.status === 'published' ? 'Share the link and they will show up here.' : 'Publish the page to start taking RSVPs.'} />
      ) : (
        <div className="av2-card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              {/* Not .av2-thead: that class is display:flex for the div tables and would collapse real <th> cells leftwards. */}
              <tr style={{ background: 'var(--surface-2)' }}>
                {['Name', 'Email', 'Phone', ...customFields.map((f) => f.label || f.key), 'Status', 'Submitted', ''].map((h, i) => (
                  <th key={i} className="av2-mono" style={{ textAlign: 'left', padding: '9px 12px', whiteSpace: 'nowrap', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600, borderBottom: '1px solid var(--line)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{r.name}</td>
                  <td style={{ padding: '8px 12px' }} className="av2-mono">{r.email}</td>
                  <td style={{ padding: '8px 12px' }} className="av2-mono">{r.phone || '—'}</td>
                  {customFields.map((f) => <td key={f.key} style={{ padding: '8px 12px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmtAnswer(r.answers?.[f.key])}</td>)}
                  <td style={{ padding: '8px 12px' }}><Chip tone={r.status === 'going' ? 'ok' : 'warn'}>{r.status}</Chip></td>
                  <td style={{ padding: '8px 12px' }} className="av2-caption">{fmtDate(r.createdAt)}</td>
                  <td style={{ padding: '8px 12px' }}>
                    {r.status === 'going' ? (
                      <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" disabled={busyId === r.id} onClick={() => setStatus(r, 'cancelled')} aria-label={`Cancel ${r.name}`}>Cancel</button>
                    ) : (
                      <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" disabled={busyId === r.id} onClick={() => setStatus(r, 'going')} aria-label={`Reactivate ${r.name}`}>Reactivate</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor ? (
            <div style={{ padding: 12, textAlign: 'center' }}>
              <button type="button" className="av2-btn av2-btn--ghost" onClick={() => setCursors((c) => [...c, nextCursor])}>Load more</button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
