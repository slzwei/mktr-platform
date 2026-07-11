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
import Check from 'lucide-react/icons/check';
import ChevronRight from 'lucide-react/icons/chevron-right';
import Instagram from 'lucide-react/icons/instagram';
import Star from 'lucide-react/icons/star';
import { RoPageHeader, RoTag, RoAvatar } from '@/components/redeemops/ui';
import CategorySelect from '@/components/redeemops/CategorySelect';

const TERMINAL = ['completed', 'failed', 'aborted', 'timed_out'];
const RUNS_KEY = ['redeem-ops', 'discovery', 'runs'];

const DEDUPE = {
  new: { tone: 'open', label: 'New' },
  possible_duplicate: { tone: 'paused', label: 'Possible dup' },
  existing_partner: { tone: 'archived', label: 'Already a partner' },
};
const SORTS = [
  { v: 'followers', label: 'Followers' },
  { v: 'rating', label: 'Rating' },
  { v: 'reviews', label: 'Reviews' },
  { v: 'name', label: 'Name' },
];
const POPULAR_AREAS = ['Tampines', 'Orchard', 'Jurong East', 'Katong', 'Bedok', 'Serangoon'];
// Curated flavour for the common verticals; anything else falls back gracefully.
const CURATED = {
  'nail salon': { emoji: '💅', note: 'High density, strong IG reach' },
  'facial & beauty': { emoji: '✨', note: 'Premium, high repeat value' },
  'hair salon': { emoji: '💇', note: 'Owner-run, fast to reach' },
  'lashes & brows': { emoji: '👁️', note: 'IG-native, easy yes' },
  'massage & spa': { emoji: '🧖', note: 'Free-trial friendly' },
  barbershop: { emoji: '💈', note: 'Owner-operated, quick yes' },
  café: { emoji: '☕', note: 'High foot traffic' },
  cafe: { emoji: '☕', note: 'High foot traffic' },
  'dessert & bakery': { emoji: '🧁', note: 'Great consumer appeal' },
  'gym & fitness': { emoji: '🏋️', note: 'Trial-offer playbook' },
  'pet grooming': { emoji: '🐾', note: 'Loyal repeat customers' },
};
const num = (v) => (v == null ? -1 : v);
const fmtFollowers = (n) => (n == null ? null : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
const timeAgo = (iso) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export default function DiscoverPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ category: '', area: '', limit: '30' });
  const [runId, setRunId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('followers');

  const listQuery = useQuery({
    queryKey: RUNS_KEY,
    queryFn: () => redeemOpsApi.listDiscoveryRuns(),
    // Recent rows render a live "running…" suffix — poll while any listed run
    // is still in flight so it flips to "N results · $x" without a manual
    // refresh (mirrors runQuery's poll-while-active pattern).
    refetchInterval: (q) => ((q.state.data?.runs || []).some((r) => !TERMINAL.includes(r.status)) ? 5000 : false),
  });
  const recentRuns = listQuery.data?.runs || [];
  const quota = listQuery.data?.quota;
  const categoriesQuery = useQuery({
    queryKey: ['redeem-ops', 'categories'],
    queryFn: () => redeemOpsApi.listCategories(),
    staleTime: 60_000,
  });

  const runQuery = useQuery({
    queryKey: ['redeem-ops', 'discovery', 'run', runId],
    queryFn: () => redeemOpsApi.getDiscoveryRun(runId),
    enabled: !!runId,
    // 2.5s while the search runs; 4s while any enrichment is still pending
    // (enrichment is its own async Apify run that lands ~30s–2min later — without
    // this the results would only ever appear on a manual refresh); off otherwise.
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data?.run) return 2500;
      if (!TERMINAL.includes(data.run.status)) return 2500;
      return (data.candidates || []).some((c) => c.enrichmentStatus === 'pending') ? 4000 : false;
    },
  });
  const run = runQuery.data?.run;
  const candidates = useMemo(() => runQuery.data?.candidates || [], [runQuery.data]);
  const isSearching = run && !TERMINAL.includes(run.status);
  const failed = run && ['failed', 'aborted', 'timed_out'].includes(run.status);

  const counts = useMemo(() => {
    const c = { total: candidates.length, new: 0, partners: 0, possible: 0, ig: 0 };
    for (const x of candidates) {
      if (x.dedupeStatus === 'existing_partner') c.partners += 1;
      else if (x.dedupeStatus === 'possible_duplicate') c.possible += 1;
      else c.new += 1;
      if (x.instagramHandle) c.ig += 1;
    }
    return c;
  }, [candidates]);
  const addedCount = useMemo(() => candidates.filter((c) => c.status === 'added').length, [candidates]);

  const visible = useMemo(() => {
    let list = candidates;
    if (filter === 'new') list = list.filter((c) => c.dedupeStatus === 'new');
    else if (filter === 'partners') list = list.filter((c) => c.dedupeStatus === 'existing_partner');
    else if (filter === 'possible') list = list.filter((c) => c.dedupeStatus === 'possible_duplicate');
    else if (filter === 'ig') list = list.filter((c) => c.instagramHandle);
    const sorted = [...list];
    if (sort === 'name') sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else sorted.sort((a, b) => num(b[sort === 'followers' ? 'followersCount' : sort === 'rating' ? 'rating' : 'reviewsCount'])
      - num(a[sort === 'followers' ? 'followersCount' : sort === 'rating' ? 'rating' : 'reviewsCount']));
    return sorted;
  }, [candidates, filter, sort]);

  const selectableIds = useMemo(
    () => visible.filter((c) => c.status === 'pending' && c.dedupeStatus !== 'existing_partner').map((c) => c.id),
    [visible],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const suggestions = useMemo(() => {
    const cats = (categoriesQuery.data || []).map((c) => c.name);
    return cats.slice(0, 6).map((cat, i) => {
      const meta = CURATED[cat.toLowerCase()] || { emoji: '📍', note: 'Prospect this vertical' };
      return { category: cat, area: POPULAR_AREAS[i % POPULAR_AREAS.length], ...meta };
    });
  }, [categoriesQuery.data]);

  // ── Mutations ──────────────────────────────────────────────────────────
  const startMutation = useMutation({
    mutationFn: (body) => redeemOpsApi.startDiscovery(body),
    onSuccess: (r) => {
      setRunId(r.id); setSelected(new Set()); setFilter('all'); setSort('followers');
      queryClient.invalidateQueries({ queryKey: RUNS_KEY });
    },
    onError: (err) => toast.error('Could not start search', { description: err.message }),
  });
  const addMutation = useMutation({
    mutationFn: (ids) => redeemOpsApi.addDiscoveryCandidates(runId, ids),
    onSuccess: (res) => {
      toast.success(`Added ${res.added} to pipeline`, {
        description: [
          res.skipped && `${res.skipped} already partners`,
          res.failed && `${res.failed} failed`,
          res.notFound && `${res.notFound} no longer in this search`,
        ].filter(Boolean).join(' · ') || undefined,
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
      toast.success('Enriching from Instagram — followers & bio fill in shortly');
      runQuery.refetch(); // shows the new pending states → the poll takes over
    },
    onError: (err) => toast.error('Could not enrich', { description: err.message }),
  });
  const restoreMutation = useMutation({
    mutationFn: (id) => redeemOpsApi.restoreDiscoveryCandidate(id),
    onSuccess: () => runQuery.refetch(),
  });
  const dismissMutation = useMutation({
    mutationFn: (id) => redeemOpsApi.dismissDiscoveryCandidate(id),
    onSuccess: (_res, id) => {
      runQuery.refetch();
      toast('Dismissed', { action: { label: 'Undo', onClick: () => restoreMutation.mutate(id) } });
    },
  });

  const runSearch = (category, area, limit = 30) => {
    if (!category || !String(area).trim()) return;
    setForm({ category, area, limit: String(limit) });
    startMutation.mutate({ category, area: String(area).trim(), limit: Number(limit) });
  };
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableIds));
  const enrichAll = () => {
    const ids = candidates
      .filter((c) => c.instagramHandle && !['enriched', 'pending'].includes(c.enrichmentStatus) && c.status !== 'dismissed')
      .map((c) => c.id);
    if (ids.length === 0) { toast.info('Nothing to enrich — no un-enriched Instagram handles'); return; }
    enrichMutation.mutate(ids);
  };
  const canSearch = form.category && form.area.trim() && !startMutation.isPending;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6 pb-24">
      <RoPageHeader
        title="Discover"
        sub="Find businesses to prospect by category and area — deduped against your partners, one click to your pipeline."
        actions={quota && (
          <span className="hidden sm:inline-flex items-center gap-2 text-[12.5px] font-semibold rounded-full px-3 py-1.5"
            style={{ color: 'var(--ro-text-2)', background: 'var(--ro-subtle)', border: '1px solid var(--ro-border)' }}>
            <i className="w-[7px] h-[7px] rounded-full" style={{ background: quota.remaining > 0 ? 'var(--ro-tag-green-fg)' : 'var(--ro-tag-red-fg)' }} />
            <b style={{ color: 'var(--ro-bunker)' }}>{quota.used}</b> of {quota.limit} searches today
          </span>
        )}
      />

      {/* ── First-run: search + suggested + recent ───────────────────────── */}
      {!runId && (
        <>
          <div className="rounded-2xl border border-border bg-white p-4 md:p-5">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_120px_auto] md:items-end">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <CategorySelect value={form.category} onChange={(v) => setForm((f) => ({ ...f, category: v }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="disc-area">Area</Label>
                <Input id="disc-area" value={form.area} placeholder="Neighbourhood or district…"
                  onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canSearch) runSearch(form.category, form.area, form.limit); }} />
              </div>
              <div className="space-y-1.5">
                <Label>Results</Label>
                <Select value={form.limit} onValueChange={(v) => setForm((f) => ({ ...f, limit: v }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{['30', '60', '120', '300', '500'].map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button disabled={!canSearch} onClick={() => runSearch(form.category, form.area, form.limit)}>
                <Search className="w-4 h-4 mr-1.5" aria-hidden="true" />{startMutation.isPending ? 'Starting…' : 'Search'}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="text-xs font-semibold" style={{ color: 'var(--ro-text-3)' }}>Popular areas</span>
              {POPULAR_AREAS.map((a) => (
                <button key={a} type="button" onClick={() => setForm((f) => ({ ...f, area: a }))}
                  className="h-7 px-3 rounded-full text-[12.5px] font-semibold"
                  style={{ background: 'var(--ro-subtle)', border: '1px solid var(--ro-border)', color: 'var(--ro-text-2)' }}>{a}</button>
              ))}
              {quota?.costPerResultUsd > 0 && (
                <span className="ml-auto text-[12px]" style={{ color: 'var(--ro-text-3)' }}>
                  ≈ ${(Number(form.limit) * quota.costPerResultUsd).toFixed(2)} per search
                </span>
              )}
            </div>
          </div>

          {suggestions.length > 0 && (
            <div>
              <h2 className="text-[13px] font-bold mb-3" style={{ color: 'var(--ro-text-2)' }}>Suggested searches</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {suggestions.map((s) => (
                  // Prefill only — Search (with its cost hint) is the single spend
                  // affordance; a one-tap card must never fire a paid run.
                  <button key={`${s.category}-${s.area}`} type="button"
                    onClick={() => setForm({ category: s.category, area: s.area, limit: '60' })}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-white p-4 text-left hover:bg-[var(--ro-subtle)]">
                    <span className="w-10 h-10 rounded-xl grid place-items-center text-lg shrink-0" style={{ background: 'var(--ro-subtle)' }}>{s.emoji}</span>
                    <span className="min-w-0">
                      <b className="text-[14px] block truncate">{s.category} · {s.area}</b>
                      <span className="text-[12.5px]" style={{ color: 'var(--ro-text-3)' }}>{s.note}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 ml-auto shrink-0" style={{ color: 'var(--ro-text-3)' }} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {recentRuns.length > 0 && (
            <div>
              <h2 className="text-[13px] font-bold mb-3" style={{ color: 'var(--ro-text-2)' }}>Recent searches</h2>
              <div className="rounded-2xl border border-border bg-white overflow-hidden">
                {recentRuns.map((r) => (
                  <button key={r.id} type="button" onClick={() => { setRunId(r.id); setSelected(new Set()); setFilter('all'); }}
                    className="w-full flex items-center gap-3.5 px-4 py-3 border-t border-border first:border-t-0 text-left hover:bg-[var(--ro-subtle)]">
                    <span className="w-[34px] h-[34px] rounded-[10px] grid place-items-center shrink-0" style={{ background: 'var(--ro-azure-tint)', color: 'var(--ro-azure)' }}>
                      <Search className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <b className="text-[14px] block truncate">{r.category} · {r.area}</b>
                      <span className="text-[12.5px]" style={{ color: 'var(--ro-text-3)' }}>
                        {timeAgo(r.createdAt)} · {r.resultCount || 0} result{r.resultCount === 1 ? '' : 's'}
                        {r.actualCostUsd != null && ` · $${Number(r.actualCostUsd).toFixed(2)}`}
                        {!TERMINAL.includes(r.status) && ' · running…'}
                      </span>
                    </span>
                    <span className="ml-auto text-[12.5px] font-semibold shrink-0" style={{ color: 'var(--ro-text-2)' }}>Open results ›</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Active run: query bar ─────────────────────────────────────────── */}
      {runId && (
        <div className="flex items-center gap-2 flex-wrap rounded-2xl border border-border bg-white px-4 py-3">
          {[
            ['Category', run?.category], ['Area', run?.area], ['Results', run?.requestedLimit],
            ...(run?.actualCostUsd != null ? [['Cost', `$${Number(run.actualCostUsd).toFixed(2)}`]] : []),
          ].map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full text-[13.5px] font-semibold" style={{ border: '1px solid var(--ro-border-strong)' }}>
              <span style={{ color: 'var(--ro-text-3)', fontWeight: 500 }}>{k}</span> {v ?? '—'}
            </span>
          ))}
          <button type="button" onClick={() => setRunId(null)}
            className="ml-auto h-9 px-4 rounded-full text-[13px] font-semibold" style={{ border: '1px solid var(--ro-border-strong)', background: '#fff' }}>New search</button>
        </div>
      )}

      {/* Searching — skeleton */}
      {isSearching && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span className="w-[18px] h-[18px] rounded-full animate-spin" style={{ border: '2.4px solid var(--ro-azure-tint)', borderTopColor: 'var(--ro-azure)' }} />
            <b className="text-[15px]">Searching Google Maps…</b>
            <span className="hidden sm:inline text-[13px]" style={{ color: 'var(--ro-text-2)' }}>
              {run?.requestedLimit > 120 ? 'large search — usually 2–6 minutes' : 'usually 30–60 seconds'} · you can keep working other tabs
            </span>
          </div>
          <div className="rounded-2xl border border-border bg-white overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 border-t border-border first:border-t-0" style={{ height: 64 }}>
                <span className="ro-sk" style={{ width: 19, height: 19, borderRadius: 6 }} />
                <span className="ro-sk" style={{ width: 38, height: 38, borderRadius: 11 }} />
                <span className="flex flex-col gap-2 flex-1">
                  <span className="ro-sk" style={{ width: `${40 + (i % 3) * 12}%`, height: 12 }} />
                  <span className="ro-sk" style={{ width: '90px', height: 10 }} />
                </span>
                <span className="ro-sk" style={{ width: 120, height: 12 }} />
                <span className="ro-sk" style={{ width: 60, height: 22, borderRadius: 8 }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {failed && (
        <div className="rounded-2xl border border-border bg-white p-6 text-center">
          <p className="text-sm m-0" style={{ color: 'var(--ro-tag-red-fg)' }}>
            Search {run.status.replace('_', ' ')} — {run.error || 'no results'}. Try again or narrow the area.
          </p>
        </div>
      )}

      {/* Completed — results */}
      {run?.status === 'completed' && (
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-3.5">
            {selectableIds.length > 0 && (
              <button type="button" aria-label={allSelected ? 'Clear selection' : 'Select all'} onClick={toggleAll}
                className="w-[19px] h-[19px] rounded-md grid place-items-center shrink-0"
                style={{ border: allSelected ? '1.8px solid var(--ro-azure)' : '1.8px solid var(--ro-border-strong)', background: allSelected ? 'var(--ro-azure)' : '#fff' }}>
                {allSelected && <Check className="w-3 h-3" style={{ color: '#fff' }} strokeWidth={3} aria-hidden="true" />}
              </button>
            )}
            <span className="text-[15px] font-bold mr-1">{selected.size > 0 ? `${selected.size} selected` : `${counts.total} found`}</span>
            <Seg on={filter === 'all'} onClick={() => setFilter('all')}>All <b className="tabular-nums">{counts.total}</b></Seg>
            <Seg on={filter === 'new'} onClick={() => setFilter('new')} dot="var(--ro-tag-blue-fg)">New <b className="tabular-nums">{counts.new}</b></Seg>
            <Seg on={filter === 'partners'} onClick={() => setFilter('partners')} dot="var(--ro-tag-gray-fg)">Partners <b className="tabular-nums">{counts.partners}</b></Seg>
            {counts.possible > 0 && <Seg on={filter === 'possible'} onClick={() => setFilter('possible')} dot="var(--ro-tag-yellow-fg)">Possible dup <b className="tabular-nums">{counts.possible}</b></Seg>}
            <Seg on={filter === 'ig'} onClick={() => setFilter('ig')}>Has Instagram <b className="tabular-nums">{counts.ig}</b></Seg>
            <span className="flex-1" />
            <button type="button" onClick={enrichAll} disabled={enrichMutation.isPending}
              className="inline-flex items-center gap-2 h-8 px-3.5 rounded-full text-[13px] font-semibold"
              style={{ border: '1px solid var(--ro-azure)', background: 'var(--ro-azure-tint)', color: 'var(--ro-azure-dark)' }}>
              <Sparkles className="w-[15px] h-[15px]" aria-hidden="true" />Enrich all with Instagram
            </button>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="w-auto h-8 gap-1.5"><span style={{ color: 'var(--ro-text-3)' }}>Sort</span><SelectValue /></SelectTrigger>
              <SelectContent>{SORTS.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="rounded-2xl border border-border bg-white overflow-hidden">
            {visible.length === 0 && (
              <p className="text-sm text-center py-10 m-0" style={{ color: 'var(--ro-text-2)' }}>
                {counts.total === 0 ? 'No businesses found — try a broader area.' : 'Nothing in this filter.'}
              </p>
            )}
            {visible.map((c) => {
              const badge = DEDUPE[c.dedupeStatus] || DEDUPE.new;
              const selectable = c.status === 'pending' && c.dedupeStatus !== 'existing_partner';
              const isSel = selected.has(c.id);
              const isPartner = c.dedupeStatus === 'existing_partner';
              return (
                <div key={c.id}
                  className={`grid items-center gap-2 md:gap-3 px-3 md:px-4 border-t border-border first:border-t-0 relative ${isSel ? 'bg-[var(--ro-azure-tint)]' : ''} ${isPartner ? 'opacity-55' : ''}`}
                  style={{ gridTemplateColumns: '26px minmax(0,2.3fr) 0.9fr 1.5fr auto', minHeight: 64 }}>
                  {isSel && <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: 'var(--ro-azure)' }} />}
                  <button type="button" aria-label={selectable ? `Select ${c.name}` : undefined} disabled={!selectable}
                    onClick={() => selectable && toggle(c.id)}
                    className="w-[19px] h-[19px] rounded-md grid place-items-center shrink-0"
                    style={{ border: isSel ? '1.8px solid var(--ro-azure)' : '1.8px solid var(--ro-border-strong)', background: isSel ? 'var(--ro-azure)' : '#fff', opacity: selectable ? 1 : 0.4 }}>
                    {isSel && <Check className="w-3 h-3" style={{ color: '#fff' }} strokeWidth={3} aria-hidden="true" />}
                  </button>
                  <span className="flex items-center gap-3 min-w-0">
                    <RoAvatar name={c.name} size={38} />
                    <span className="min-w-0">
                      <b className="text-[14px] font-semibold block leading-tight flex items-center gap-2">
                        <span className="truncate">{c.name}</span>
                        {c.status === 'added' && (c.addedPartnerId
                          ? <Link to={`/redeem-ops/partners/${c.addedPartnerId}`}><RoTag tone="completed" size="sm">Added ›</RoTag></Link>
                          : <RoTag tone="completed" size="sm">Added</RoTag>)}
                      </b>
                      <span className="text-[12.5px] block truncate" style={{ color: 'var(--ro-text-2)' }}>
                        {/* Google's own category label first — makes weak matches
                            (e.g. "Discount store" for a Pet Grooming search)
                            self-evident without leaving the list. */}
                        {[c.rawPayload?.categoryName, c.area, c.primaryPhone].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </span>
                  </span>
                  <span className="text-[13px] font-semibold tabular-nums hidden sm:flex items-center gap-1.5">
                    {c.rating != null ? (
                      c.sourceUrl ? (
                        <a href={c.sourceUrl} target="_blank" rel="noreferrer" title="Open on Google Maps"
                          className="flex items-center gap-1.5 hover:underline" style={{ color: 'inherit' }}>
                          <Star className="w-3.5 h-3.5" style={{ fill: '#F5A623', stroke: 'none' }} aria-hidden="true" />
                          {c.rating}
                          <span style={{ color: 'var(--ro-text-3)', fontWeight: 500 }}>{c.reviewsCount ? `(${c.reviewsCount})` : ''}</span>
                        </a>
                      ) : (
                        <>
                          <Star className="w-3.5 h-3.5" style={{ fill: '#F5A623', stroke: 'none' }} aria-hidden="true" />
                          {c.rating}
                          <span style={{ color: 'var(--ro-text-3)', fontWeight: 500 }}>{c.reviewsCount ? `(${c.reviewsCount})` : ''}</span>
                        </>
                      )
                    ) : <span style={{ color: 'var(--ro-text-3)' }}>—</span>}
                  </span>
                  <span className="hidden md:flex items-center gap-2 text-[13px] min-w-0">
                    {c.instagramHandle ? (
                      <>
                        <a href={`https://instagram.com/${c.instagramHandle}`} target="_blank" rel="noreferrer"
                          title="Open Instagram profile"
                          className="ro-ig-badge w-[26px] h-[26px] rounded-lg grid place-items-center shrink-0">
                          <Instagram className="w-[15px] h-[15px]" style={{ color: '#fff' }} aria-hidden="true" />
                        </a>
                        <span className="truncate" style={{ color: 'var(--ro-text-2)' }}>
                          <a href={`https://instagram.com/${c.instagramHandle}`} target="_blank" rel="noreferrer"
                            title="Open Instagram profile" className="hover:underline" style={{ color: 'inherit' }}>
                            @{c.instagramHandle}
                          </a>
                          {c.isVerified && <span title="Verified on Instagram" style={{ color: 'var(--ro-azure)' }}> ✓</span>}
                          {c.followersCount != null ? ' ·' : ''}
                        </span>
                        {c.followersCount != null
                          ? <b className="tabular-nums" style={{ color: c.followersCount >= 10000 ? 'var(--ro-tag-purple-fg)' : 'var(--ro-bunker)' }}>{fmtFollowers(c.followersCount)}</b>
                          : c.enrichmentStatus === 'pending'
                            ? (
                              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold shrink-0" style={{ color: 'var(--ro-text-3)' }}>
                                <span className="w-3 h-3 rounded-full animate-spin shrink-0" style={{ border: '2px solid var(--ro-azure-tint)', borderTopColor: 'var(--ro-azure)' }} />
                                Enriching…
                              </span>
                            )
                            : c.enrichmentStatus === 'failed'
                              ? selectable && (
                                <button type="button" onClick={() => enrichMutation.mutate([c.id])}
                                  className="ro-link text-[12px] font-semibold" style={{ color: 'var(--ro-tag-red-fg)' }}>
                                  Enrich failed · retry
                                </button>
                              )
                              : selectable && <button type="button" onClick={() => enrichMutation.mutate([c.id])} className="ro-link text-[12px] font-semibold">followers?</button>}
                      </>
                    ) : <span className="text-[12.5px]" style={{ color: 'var(--ro-text-3)' }}>No Instagram</span>}
                  </span>
                  <span className="justify-self-end flex items-center gap-2">
                    {c.matchedPartnerId && c.dedupeStatus !== 'new'
                      ? <Link to={`/redeem-ops/partners/${c.matchedPartnerId}`}><RoTag tone={badge.tone} size="sm">{badge.label} ›</RoTag></Link>
                      : <RoTag tone={badge.tone} size="sm">{badge.label}</RoTag>}
                    {selectable && (
                      <button type="button" aria-label={`Dismiss ${c.name}`} onClick={() => dismissMutation.mutate(c.id)}
                        className="shrink-0" style={{ color: 'var(--ro-text-3)' }}><X className="w-4 h-4" aria-hidden="true" /></button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          {counts.total > 0 && run?.requestedLimit >= 30 && counts.total < Math.ceil(run.requestedLimit * 0.25) && (
            <p className="text-[12px] mt-2 mb-0" style={{ color: 'var(--ro-text-2)' }}>
              Google found only {counts.total} match{counts.total === 1 ? '' : 'es'} in this area — small central
              districts (like Orchard) genuinely have few of some business types. Try a broader or neighbouring
              area, and check each row&apos;s category label for weak matches.
            </p>
          )}
          <p className="text-[11.5px] mt-2 mb-0" style={{ color: 'var(--ro-text-3)' }}>
            Phone numbers are reference data — keep outreach IG-first; calls/SMS must respect the DNC registry.
          </p>
        </div>
      )}

      {/* Sticky bulk-add dock */}
      {selected.size > 0 && (
        <div className="ro-dock flex items-center gap-3 px-4 md:px-8 py-3">
          <span className="w-[22px] h-[22px] rounded-md grid place-items-center shrink-0" style={{ background: 'var(--ro-azure)' }}>
            <Check className="w-3.5 h-3.5" style={{ color: '#fff' }} strokeWidth={3} aria-hidden="true" />
          </span>
          <b className="text-[14px]">{selected.size} selected</b>
          <button type="button" className="text-[13px] font-semibold underline" style={{ color: 'var(--ro-text-2)' }} onClick={() => setSelected(new Set())}>Clear</button>
          {addedCount > 0 && <span className="hidden sm:inline text-[12.5px]" style={{ color: 'var(--ro-text-3)' }}>· {addedCount} added this search</span>}
          <span className="flex-1" />
          <Button variant="outline" size="sm" disabled={enrichMutation.isPending} onClick={() => enrichMutation.mutate([...selected])}>
            <Sparkles className="w-4 h-4 mr-1.5" aria-hidden="true" />Enrich
          </Button>
          <Button size="sm" disabled={addMutation.isPending} onClick={() => addMutation.mutate([...selected])}>
            <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />{addMutation.isPending ? 'Adding…' : `Add ${selected.size} to pipeline`}
          </Button>
        </div>
      )}
    </div>
  );
}

function Seg({ on, onClick, dot, children }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-semibold"
      style={on
        ? { background: 'var(--ro-bunker)', color: '#fff', border: '1px solid var(--ro-bunker)' }
        : { background: '#fff', color: 'var(--ro-text-2)', border: '1px solid var(--ro-border-strong)' }}>
      {dot && <span className="w-2 h-2 rounded-full" style={{ background: dot }} />}
      {children}
    </button>
  );
}
