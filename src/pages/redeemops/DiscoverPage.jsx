import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Search from 'lucide-react/icons/search';
import Sparkles from 'lucide-react/icons/sparkles';
import Plus from 'lucide-react/icons/plus';
import X from 'lucide-react/icons/x';
import { RoPageHeader, RoTag } from '@/components/redeemops/ui';
import CategorySelect from '@/components/redeemops/CategorySelect';

const TERMINAL = ['completed', 'failed', 'aborted', 'timed_out'];
const DEDUPE = {
  new: { tone: 'open', label: 'New' },
  possible_duplicate: { tone: 'paused', label: 'Possible dup' },
  existing_partner: { tone: 'archived', label: 'Already a partner' },
};

export default function DiscoverPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ category: '', area: '', limit: '60' });
  const [runId, setRunId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());

  const runQuery = useQuery({
    queryKey: ['redeem-ops', 'discovery', 'run', runId],
    queryFn: () => redeemOpsApi.getDiscoveryRun(runId),
    enabled: !!runId,
    refetchInterval: (query) => (TERMINAL.includes(query.state.data?.run?.status) ? false : 2500),
  });
  const run = runQuery.data?.run;
  const candidates = useMemo(() => runQuery.data?.candidates || [], [runQuery.data]);
  const isSearching = run && !TERMINAL.includes(run.status);

  const startMutation = useMutation({
    mutationFn: () => redeemOpsApi.startDiscovery({
      category: form.category, area: form.area.trim(), limit: Number(form.limit),
    }),
    onSuccess: (r) => { setRunId(r.id); setSelected(new Set()); },
    onError: (err) => toast.error('Could not start search', { description: err.message }),
  });

  const addMutation = useMutation({
    mutationFn: (ids) => redeemOpsApi.addDiscoveryCandidates(runId, ids),
    onSuccess: (res) => {
      toast.success(`Added ${res.added} to pipeline`, {
        description: [res.skipped && `${res.skipped} already partners`, res.failed && `${res.failed} failed`].filter(Boolean).join(' · ') || undefined,
      });
      setSelected(new Set());
      runQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partners'] });
    },
    onError: (err) => toast.error('Could not add', { description: err.message }),
  });

  const enrichMutation = useMutation({
    mutationFn: (ids) => redeemOpsApi.enrichDiscoveryCandidates(ids),
    onSuccess: () => {
      toast.success('Enriching from Instagram — refresh in a moment for followers & bio');
      setSelected(new Set());
      setTimeout(() => runQuery.refetch(), 4000);
    },
    onError: (err) => toast.error('Could not enrich', { description: err.message }),
  });

  const dismissMutation = useMutation({
    mutationFn: (id) => redeemOpsApi.dismissDiscoveryCandidate(id),
    onSuccess: () => runQuery.refetch(),
  });

  const selectable = useMemo(
    () => candidates.filter((c) => c.status === 'pending' && c.dedupeStatus !== 'existing_partner'),
    [candidates],
  );
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const allSelected = selectable.length > 0 && selectable.every((c) => selected.has(c.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map((c) => c.id)));

  const canSearch = form.category && form.area.trim() && !startMutation.isPending;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <RoPageHeader
        title="Discover"
        sub="Find businesses to prospect by category and area, skip the ones you already have, and add the rest to your pipeline in one click."
      />

      <div className="rounded-2xl border border-border bg-white p-4 md:p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <CategorySelect value={form.category} onChange={(v) => setForm((f) => ({ ...f, category: v }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="disc-area">Area</Label>
            <Input
              id="disc-area" value={form.area} placeholder="Tampines"
              onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSearch) startMutation.mutate(); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Results</Label>
            <Select value={form.limit} onValueChange={(v) => setForm((f) => ({ ...f, limit: v }))}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['30', '60', '120'].map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button disabled={!canSearch} onClick={() => startMutation.mutate()}>
            <Search className="w-4 h-4 mr-1.5" aria-hidden="true" />
            {startMutation.isPending ? 'Starting…' : 'Search'}
          </Button>
        </div>
        <p className="text-xs mt-2 m-0" style={{ color: 'var(--ro-text-3)' }}>
          Pulls businesses from Google Maps (~a minute). Instagram handles fill in via Enrich.
        </p>
      </div>

      {isSearching && (
        <div className="rounded-2xl border border-border bg-white p-8 text-center">
          <div className="ro-progress mb-3 max-w-xs mx-auto"><i style={{ width: '60%' }} /></div>
          <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>
            Searching Google Maps for “{run.category} {run.area}”… this takes about a minute.
          </p>
        </div>
      )}

      {run && ['failed', 'aborted', 'timed_out'].includes(run.status) && (
        <div className="rounded-2xl border border-border bg-white p-6 text-center">
          <p className="text-sm m-0" style={{ color: 'var(--ro-tag-red-fg)' }}>
            Search {run.status.replace('_', ' ')} — {run.error || 'no results'}. Try again or narrow the area.
          </p>
        </div>
      )}

      {run?.status === 'completed' && (
        <div className="rounded-2xl border border-border bg-white overflow-hidden">
          <div className="flex items-center gap-3 flex-wrap px-4 py-3 border-b border-border">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={selectable.length === 0} />
              {selected.size > 0 ? `${selected.size} selected` : `${candidates.length} found`}
            </label>
            <span className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={selected.size === 0 || enrichMutation.isPending}
                onClick={() => enrichMutation.mutate([...selected])}>
                <Sparkles className="w-4 h-4 mr-1.5" aria-hidden="true" /> Enrich
              </Button>
              <Button size="sm" disabled={selected.size === 0 || addMutation.isPending}
                onClick={() => addMutation.mutate([...selected])}>
                <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
                {addMutation.isPending ? 'Adding…' : `Add ${selected.size || ''}`.trim()}
              </Button>
            </span>
          </div>

          {candidates.length === 0 && (
            <p className="text-sm text-center py-10 m-0" style={{ color: 'var(--ro-text-2)' }}>
              No businesses found — try a broader area.
            </p>
          )}

          <ul className="m-0 p-0 list-none">
            {candidates.map((c) => {
              const badge = DEDUPE[c.dedupeStatus] || DEDUPE.new;
              const isSelectable = c.status === 'pending' && c.dedupeStatus !== 'existing_partner';
              const meta = [c.area, c.primaryPhone, c.rating && `★ ${c.rating}${c.reviewsCount ? ` (${c.reviewsCount})` : ''}`].filter(Boolean).join(' · ');
              return (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3 border-t border-border first:border-t-0">
                  <input
                    type="checkbox" className="shrink-0"
                    checked={selected.has(c.id)} disabled={!isSelectable}
                    onChange={() => toggle(c.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-[14px] flex items-center gap-2 leading-tight">
                      <span className="truncate">{c.name}</span>
                      {c.status === 'added' && <RoTag tone="completed" size="sm">Added</RoTag>}
                    </span>
                    <span className="block text-xs truncate" style={{ color: 'var(--ro-text-2)' }}>{meta || '—'}</span>
                    {c.instagramHandle && (
                      <span className="block text-[11px] truncate mt-0.5" style={{ color: 'var(--ro-text-3)' }}>
                        @{c.instagramHandle}{c.followersCount != null ? ` · ${c.followersCount.toLocaleString()} followers` : ''}
                      </span>
                    )}
                  </span>
                  {c.dedupeStatus === 'existing_partner' && c.matchedPartnerId ? (
                    <Link to={`/redeem-ops/partners/${c.matchedPartnerId}`} className="shrink-0">
                      <RoTag tone={badge.tone} size="sm">{badge.label}</RoTag>
                    </Link>
                  ) : (
                    <RoTag tone={badge.tone} size="sm" className="shrink-0">{badge.label}</RoTag>
                  )}
                  {isSelectable && (
                    <button
                      type="button" aria-label={`Dismiss ${c.name}`}
                      className="shrink-0 text-[var(--ro-text-3)] hover:text-[var(--ro-bunker)]"
                      onClick={() => dismissMutation.mutate(c.id)}
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
