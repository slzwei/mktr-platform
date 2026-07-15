/**
 * Switchboard QR Codes — every tag with scans/unique/last-scan and its bound
 * campaign. Create keeps to the simple promotional flow (label + campaign);
 * car/agent-bound generation stays on the specialist legacy flows. Downloads
 * fetch the image WITH auth (the endpoint requires a bearer token, so a plain
 * link can't work).
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@/api/client';
import { useCampaignLeaderboard } from '@/hooks/queries/useAdminV2';
import { fmtNumber, fmtRelative } from '@/lib/adminV2/format';
import { Chip, PageHeader, Skeleton, ErrorState, EmptyState } from '@/components/adminv2/primitives';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const fetchQrTags = async ({ search, campaignId }) => {
  const qs = new URLSearchParams({ limit: '200' });
  if (search) qs.set('search', search);
  if (campaignId) qs.set('campaignId', campaignId);
  const resp = await apiClient.get(`/qrcodes?${qs.toString()}`);
  const data = resp?.data ?? {};
  return { rows: data.qrTags || [], total: data.pagination?.totalItems ?? (data.qrTags || []).length };
};

async function downloadQr(tag) {
  // The download endpoint is auth-gated — fetch with the bearer token and
  // hand the blob to the browser (a bare <a href> would 401).
  const token = apiClient.getToken?.() || localStorage.getItem('mktr_auth_token');
  const base = import.meta.env.VITE_API_URL || '/api';
  const res = await fetch(`${base}/qrcodes/${tag.id}/download`, {
    headers: token && token !== 'authenticated' ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(tag.name || tag.slug || 'qr').replace(/[^\w-]+/g, '-')}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function CreateDialog({ campaigns, onClose }) {
  const [label, setLabel] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () => apiClient.post('/qrcodes', {
      label: label.trim(),
      type: 'promotional',
      ...(campaignId ? { campaignId } : {}),
    }),
    onSuccess: () => {
      toast.success('QR code created');
      queryClient.invalidateQueries({ queryKey: ['adminV2', 'qrTags'] });
      onClose();
    },
    onError: (e) => toast.error(e?.message || 'Create failed'),
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !create.isPending) onClose(); }}>
      <DialogContent className="admin-v2" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', maxWidth: 460 }}>
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--ink)', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, textAlign: 'left' }}>New promotional QR</DialogTitle>
          <DialogDescription style={{ color: 'var(--ink-2)', fontSize: 11.5, textAlign: 'left' }}>
            The image bakes the campaign’s customer host at creation. Car-bound and agent-routed QRs stay on the specialist flows.
          </DialogDescription>
        </DialogHeader>
        <label style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          <span className="av2-microcaps">Label</span>
          <input className="av2-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. MALL-JEM-B1 standee" />
        </label>
        <label style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
          <span className="av2-microcaps">Campaign</span>
          <select className="av2-input" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ appearance: 'auto' }}>
            <option value="">No campaign (bind later)</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="av2-btn" disabled={create.isPending} onClick={onClose}>Cancel</button>
          <button type="button" className="av2-btn av2-btn--primary" disabled={!label.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create QR'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminV2QRCodes() {
  const [search, setSearch] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState('');

  const tags = useQuery({
    queryKey: ['adminV2', 'qrTags', { search, campaignFilter }],
    queryFn: () => fetchQrTags({ search, campaignId: campaignFilter }),
    staleTime: 30_000,
    keepPreviousData: true,
  });
  const campaigns = useCampaignLeaderboard('30d');
  const campaignOptions = useMemo(
    () => (campaigns.data?.rows || []).filter((c) => c.status !== 'archived').map((c) => ({ id: c.id, name: c.name })),
    [campaigns.data]
  );

  const rows = useMemo(
    () => [...(tags.data?.rows || [])].sort((a, b) => (b.scanCount || 0) - (a.scanCount || 0)),
    [tags.data]
  );

  const handleDownload = async (tag) => {
    setDownloading(tag.id);
    try {
      await downloadQr(tag);
    } catch (e) {
      toast.error(e?.message || 'Download failed');
    } finally {
      setDownloading('');
    }
  };

  return (
    <div>
      <PageHeader title="QR Codes" meta={`${fmtNumber(tags.data?.total ?? 0)} TAGS${(tags.data?.total ?? 0) > rows.length && rows.length > 0 ? ` · SHOWING FIRST ${fmtNumber(rows.length)}` : ''} · SORTED BY SCANS (LIFETIME)`}>
        <button type="button" className="av2-btn av2-btn--primary" onClick={() => setCreating(true)}>+ New QR</button>
      </PageHeader>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="av2-input" style={{ maxWidth: 300 }}>
          <span aria-hidden="true" style={{ color: 'var(--ink-3)' }}>⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search label"
            aria-label="Search QR tags"
            style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, font: 'inherit', color: 'inherit' }}
          />
        </div>
        <select
          className="av2-input"
          style={{ maxWidth: 260, appearance: 'auto' }}
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          aria-label="Filter by campaign"
        >
          <option value="">All campaigns</option>
          {campaignOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="av2-card" style={{ overflow: 'hidden' }} role="grid" aria-label="QR tags">
        <div className="av2-thead" role="row">
          <span className="av2-microcaps" role="columnheader" style={{ flex: 1.4 }}>Tag</span>
          <span className="av2-microcaps" role="columnheader" style={{ flex: 1 }}>Campaign</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 80, flex: 'none', textAlign: 'right' }}>Scans</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 80, flex: 'none', textAlign: 'right' }}>Unique</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 90, flex: 'none', textAlign: 'right' }}>Last scan</span>
          <span className="av2-microcaps" role="columnheader" style={{ width: 160, flex: 'none', textAlign: 'right' }}>Actions</span>
        </div>

        {tags.isLoading && [0, 1, 2, 3].map((i) => (
          <div key={i} className="av2-row" style={{ cursor: 'default' }}><Skeleton height={30} /></div>
        ))}
        {tags.isError && <ErrorState error={tags.error} onRetry={tags.refetch} />}
        {!tags.isLoading && !tags.isError && rows.length === 0 && (
          <EmptyState title="No QR tags match" hint="Create one, or clear the filters." />
        )}

        {rows.map((t) => (
          <div key={t.id} className="av2-row" style={{ cursor: 'default' }} role="row">
            <span role="gridcell" style={{ flex: 1.4, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name || t.label || t.slug}</span>
                {t.active === false && <Chip tone="warn">inactive</Chip>}
                {t.targetHost === 'mktr' && <Chip tone="accent">mktr.sg</Chip>}
              </span>
              {t.slug && <span className="av2-mono" style={{ display: 'block', fontSize: 10, color: 'var(--ink-3)' }}>/t/{t.slug}</span>}
            </span>
            <span role="gridcell" style={{ flex: 1, fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.campaign?.name || '—'}</span>
            <span role="gridcell" className="av2-mono" style={{ width: 80, flex: 'none', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{fmtNumber(t.scanCount || 0)}</span>
            <span role="gridcell" className="av2-mono" style={{ width: 80, flex: 'none', fontSize: 11, color: 'var(--ink-2)', textAlign: 'right' }}>{fmtNumber(t.uniqueScanCount || 0)}</span>
            <span role="gridcell" className="av2-mono" style={{ width: 90, flex: 'none', fontSize: 10.5, color: 'var(--ink-3)', textAlign: 'right' }}>{t.lastScanned ? fmtRelative(t.lastScanned) : '—'}</span>
            <span role="gridcell" style={{ width: 160, flex: 'none', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button type="button" className="av2-btn av2-btn--sm" disabled={downloading === t.id} onClick={() => handleDownload(t)}>
                {downloading === t.id ? 'Fetching…' : 'Download'}
              </button>
            </span>
          </div>
        ))}
      </div>

      {creating && <CreateDialog campaigns={campaignOptions} onClose={() => setCreating(false)} />}
    </div>
  );
}
