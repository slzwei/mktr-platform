/**
 * Switchboard Short Links — mktr.sg/{slug} redirects with click counts.
 * List + create (targetUrl validated server-side, slug auto-allocated,
 * purpose 'admin') + delete. `active` derives from expiresAt — the model
 * has no stored flag.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@/api/client';
import { fmtNumber, fmtRelative } from '@/lib/adminV2/format';
import { Chip, PageHeader, Skeleton, ErrorState, EmptyState, StateRow } from '@/components/adminv2/primitives';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { useAdminV2Mobile } from '@/components/adminv2/mobile/useAdminV2Mobile';

const fetchLinks = async () => {
  const resp = await apiClient.get('/shortlinks?limit=200');
  const data = resp?.data ?? {};
  return { rows: data.items || [], total: data.total ?? (data.items || []).length };
};

const isActive = (link, now = Date.now()) => !link.expiresAt || new Date(link.expiresAt).getTime() > now;

function CreateDialog({ onClose }) {
  const [targetUrl, setTargetUrl] = useState('');
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () => apiClient.post('/shortlinks', { targetUrl: targetUrl.trim(), purpose: 'admin' }),
    onSuccess: (r) => {
      const url = r?.data?.url || (r?.data?.slug ? `https://mktr.sg/share/${r.data.slug}` : null);
      toast.success(url ? `Created ${url.replace('https://', '')}` : 'Short link created');
      queryClient.invalidateQueries({ queryKey: ['adminV2', 'shortlinks'] });
      onClose();
    },
    onError: (e) => toast.error(e?.message || 'Create failed'),
  });
  const valid = /^https?:\/\/.+/.test(targetUrl.trim());

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !create.isPending) onClose(); }}>
      <DialogContent variant="sheet" className="admin-v2" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', maxWidth: 460 }}>
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--ink)', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, textAlign: 'left' }}>New short link</DialogTitle>
          <DialogDescription style={{ color: 'var(--ink-2)', fontSize: 11.5, textAlign: 'left' }}>
            The slug is auto-allocated; links expire after 90 days by default.
          </DialogDescription>
        </DialogHeader>
        <label style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
          <span className="av2-microcaps">Target URL</span>
          <input
            className="av2-input"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://redeem.sg/LeadCapture?campaign_id=…"
            aria-invalid={targetUrl.trim() !== '' && !valid}
          />
        </label>
        {targetUrl.trim() !== '' && !valid && (
          <div className="av2-caption" style={{ color: 'var(--bad)', marginBottom: 8 }}>Must be a full http(s) URL.</div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="av2-btn" disabled={create.isPending} onClick={onClose}>Cancel</button>
          <button type="button" className="av2-btn av2-btn--primary" disabled={!valid || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create link'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminV2ShortLinks() {
  const links = useQuery({ queryKey: ['adminV2', 'shortlinks'], queryFn: fetchLinks, staleTime: 30_000 });
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: (id) => apiClient.delete(`/shortlinks/${id}`),
    onSuccess: () => {
      toast.success('Short link deleted — the URL now dead-ends');
      queryClient.invalidateQueries({ queryKey: ['adminV2', 'shortlinks'] });
      setConfirmDelete(null);
    },
    onError: (e) => { toast.error(e?.message || 'Delete failed'); setConfirmDelete(null); },
  });
  const mobile = useAdminV2Mobile();

  const rows = links.data?.rows || [];

  // Short links resolve at /share/:slug — the SPA has no root-level slug route.
  const copy = (slug) => {
    navigator.clipboard?.writeText(`https://mktr.sg/share/${slug}`)
      .then(() => toast.success(`Copied mktr.sg/share/${slug}`))
      .catch(() => toast.error('Copy failed'));
  };

  /* ── Mobile (design 1694f8b2 "MKTR Ops Console Mobile"): link cards ── */
  if (mobile) {
    const total = links.data?.total ?? 0;
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 10 }}>
          <div className="av2-mono" style={{ flex: 1, minWidth: 0, fontSize: 10, letterSpacing: '.12em', color: 'var(--ink-3)', textTransform: 'uppercase', padding: '2px 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {fmtNumber(total)} links{total > rows.length && rows.length > 0 ? ` · showing newest ${fmtNumber(rows.length)}` : ''} · clicks are lifetime
          </div>
          <button type="button" onClick={() => setCreating(true)} style={{ flex: 'none', height: 38, display: 'inline-flex', alignItems: 'center', padding: '0 14px', background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 700 }}>
            + New link
          </button>
        </div>

        {links.isLoading && (
          <div style={{ display: 'grid', gap: 8 }}>
            {[0, 1, 2].map((i) => <Skeleton key={i} height={90} style={{ borderRadius: 14 }} />)}
          </div>
        )}
        {links.isError && <div className="av2-card"><ErrorState error={links.error} onRetry={links.refetch} /></div>}
        {!links.isLoading && !links.isError && rows.length === 0 && (
          <div className="av2-card"><EmptyState title="No short links" hint="Create one for ads, print, or chat blasts." /></div>
        )}
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map((l) => {
            const active = isActive(l);
            return (
              <div key={l.id} className="av2-card" style={{ padding: '12px 13px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span className="av2-mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>/share/{l.slug}</span>
                    {!active && <Chip tone="warn">Expired</Chip>}
                  </span>
                  <button type="button" onClick={() => copy(l.slug)} style={{ flex: 'none', height: 32, padding: '0 12px', background: 'var(--surface-2)', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 11.5, fontWeight: 700, color: 'var(--ink)' }}>
                    Copy
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete /share/${l.slug}`}
                    onClick={() => setConfirmDelete(l)}
                    style={{ flex: 'none', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', border: 'none', borderRadius: 8, cursor: 'pointer', color: 'var(--bad)', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-ui)' }}
                  >
                    ✕
                  </button>
                </div>
                <div className="av2-mono" style={{ marginTop: 7, fontSize: 10.5, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.targetUrl}>
                  → {l.targetUrl}
                </div>
                <div className="av2-mono" style={{ marginTop: 3, fontSize: 10, color: 'var(--ink-3)' }}>
                  {fmtNumber(l.clickCount ?? l.clicks ?? 0)} clicks · last click {l.lastClickedAt ? fmtRelative(l.lastClickedAt) : '—'}
                </div>
              </div>
            );
          })}
        </div>

        <div className="av2-caption" style={{ padding: '12px 4px 0' }}>
          Expiry: {`links live ${90} days by default`} — expired slugs stop redirecting but keep their click history here.
        </div>

        {creating && <CreateDialog onClose={() => setCreating(false)} />}

        <AlertDialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
          <AlertDialogContent className="admin-v2" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)' }}>
            <AlertDialogHeader>
              <AlertDialogTitle style={{ color: 'var(--ink)' }}>Delete /{confirmDelete?.slug}?</AlertDialogTitle>
              <AlertDialogDescription style={{ color: 'var(--ink-2)' }}>
                Anything printed or posted with this link will dead-end immediately. Click history is removed with it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); remove.mutate(confirmDelete.id); }}
                disabled={remove.isPending}
                style={{ background: 'var(--bad)', color: '#fff' }}
              >
                {remove.isPending ? 'Deleting…' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Short Links" meta={`${fmtNumber(links.data?.total ?? 0)} LINKS${(links.data?.total ?? 0) > (links.data?.rows || []).length && (links.data?.rows || []).length > 0 ? ` · SHOWING NEWEST ${fmtNumber((links.data?.rows || []).length)}` : ''} · CLICKS ARE LIFETIME`}>
        <button type="button" className="av2-btn av2-btn--primary" onClick={() => setCreating(true)}>+ New link</button>
      </PageHeader>

      <div className="av2-card" style={{ overflow: 'hidden' }} role="table" aria-label="Short links">
        <div className="av2-thead" role="row">
          <span className="av2-microcaps" role="columnheader" style={{ width: 150, flex: 'none' }}>Short</span>
          <span className="av2-microcaps" role="columnheader" style={{ flex: 1.8 }}>Target</span>
          <span className="av2-microcaps" role="columnheader" style={{ flex: 1 }}>Campaign</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 70, flex: 'none', textAlign: 'right' }}>Clicks</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 90, flex: 'none', textAlign: 'right' }}>Last click</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 150, flex: 'none', textAlign: 'right' }}>Actions</span>
        </div>

        {links.isLoading && [0, 1, 2].map((i) => (
          <div key={i} className="av2-row" role="row" style={{ cursor: 'default' }}><span role="cell" style={{ flex: 1 }}><Skeleton height={30} /></span></div>
        ))}
        {links.isError && <StateRow><ErrorState error={links.error} onRetry={links.refetch} /></StateRow>}
        {!links.isLoading && !links.isError && rows.length === 0 && (
          <StateRow><EmptyState title="No short links" hint="Create one for ads, print, or chat blasts." /></StateRow>
        )}

        {rows.map((l) => {
          const active = isActive(l);
          return (
            <div key={l.id} className="av2-row" style={{ cursor: 'default' }} role="row">
              <span role="cell" style={{ width: 150, flex: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="av2-mono" style={{ fontSize: 12, fontWeight: 600 }}>/share/{l.slug}</span>
                {!active && <Chip tone="warn">expired</Chip>}
              </span>
              <span role="cell" className="av2-mono" style={{ flex: 1.8, fontSize: 10.5, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.targetUrl}>{l.targetUrl}</span>
              <span role="cell" style={{ flex: 1, fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.campaignName || l.campaign?.name || '—'}</span>
              <span role="cell" className="av2-mono" style={{ width: 70, flex: 'none', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{fmtNumber(l.clickCount ?? l.clicks ?? 0)}</span>
              <span role="cell" className="av2-mono" style={{ width: 90, flex: 'none', fontSize: 10.5, color: 'var(--ink-3)', textAlign: 'right' }}>{l.lastClickedAt ? fmtRelative(l.lastClickedAt) : '—'}</span>
              <span role="cell" style={{ width: 150, flex: 'none', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button type="button" className="av2-btn av2-btn--sm" onClick={() => copy(l.slug)}>Copy</button>
                <button type="button" className="av2-btn av2-btn--sm" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }} onClick={() => setConfirmDelete(l)}>Delete</button>
              </span>
            </div>
          );
        })}
      </div>

      <div className="av2-caption" style={{ marginTop: 10 }}>
        Expiry: {`links live ${90} days by default`} — expired slugs stop redirecting but keep their click history here.
      </div>

      {creating && <CreateDialog onClose={() => setCreating(false)} />}

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <AlertDialogContent className="admin-v2" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)' }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: 'var(--ink)' }}>Delete /{confirmDelete?.slug}?</AlertDialogTitle>
            <AlertDialogDescription style={{ color: 'var(--ink-2)' }}>
              Anything printed or posted with this link will dead-end immediately. Click history is removed with it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); remove.mutate(confirmDelete.id); }}
              disabled={remove.isPending}
              style={{ background: 'var(--bad)', color: '#fff' }}
            >
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
