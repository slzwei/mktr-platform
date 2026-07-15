import { useState, useMemo, useEffect } from 'react';
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
import MapPin from 'lucide-react/icons/map-pin';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { RoPageHeader, RoTag, RoAvatar } from '@/components/redeemops/ui';

const TERMINAL = ['completed', 'failed', 'aborted', 'timed_out'];
const RUNS_KEY = ['redeem-ops', 'discovery', 'runs'];
const ALL_SINGAPORE = 'All Singapore';
const IG_PROVIDER = 'instagram_hashtag';
const IG_RUN_PROVIDER = 'apify_instagram_hashtag';
// Home-based / mobile is the Maps-invisible segment IG discovery exists to reach.
// Signal lives in the account name, the (enriched) bio, or the sampled caption.
const igText = (c) => `${c.name || ''} ${c.bio || ''} ${c.rawPayload?.caption || ''}`;
const isHomeBased = (c) => /home[\s-]?based|\bmobile\b/i.test(igText(c));

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
const MINSTAR_LABEL = { three: '3.0★+', threeAndHalf: '3.5★+', four: '4.0★+' };
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
// The exact query a run fired: #hashtags (IG) or comma-joined terms (Maps).
// Runs created before terms were snapshotted return null → callers fall back
// to the category.
const searchTermsOf = (r) => {
  const tags = r?.rawPayload?.hashtags;
  if (Array.isArray(tags) && tags.length) return tags.map((t) => `#${t}`).join(' ');
  const terms = r?.rawPayload?.searchTerms;
  if (Array.isArray(terms) && terms.length) return terms.join(', ');
  return null;
};
const timeAgo = (iso) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export default function DiscoverPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    area: '', limit: '30', provider: 'google_maps',
    adhoc: '', minStars: 'any', skipClosed: true, filterWords: '',
  });
  const [runId, setRunId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('followers');
  const [aiDesc, setAiDesc] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showAi, setShowAi] = useState(false);
  // AI-suggested Google categories (Maps) — fill the pre-search filter AND arm a
  // one-time post-results facet cleanup for the run they were searched into.
  const [aiCats, setAiCats] = useState([]);
  const [aiArmedRunId, setAiArmedRunId] = useState(null);
  // Post-search category facet — Google categories the operator has hidden from
  // the current results (client-side only; the paid rows were already fetched).
  const [hiddenCats, setHiddenCats] = useState(() => new Set());

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
  const resultsQuota = quota?.resultsRemaining != null;
  const igEnabled = listQuery.data?.igEnabled === true;
  const aiEnabled = listQuery.data?.aiEnabled === true;
  const isIg = form.provider === IG_PROVIDER;
  const categoriesQuery = useQuery({
    queryKey: ['redeem-ops', 'categories'],
    queryFn: () => redeemOpsApi.listCategories(),
    staleTime: 60_000,
  });
  const territoriesQuery = useQuery({
    queryKey: ['redeem-ops', 'territories'],
    queryFn: () => redeemOpsApi.listTerritories(),
    staleTime: 60_000,
  });
  const territoriesEnabled = territoriesQuery.isSuccess && territoriesQuery.data.enabled;
  const territoryNames = (territoriesQuery.data?.territories || []).map((territory) => territory.name);
  const customArea = form.area
    && form.area !== ALL_SINGAPORE
    && !territoryNames.includes(form.area)
    ? form.area
    : null;

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
  const isIgRun = run?.provider === IG_RUN_PROVIDER;
  const runTerms = searchTermsOf(run);
  const candidates = useMemo(() => runQuery.data?.candidates || [], [runQuery.data]);
  const isSearching = run && !TERMINAL.includes(run.status);
  const failed = run && ['failed', 'aborted', 'timed_out'].includes(run.status);

  const counts = useMemo(() => {
    // total = visible (non-dismissed); hidden = dismissed (memory auto-hides +
    // manual); materialized = everything the run produced (drives the sparse
    // hint so memory-hiding can't fake a sparse area).
    const c = { total: 0, hidden: 0, new: 0, partners: 0, possible: 0, seen: 0, ig: 0, homebased: 0, materialized: candidates.length };
    for (const x of candidates) {
      if (x.status === 'dismissed') { c.hidden += 1; continue; }
      c.total += 1;
      if (x.dedupeStatus === 'existing_partner') c.partners += 1;
      else if (x.dedupeStatus === 'possible_duplicate') c.possible += 1;
      else if (x.previouslySeenAt) c.seen += 1;
      else c.new += 1;
      if (x.instagramHandle) c.ig += 1;
      if (isHomeBased(x)) c.homebased += 1;
    }
    return c;
  }, [candidates]);
  const addedCount = useMemo(() => candidates.filter((c) => c.status === 'added').length, [candidates]);

  // Distinct Google categories in the live results + how many the operator hid
  // (Maps only — IG candidates carry no Google categoryName). Drives the facet.
  const catFacet = useMemo(() => {
    if (isIgRun) return [];
    const m = new Map();
    for (const c of candidates) {
      if (c.status === 'dismissed') continue;
      const cat = c.rawPayload?.categoryName;
      if (cat) m.set(cat, (m.get(cat) || 0) + 1);
    }
    return [...m.entries()].map(([cat, count]) => ({ cat, count })).sort((a, b) => b.count - a.count);
  }, [candidates, isIgRun]);
  const catHidden = useMemo(
    () => (isIgRun || !hiddenCats.size ? 0
      : candidates.filter((c) => c.status !== 'dismissed' && hiddenCats.has(c.rawPayload?.categoryName)).length),
    [candidates, hiddenCats, isIgRun],
  );

  const visible = useMemo(() => {
    let list = candidates;
    if (filter === 'hidden') list = list.filter((c) => c.status === 'dismissed');
    else list = list.filter((c) => c.status !== 'dismissed');
    if (filter === 'new') list = list.filter((c) => c.dedupeStatus === 'new' && !c.previouslySeenAt);
    else if (filter === 'seen') list = list.filter((c) => c.dedupeStatus === 'new' && c.previouslySeenAt);
    else if (filter === 'partners') list = list.filter((c) => c.dedupeStatus === 'existing_partner');
    else if (filter === 'possible') list = list.filter((c) => c.dedupeStatus === 'possible_duplicate');
    else if (filter === 'ig') list = list.filter((c) => c.instagramHandle);
    else if (filter === 'homebased') list = list.filter(isHomeBased);
    // Post-search category facet (Maps only) — hide unchecked Google categories.
    if (!isIgRun && hiddenCats.size) list = list.filter((c) => !hiddenCats.has(c.rawPayload?.categoryName));
    const sorted = [...list];
    if (sort === 'name') sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else sorted.sort((a, b) => num(b[sort === 'followers' ? 'followersCount' : sort === 'rating' ? 'rating' : 'reviewsCount'])
      - num(a[sort === 'followers' ? 'followersCount' : sort === 'rating' ? 'rating' : 'reviewsCount']));
    return sorted;
  }, [candidates, filter, sort, hiddenCats, isIgRun]);

  const selectableIds = useMemo(
    () => visible.filter((c) => c.status === 'pending' && c.dedupeStatus !== 'existing_partner').map((c) => c.id),
    [visible],
  );
  // Prune stale selections (a row dismissed/added since the last render must
  // never ride into a paid bulk action).
  useEffect(() => {
    setSelected((prev) => {
      const valid = new Set(candidates.filter((c) => c.status === 'pending' && c.dedupeStatus !== 'existing_partner').map((c) => c.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [candidates]);
  // A fresh run starts with every category shown.
  useEffect(() => { setHiddenCats(new Set()); }, [runId]);

  // Arm-and-fire: when a run STARTED from an AI suggestion completes, pre-hide the
  // returned Google categories the AI didn't flag as on-target — once, so manual
  // re-checks stick. Never hides everything, and only the run it was armed for
  // (opening an old run is never auto-cleaned).
  useEffect(() => {
    if (isIgRun || run?.status !== 'completed') return;
    if (runId !== aiArmedRunId || !aiCats.length) return;
    const returned = [...new Set(candidates
      .filter((c) => c.status !== 'dismissed' && c.rawPayload?.categoryName)
      .map((c) => c.rawPayload.categoryName))];
    const off = returned.filter((cat) => !aiCats.some((ai) => {
      const a = ai.toLowerCase(); const b = cat.toLowerCase();
      return b.includes(a) || a.includes(b);
    }));
    if (off.length && off.length < returned.length) setHiddenCats(new Set(off));
    setAiArmedRunId(null);
  }, [run?.status, candidates, aiCats, aiArmedRunId, isIgRun, runId]);

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
      // Arm the one-time facet auto-clean for THIS run iff it was searched from an
      // AI suggestion — opening an old run later must never be auto-cleaned.
      setAiArmedRunId(aiCats.length ? r.id : null);
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
  // Populates the terms/hashtags input only — a search is never auto-started
  // (searches spend quota + Apify budget; suggestions are review-then-run).
  const suggestMutation = useMutation({
    mutationFn: () => redeemOpsApi.suggestDiscoveryTerms({
      description: aiDesc.trim(),
      provider: form.provider,
      ...(form.area.trim() ? { area: form.area.trim() } : {}),
    }),
    onSuccess: ({ terms, categories }) => {
      const cats = isIg ? [] : (categories || []);
      setForm((f) => ({
        ...f,
        adhoc: terms.join(', '),
        ...(cats.length ? { filterWords: cats.join(', ') } : {}),
      }));
      setAiCats(cats);
      if (cats.length) setShowFilters(true); // reveal the pre-filled category filter
      toast.success(
        `${terms.length} ${isIg ? 'hashtags' : 'phrases'}${cats.length ? ` + ${cats.length} categories` : ''} suggested`,
        { description: 'Review before searching — clear the categories to keep everything.' },
      );
    },
    onError: (err) => toast.error('Could not suggest terms', { description: err.message }),
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

  const parseCsv = (v) => (v || '').split(',').map((s) => s.trim().replace(/^#+/, '')).filter(Boolean);
  const runSearch = () => {
    const terms = parseCsv(form.adhoc); // the search is what you type: terms (Maps) / hashtags (IG)
    if (!form.area.trim() || terms.length === 0 || startMutation.isPending) return;
    const body = { area: form.area.trim(), limit: Number(form.limit), provider: form.provider };
    if (isIg) {
      body.hashtags = terms;
    } else {
      body.searchTerms = terms;
      if (form.minStars && form.minStars !== 'any') body.minStars = form.minStars;
      if (form.skipClosed) body.skipClosed = true;
      const filterWords = parseCsv(form.filterWords);
      if (filterWords.length) body.categoryFilterWords = filterWords;
    }
    startMutation.mutate(body);
  };
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableIds));
  const toggleCat = (cat) => {
    const hiding = !hiddenCats.has(cat);
    setHiddenCats((prev) => {
      const next = new Set(prev); next.has(cat) ? next.delete(cat) : next.add(cat); return next;
    });
    // Never let a hidden row ride a bulk action — drop its selections on hide.
    if (hiding) {
      setSelected((prev) => new Set([...prev].filter((id) =>
        candidates.find((c) => c.id === id)?.rawPayload?.categoryName !== cat)));
    }
  };
  const enrichAll = () => {
    const ids = candidates
      .filter((c) => c.instagramHandle && !['enriched', 'pending', 'cached'].includes(c.enrichmentStatus) && c.status !== 'dismissed')
      .map((c) => c.id);
    if (ids.length === 0) { toast.info('Nothing to enrich — no un-enriched Instagram handles'); return; }
    enrichMutation.mutate(ids);
  };
  const canSearch = form.area.trim() && parseCsv(form.adhoc).length > 0 && !startMutation.isPending;
  const canSuggest = aiDesc.trim().length >= 3 && !suggestMutation.isPending;
  const filterWordCount = parseCsv(form.filterWords).length;
  const activeFilterSummary = [
    form.minStars !== 'any' && MINSTAR_LABEL[form.minStars],
    form.skipClosed && 'closed excluded',
    filterWordCount && `${filterWordCount} categor${filterWordCount === 1 ? 'y' : 'ies'}`,
  ].filter(Boolean).join(' · ') || 'rating · closed · categories';

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6 pb-24">
      <RoPageHeader
        title="Discover"
        sub="Find businesses to prospect by keyword and area — deduped against your partners, one click to your pipeline."
        actions={quota && (
          <span className="hidden sm:inline-flex items-center gap-2 text-[12.5px] font-semibold rounded-full px-3 py-1.5"
            style={{ color: 'var(--ro-text-2)', background: 'var(--ro-subtle)', border: '1px solid var(--ro-border)' }}>
            <i className="w-[7px] h-[7px] rounded-full" style={{ background: (resultsQuota ? quota.resultsRemaining : quota.remaining) > 0 ? 'var(--ro-tag-green-fg)' : 'var(--ro-tag-red-fg)' }} />
            {resultsQuota ? (
              <><b style={{ color: 'var(--ro-bunker)' }}>{quota.resultsRemaining}</b> results left today</>
            ) : (
              <><b style={{ color: 'var(--ro-bunker)' }}>{quota.used}</b> of {quota.limit} searches today</>
            )}
          </span>
        )}
      />

      {/* ── First-run: search + suggested + recent ───────────────────────── */}
      {!runId && (
        <>
          <div className="rounded-2xl border border-border bg-white p-4 md:p-5">
            {igEnabled && (
              <div className="mb-4">
                <div className="inline-flex items-center gap-1 p-1 rounded-xl"
                  style={{ background: 'var(--ro-subtle)', border: '1px solid var(--ro-border)' }}>
                  <ProviderTab on={!isIg} onClick={() => { setForm((f) => ({ ...f, provider: 'google_maps' })); setAiCats([]); }}
                    icon={<MapPin className="w-3.5 h-3.5" aria-hidden="true" />}>Google Maps</ProviderTab>
                  <ProviderTab on={isIg} onClick={() => { setForm((f) => ({ ...f, provider: IG_PROVIDER })); setAiCats([]); }}
                    icon={<Instagram className="w-3.5 h-3.5" aria-hidden="true" />}>Instagram</ProviderTab>
                </div>
                <p className="text-[12px] mt-2 mb-0" style={{ color: 'var(--ro-text-3)' }}>
                  {isIg ? 'Accounts, including home-based businesses Maps can\'t see' : 'Listed storefronts & local businesses'}
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="disc-terms">{isIg ? 'Hashtags' : 'Search phrases'}</Label>
                {aiEnabled && (
                  <button type="button" onClick={() => setShowAi((v) => !v)} aria-expanded={showAi}
                    className="ro-link inline-flex items-center gap-1 text-[12.5px] font-semibold">
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />{showAi ? 'Hide AI' : 'Get AI suggestions'}
                  </button>
                )}
              </div>
              <Input id="disc-terms" value={form.adhoc}
                placeholder={isIg ? 'sgnails, biabsg, homebasednailssg' : 'nail salon, taekwondo, kopitiam'}
                onChange={(e) => { setForm((f) => ({ ...f, adhoc: e.target.value })); if (aiCats.length) setAiCats([]); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && canSearch) runSearch(); }} />
              <p className="text-[12px] m-0" style={{ color: 'var(--ro-text-3)' }}>
                {isIg
                  ? 'Each hashtag is scanned on Instagram. The # is optional. Separate with commas.'
                  : 'Each phrase is sent to Google Maps as its own search. Separate with commas.'}
              </p>
              {aiEnabled && showAi && (
                <div className="flex items-center gap-2 mt-1 rounded-xl px-3 py-1.5"
                  style={{ background: 'var(--ro-subtle)', border: '1px dashed var(--ro-border)' }}>
                  <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" style={{ color: 'var(--ro-text-2)' }} />
                  <Input value={aiDesc}
                    placeholder={isIg
                      ? 'Describe the niche — e.g. "home-based bakers"'
                      : 'Describe who you\'re looking for — e.g. "after-school activities for kids"'}
                    aria-label="Describe what you want to find"
                    className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0 px-0"
                    onChange={(e) => setAiDesc(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && canSuggest) suggestMutation.mutate(); }} />
                  <Button variant="ghost" size="sm" className="shrink-0 font-semibold" disabled={!canSuggest}
                    onClick={() => suggestMutation.mutate()}>
                    {suggestMutation.isPending ? 'Suggesting…' : 'Suggest'}
                  </Button>
                </div>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_120px_auto] md:items-end mt-4">
              <div className="space-y-1.5">
                <Label htmlFor="disc-area">{isIg ? 'Location hint' : 'Search territory'}</Label>
                {territoriesEnabled ? (
                  <Select value={form.area} onValueChange={(area) => setForm((f) => ({ ...f, area }))}>
                    <SelectTrigger id="disc-area" className="w-full">
                      <SelectValue placeholder="Select a territory…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_SINGAPORE}>{ALL_SINGAPORE}</SelectItem>
                      {territoryNames.map((name) => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      ))}
                      {customArea && <SelectItem value={customArea}>{customArea}</SelectItem>}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input id="disc-area" value={form.area} placeholder="Neighbourhood or district…"
                    onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && canSearch) runSearch(); }} />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Results</Label>
                <Select value={form.limit} onValueChange={(v) => setForm((f) => ({ ...f, limit: v }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{['30', '60', '120', '300', '500'].map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button disabled={!canSearch} onClick={() => runSearch()}>
                <Search className="w-4 h-4 mr-1.5" aria-hidden="true" />{startMutation.isPending ? 'Starting…' : (isIg ? 'Search Instagram' : 'Search Google Maps')}
              </Button>
            </div>
            {!isIg && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--ro-border)' }}>
                <button type="button" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}
                  className="flex items-center gap-2 w-full text-left">
                  <span className="text-[13px] font-bold">More filters</span>
                  <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showFilters ? 'rotate-90' : ''}`} style={{ color: 'var(--ro-text-3)' }} aria-hidden="true" />
                  {!showFilters && <span className="ml-auto text-[12px]" style={{ color: 'var(--ro-text-3)' }}>{activeFilterSummary}</span>}
                </button>
                {showFilters && (
                  <div className="mt-3 space-y-3">
                    <div className="flex items-end gap-3">
                      <div className="space-y-1">
                        <Label>Min rating</Label>
                        <Select value={form.minStars} onValueChange={(v) => setForm((f) => ({ ...f, minStars: v }))}>
                          <SelectTrigger className="w-full min-w-[104px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="any">Any</SelectItem>
                            <SelectItem value="three">3.0★+</SelectItem>
                            <SelectItem value="threeAndHalf">3.5★+</SelectItem>
                            <SelectItem value="four">4.0★+</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <label className="flex items-center gap-2 h-9 px-1 text-[13px] font-semibold cursor-pointer whitespace-nowrap" style={{ color: 'var(--ro-text-2)' }}>
                        <input type="checkbox" className="w-4 h-4 accent-[var(--ro-bunker)]"
                          checked={form.skipClosed} onChange={(e) => setForm((f) => ({ ...f, skipClosed: e.target.checked }))} />
                        Exclude closed businesses
                      </label>
                    </div>
                    <div className="rounded-xl p-3" style={{ background: 'var(--ro-subtle)', border: '1px dashed var(--ro-border)' }}>
                      <Label htmlFor="disc-filter-words" className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ color: 'var(--ro-azure-dark)', background: 'var(--ro-azure-tint)' }}>Advanced</span>
                        Restrict Google categories <span style={{ color: 'var(--ro-text-3)', fontWeight: 400 }}>before fetching · optional</span>
                      </Label>
                      <Input id="disc-filter-words" className="mt-2" value={form.filterWords}
                        placeholder="learning center, education center"
                        onChange={(e) => setForm((f) => ({ ...f, filterWords: e.target.value }))} />
                      <p className="text-[11.5px] mt-1.5 mb-0" style={{ color: 'var(--ro-text-3)' }}>
                        Cost control for big sweeps. Matches the Google <b>category</b>, not the name — may miss valid targets. Usually better to filter <b>after</b> the search, below.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {!territoriesEnabled && !isIg && (
                <>
                  <span className="text-xs font-semibold" style={{ color: 'var(--ro-text-3)' }}>Popular areas</span>
                  {POPULAR_AREAS.map((a) => (
                    <button key={a} type="button" onClick={() => setForm((f) => ({ ...f, area: a }))}
                      className="h-7 px-3 rounded-full text-[12.5px] font-semibold"
                      style={{ background: 'var(--ro-subtle)', border: '1px solid var(--ro-border)', color: 'var(--ro-text-2)' }}>{a}</button>
                  ))}
                </>
              )}
              {isIg ? (
                <span className="text-[12px]" style={{ color: 'var(--ro-text-3)' }}>
                  Area is a soft filter — Instagram location data is incomplete. Finds IG-native shops Maps misses.
                </span>
              ) : (
                <span className="text-[12px]" style={{ color: 'var(--ro-text-3)' }}>
                  Results is a total, split across your phrases.
                </span>
              )}
              {!isIg && quota?.costPerResultUsd > 0 && (
                <span className="ml-auto text-[12px]" style={{ color: 'var(--ro-text-3)' }}>
                  ≈ ${(Number(form.limit) * quota.costPerResultUsd).toFixed(2)} max
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
                    onClick={() => { setForm((f) => ({ ...f, adhoc: s.category, area: s.area, limit: '60' })); setAiCats([]); }}
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
                      <b className="text-[14px] block truncate">{[searchTermsOf(r) || r.category, r.area].filter(Boolean).join(' · ') || '—'}</b>
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

      {/* ── Active run: back link + query bar ─────────────────────────────── */}
      {runId && (
        <div className="space-y-3">
          <button type="button" onClick={() => { setRunId(null); setSelected(new Set()); }}
            className="ro-link inline-flex items-center gap-1 text-[13.5px]">
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> All searches
          </button>
          <div className="flex items-center gap-2 flex-wrap rounded-2xl border border-border bg-white px-4 py-3">
            {[
              // Lead with the exact query fired; Category is only shown when the run
              // was filed under one (ad-hoc runs have none — no more bare "—").
              ...(runTerms ? [[isIgRun ? 'Hashtags' : 'Terms', runTerms, true]] : []),
              ...(run?.category ? [['Category', run.category, false]] : []),
              ...(run?.rawPayload?.categoryFilterWords?.length
                ? [['Categories', run.rawPayload.categoryFilterWords.join(', '), true]] : []),
              ['Area', run?.area, false], ['Results', run?.requestedLimit, false],
              ...(run?.actualCostUsd != null ? [['Cost', `$${Number(run.actualCostUsd).toFixed(2)}`, false]] : []),
            ].map(([k, v, truncate]) => (
              <span key={k} className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full text-[13.5px] font-semibold max-w-full min-w-0" style={{ border: '1px solid var(--ro-border-strong)' }}>
                <span className="shrink-0" style={{ color: 'var(--ro-text-3)', fontWeight: 500 }}>{k}</span>
                <span className={truncate ? 'truncate' : ''} title={truncate ? String(v) : undefined}>{v ?? '—'}</span>
              </span>
            ))}
            <button type="button" onClick={() => setRunId(null)}
              className="ml-auto h-9 px-4 rounded-full text-[13px] font-semibold shrink-0" style={{ border: '1px solid var(--ro-border-strong)', background: '#fff' }}>New search</button>
          </div>
        </div>
      )}

      {/* Searching — skeleton */}
      {isSearching && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span className="w-[18px] h-[18px] rounded-full animate-spin" style={{ border: '2.4px solid var(--ro-azure-tint)', borderTopColor: 'var(--ro-azure)' }} />
            <b className="text-[15px]">{isIgRun ? 'Searching Instagram…' : 'Searching Google Maps…'}</b>
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
            <span className="text-[15px] font-bold mr-1">
              {selected.size > 0 ? `${selected.size} selected` : `${counts.total} found`}
              {selected.size === 0 && (catHidden > 0 || counts.hidden > 0) && (
                <span className="font-medium text-[12.5px]" style={{ color: 'var(--ro-text-3)' }}>
                  {catHidden > 0 && ` · ${catHidden} hidden by type`}
                  {counts.hidden > 0 && ` · ${counts.hidden} dismissed`}
                </span>
              )}
            </span>
            <Seg on={filter === 'all'} onClick={() => setFilter('all')}>All <b className="tabular-nums">{counts.total}</b></Seg>
            <Seg on={filter === 'new'} onClick={() => setFilter('new')} dot="var(--ro-tag-blue-fg)">New <b className="tabular-nums">{counts.new}</b></Seg>
            {counts.seen > 0 && <Seg on={filter === 'seen'} onClick={() => setFilter('seen')} dot="var(--ro-tag-gray-fg)">Seen before <b className="tabular-nums">{counts.seen}</b></Seg>}
            <Seg on={filter === 'partners'} onClick={() => setFilter('partners')} dot="var(--ro-tag-gray-fg)">Partners <b className="tabular-nums">{counts.partners}</b></Seg>
            {counts.possible > 0 && <Seg on={filter === 'possible'} onClick={() => setFilter('possible')} dot="var(--ro-tag-yellow-fg)">Possible dup <b className="tabular-nums">{counts.possible}</b></Seg>}
            {!isIgRun && <Seg on={filter === 'ig'} onClick={() => setFilter('ig')}>Has Instagram <b className="tabular-nums">{counts.ig}</b></Seg>}
            {isIgRun && counts.homebased > 0 && <Seg on={filter === 'homebased'} onClick={() => setFilter('homebased')} dot="var(--ro-tag-green-fg)">Home-based <b className="tabular-nums">{counts.homebased}</b></Seg>}
            {counts.hidden > 0 && <Seg on={filter === 'hidden'} onClick={() => setFilter('hidden')}>Hidden <b className="tabular-nums">{counts.hidden}</b></Seg>}
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

          {/* Post-search category facet — see the Google categories that came back
              and uncheck the off-vertical junk (drops rows client-side; no re-fetch). */}
          {!isIgRun && catFacet.length > 1 && (
            <div className="rounded-xl border border-border p-3 mb-3.5" style={{ background: 'var(--ro-subtle)' }}>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--ro-text-3)' }}>
                  Google categories · uncheck to hide
                </span>
                {hiddenCats.size > 0 && (
                  <button type="button" onClick={() => setHiddenCats(new Set())}
                    className="ro-link text-[12px] font-semibold ml-auto">Show all</button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {catFacet.map(({ cat, count }) => {
                  const on = !hiddenCats.has(cat);
                  return (
                    <button key={cat} type="button" onClick={() => toggleCat(cat)} aria-pressed={on}
                      className="inline-flex items-center gap-2 h-7 pl-1.5 pr-3 rounded-full text-[12.5px] font-semibold"
                      style={on
                        ? { background: '#fff', border: '1px solid var(--ro-border-strong)', color: 'var(--ro-bunker)' }
                        : { background: 'transparent', border: '1px solid var(--ro-border)', color: 'var(--ro-text-3)' }}>
                      <span className="w-4 h-4 rounded-[5px] grid place-items-center shrink-0"
                        style={on ? { background: 'var(--ro-azure)' } : { border: '1.5px solid var(--ro-border-strong)' }}>
                        {on && <Check className="w-3 h-3" style={{ color: '#fff' }} strokeWidth={3} aria-hidden="true" />}
                      </span>
                      <span className={on ? '' : 'line-through'}>{cat}</span>
                      <span className="tabular-nums" style={{ color: 'var(--ro-text-3)', fontWeight: 500 }}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-white overflow-hidden">
            {visible.length === 0 && (
              <p className="text-sm text-center py-10 m-0" style={{ color: 'var(--ro-text-2)' }}>
                {counts.total === 0 ? 'No businesses found — try a broader area.' : 'Nothing in this filter.'}
              </p>
            )}
            {visible.map((c) => {
              const badge = c.dedupeStatus !== 'new'
                ? (DEDUPE[c.dedupeStatus] || DEDUPE.new)
                : (c.previouslySeenAt ? { tone: 'archived', label: 'Seen previously' } : DEDUPE.new);
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
                        {/* IG: lead with the home-based signal + bio (the whole point);
                            Maps: Google's own category label first so weak matches
                            (e.g. "Discount store" for a Pet Grooming search) are self-evident. */}
                        {isIgRun
                          ? ([isHomeBased(c) && 'Home-based', c.bio, c.area].filter(Boolean).join(' · ') || 'Instagram business')
                          : ([c.rawPayload?.categoryName, c.area, c.primaryPhone].filter(Boolean).join(' · ') || '—')}
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
                          ? (
                            <b className="tabular-nums" title={c.enrichmentStatus === 'cached' ? 'From an earlier search (cached)' : undefined}
                              style={{ color: c.followersCount >= 10000 ? 'var(--ro-tag-purple-fg)' : 'var(--ro-bunker)' }}>{fmtFollowers(c.followersCount)}</b>
                          )
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
                    {c.status === 'dismissed' && (
                      <button type="button" aria-label={`Restore ${c.name}`} onClick={() => restoreMutation.mutate(c.id)}
                        className="shrink-0 text-[12.5px] font-semibold ro-link">Restore</button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          {counts.materialized > 0 && run?.requestedLimit >= 30 && counts.materialized < Math.ceil(run.requestedLimit * 0.25) && (
            <p className="text-[12px] mt-2 mb-0" style={{ color: 'var(--ro-text-2)' }}>
              {isIgRun
                ? `Instagram surfaced only ${counts.materialized} account${counts.materialized === 1 ? '' : 's'} — add more hashtags to the category in Settings, or widen the area.`
                : `Google found only ${counts.materialized} match${counts.materialized === 1 ? '' : 'es'} in this area — small central districts (like Orchard) genuinely have few of some business types. Try a broader or neighbouring area, and check each row's category label for weak matches.`}
            </p>
          )}
          <p className="text-[11.5px] mt-2 mb-0" style={{ color: 'var(--ro-text-3)' }}>
            {isIgRun
              ? 'IG-native businesses — many home-based with no storefront. Reach out via Instagram DM; enrich to fill in followers & bio.'
              : 'Phone numbers are reference data — keep outreach IG-first; calls/SMS must respect the DNC registry.'}
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

function ProviderTab({ on, onClick, icon, children }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-semibold transition-colors"
      style={on
        ? { background: '#fff', color: 'var(--ro-bunker)', boxShadow: '0 1px 2px rgba(16,24,40,.08)' }
        : { background: 'transparent', color: 'var(--ro-text-3)' }}>
      {icon}{children}
    </button>
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
