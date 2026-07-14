import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import CadenceStudio from '@/components/redeemops/CadenceStudio';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Plus from 'lucide-react/icons/plus';
import Pencil from 'lucide-react/icons/pencil';
import Search from 'lucide-react/icons/search';
import Instagram from 'lucide-react/icons/instagram';
import Merge from 'lucide-react/icons/merge';
import Trash2 from 'lucide-react/icons/trash-2';
import { RoPageHeader, RoTag } from '@/components/redeemops/ui';

const CATEGORIES_KEY = ['redeem-ops', 'categories'];
const TERRITORIES_KEY = ['redeem-ops', 'territories'];
const parseSearchTerms = (value) => value.split(',').map((term) => term.trim()).filter(Boolean);
const parseHashtags = (value) => value.split(',').map((t) => t.trim().replace(/^#+/, '')).filter(Boolean);

/**
 * /redeem-ops/settings — admin knobs (settings.manage). First resident: the
 * category taxonomy that partner/pool/reward pickers and the CSV import
 * validate against. Rename cascades onto existing rows; merge consolidates
 * seeded variants; delete only works while nothing references the name
 * (the API refuses otherwise and the toast relays why).
 */
export default function SettingsPage() {
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: [...CATEGORIES_KEY, 'all'],
    queryFn: () => redeemOpsApi.listCategories({ includeInactive: 'true' }),
  });
  const categories = listQuery.data || [];
  const territoriesQuery = useQuery({
    queryKey: [...TERRITORIES_KEY, 'all'],
    queryFn: () => redeemOpsApi.listTerritories({ includeInactive: 'true' }),
  });
  const territories = territoriesQuery.data?.territories || [];

  const invalidate = () => {
    // Both the settings list (…, 'all') and the picker list share the prefix.
    queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
  };
  const onError = (title) => (err) => toast.error(title, { description: err.message });

  // ── Add ────────────────────────────────────────────────────────────────
  const [newName, setNewName] = useState('');
  const [newSearchTerms, setNewSearchTerms] = useState('');
  const createMutation = useMutation({
    mutationFn: () => {
      const body = { name: newName.trim() };
      if (newSearchTerms.trim()) body.searchTerms = parseSearchTerms(newSearchTerms);
      return redeemOpsApi.createCategory(body);
    },
    onSuccess: (cat) => {
      toast.success(`Added '${cat?.name || newName.trim()}'`);
      setNewName('');
      setNewSearchTerms('');
      invalidate();
    },
    onError: onError('Could not add category'),
  });

  // ── Rename ─────────────────────────────────────────────────────────────
  const [renameTarget, setRenameTarget] = useState(null); // { id, name } | null
  const [renameTo, setRenameTo] = useState('');
  const renameMutation = useMutation({
    mutationFn: () => redeemOpsApi.updateCategory(renameTarget.id, { name: renameTo.trim() }),
    onSuccess: () => {
      toast.success('Renamed — existing records updated to match');
      setRenameTarget(null);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partners'] });
    },
    onError: onError('Could not rename'),
  });

  // ── Provider search terms ──────────────────────────────────────────────
  const [searchTermsTarget, setSearchTermsTarget] = useState(null);
  const [searchTermsText, setSearchTermsText] = useState('');
  const searchTermsMutation = useMutation({
    mutationFn: () => redeemOpsApi.updateCategory(searchTermsTarget.id, {
      searchTerms: parseSearchTerms(searchTermsText),
    }),
    onSuccess: () => {
      toast.success('Search terms updated');
      setSearchTermsTarget(null);
      invalidate();
    },
    onError: onError('Could not update search terms'),
  });

  // ── Instagram hashtags (IG discovery provider) ─────────────────────────
  const [igTarget, setIgTarget] = useState(null);
  const [igText, setIgText] = useState('');
  const igHashtagsMutation = useMutation({
    mutationFn: () => redeemOpsApi.updateCategory(igTarget.id, {
      igHashtags: parseHashtags(igText),
    }),
    onSuccess: () => {
      toast.success('Instagram hashtags updated');
      setIgTarget(null);
      invalidate();
    },
    onError: onError('Could not update Instagram hashtags'),
  });

  // ── Retire / restore ───────────────────────────────────────────────────
  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }) => redeemOpsApi.updateCategory(id, { isActive }),
    onSuccess: (_cat, vars) => {
      toast.success(vars.isActive
        ? 'Restored — available in pickers again'
        : 'Retired — existing records keep it; pickers stop offering it');
      invalidate();
    },
    onError: onError('Could not update'),
  });

  // ── Merge ──────────────────────────────────────────────────────────────
  const [mergeSource, setMergeSource] = useState(null); // { id, name } | null
  const [mergeTargetId, setMergeTargetId] = useState('');
  const mergeMutation = useMutation({
    mutationFn: () => redeemOpsApi.mergeCategory(mergeSource.id, mergeTargetId),
    onSuccess: (data) => {
      toast.success(`Merged — ${data?.rowsMoved ?? 0} record(s) moved to '${data?.target?.name}'`);
      setMergeSource(null);
      setMergeTargetId('');
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partners'] });
    },
    onError: onError('Could not merge'),
  });

  // ── Delete (unreferenced only — the API is the guard) ──────────────────
  const deleteMutation = useMutation({
    mutationFn: (id) => redeemOpsApi.deleteCategory(id),
    onSuccess: () => {
      toast.success('Category deleted');
      invalidate();
    },
    onError: onError('Could not delete'),
  });

  const mergeTargets = categories.filter((c) => c.isActive && c.id !== mergeSource?.id);

  // ── Discover territories ──────────────────────────────────────────────
  const invalidateTerritories = () => {
    queryClient.invalidateQueries({ queryKey: TERRITORIES_KEY });
  };
  const [newTerritoryName, setNewTerritoryName] = useState('');
  const createTerritoryMutation = useMutation({
    mutationFn: () => redeemOpsApi.createTerritory({ name: newTerritoryName.trim() }),
    onSuccess: (territory) => {
      toast.success(`Added '${territory?.name || newTerritoryName.trim()}'`);
      setNewTerritoryName('');
      invalidateTerritories();
    },
    onError: onError('Could not add territory'),
  });

  const [territoryRenameTarget, setTerritoryRenameTarget] = useState(null);
  const [territoryRenameTo, setTerritoryRenameTo] = useState('');
  const renameTerritoryMutation = useMutation({
    mutationFn: () => redeemOpsApi.updateTerritory(
      territoryRenameTarget.id,
      { name: territoryRenameTo.trim() },
    ),
    onSuccess: () => {
      toast.success('Territory renamed');
      setTerritoryRenameTarget(null);
      invalidateTerritories();
    },
    onError: onError('Could not rename territory'),
  });

  const territoryActiveMutation = useMutation({
    mutationFn: ({ id, isActive }) => redeemOpsApi.updateTerritory(id, { isActive }),
    onSuccess: (_territory, vars) => {
      toast.success(vars.isActive
        ? 'Territory restored to the Discover picker'
        : 'Territory retired from the Discover picker');
      invalidateTerritories();
    },
    onError: onError('Could not update territory'),
  });

  const deleteTerritoryMutation = useMutation({
    mutationFn: (id) => redeemOpsApi.deleteTerritory(id),
    onSuccess: () => {
      toast.success('Territory deleted');
      invalidateTerritories();
    },
    onError: onError('Could not delete territory'),
  });

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <RoPageHeader
        title="Settings"
        sub="Categories, Discover territories, and cadences are managed here and picked everywhere else."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Categories</CardTitle>
          <CardDescription>
            Rename updates every business, pool, and reward carrying the old name. Retire to stop
            new use without touching history; merge to consolidate duplicates like “Nails” into
            “Nail Salon”.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-2 mb-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start"
            onSubmit={(e) => { e.preventDefault(); if (newName.trim()) createMutation.mutate(); }}
          >
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New category, e.g. Pet Grooming"
            />
            <div className="space-y-1">
              <Input
                value={newSearchTerms}
                onChange={(e) => setNewSearchTerms(e.target.value)}
                placeholder="Search terms (optional), comma-separated"
                aria-label="Search terms"
              />
              <p className="text-xs m-0" style={{ color: 'var(--ro-text-2)' }}>
                Terms Discover sends to Google Maps — e.g. kopitiam, zi char. Defaults to the category name.
              </p>
            </div>
            <Button type="submit" className="sm:mt-0" disabled={!newName.trim() || createMutation.isPending}>
              <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> Add
            </Button>
          </form>

          {listQuery.isLoading && <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>Loading…</p>}
          {!listQuery.isLoading && categories.length === 0 && (
            <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>
              No categories yet — add the verticals your team prospects in.
            </p>
          )}

          <ul className="m-0 p-0 list-none divide-y divide-border">
            {categories.map((cat) => (
              <li key={cat.id} className="flex items-center gap-2 py-2.5">
                <span className="text-sm font-medium min-w-0 truncate">{cat.name}</span>
                {!cat.isActive && <RoTag tone="gray">retired</RoTag>}
                <span className="flex items-center gap-1 ml-auto shrink-0">
                  <Button
                    variant="ghost" size="sm" aria-label={`Rename ${cat.name}`}
                    onClick={() => { setRenameTarget(cat); setRenameTo(cat.name); }}
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost" size="sm" aria-label={`Edit search terms for ${cat.name}`}
                    onClick={() => {
                      setSearchTermsTarget(cat);
                      setSearchTermsText((cat.providerSearchTerms || []).join(', '));
                    }}
                  >
                    <Search className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost" size="sm" aria-label={`Edit Instagram hashtags for ${cat.name}`}
                    onClick={() => {
                      setIgTarget(cat);
                      setIgText((cat.igHashtags || []).join(', '));
                    }}
                  >
                    <Instagram className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost" size="sm" aria-label={`Merge ${cat.name} into another category`}
                    onClick={() => { setMergeSource(cat); setMergeTargetId(''); }}
                  >
                    <Merge className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    disabled={activeMutation.isPending}
                    onClick={() => activeMutation.mutate({ id: cat.id, isActive: !cat.isActive })}
                  >
                    {cat.isActive ? 'Retire' : 'Restore'}
                  </Button>
                  <Button
                    variant="ghost" size="sm" aria-label={`Delete ${cat.name}`}
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(cat.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Territories
            {territoriesQuery.isSuccess && (
              <RoTag tone={territoriesQuery.data.enabled ? 'active' : 'inactive'} size="sm">
                picker {territoriesQuery.data.enabled ? 'on' : 'off'}
              </RoTag>
            )}
          </CardTitle>
          <CardDescription>
            Search filters offered in Discover. They never assign or own partners. “All Singapore”
            is built in separately; retire a territory to hide it from new searches.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex gap-2 mb-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (newTerritoryName.trim()) createTerritoryMutation.mutate();
            }}
          >
            <Input
              value={newTerritoryName}
              onChange={(e) => setNewTerritoryName(e.target.value)}
              placeholder="New territory, e.g. Upper Thomson"
            />
            <Button
              type="submit"
              disabled={!newTerritoryName.trim() || createTerritoryMutation.isPending}
            >
              <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> Add
            </Button>
          </form>

          {territoriesQuery.isLoading && (
            <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>Loading…</p>
          )}
          {territoriesQuery.isError && (
            <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>
              Could not load territories.
            </p>
          )}
          {territoriesQuery.isSuccess && territories.length === 0 && (
            <p className="text-sm m-0" style={{ color: 'var(--ro-text-2)' }}>
              No territories yet — add the areas your team searches.
            </p>
          )}

          <ul className="m-0 p-0 list-none divide-y divide-border">
            {territories.map((territory) => (
              <li key={territory.id} className="flex items-center gap-2 py-2.5">
                <span className="text-sm font-medium min-w-0 truncate">{territory.name}</span>
                {!territory.isActive && <RoTag tone="inactive">retired</RoTag>}
                <span className="flex items-center gap-1 ml-auto shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Rename ${territory.name}`}
                    onClick={() => {
                      setTerritoryRenameTarget(territory);
                      setTerritoryRenameTo(territory.name);
                    }}
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={territoryActiveMutation.isPending}
                    onClick={() => territoryActiveMutation.mutate({
                      id: territory.id,
                      isActive: !territory.isActive,
                    })}
                  >
                    {territory.isActive ? 'Retire' : 'Restore'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete ${territory.name}`}
                    disabled={deleteTerritoryMutation.isPending}
                    onClick={() => deleteTerritoryMutation.mutate(territory.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <CadenceStudio />

      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename category</DialogTitle>
            <DialogDescription>
              Every business, pool, and reward currently set to “{renameTarget?.name}” is updated
              to the new name. To fold it into an existing category, use Merge instead.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="rename-to">New name</Label>
            <Input id="rename-to" value={renameTo} onChange={(e) => setRenameTo(e.target.value)} />
          </div>
          <DialogFooter>
            <Button
              disabled={!renameTo.trim() || renameTo.trim() === renameTarget?.name || renameMutation.isPending}
              onClick={() => renameMutation.mutate()}
            >
              {renameMutation.isPending ? 'Renaming…' : 'Rename'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!searchTermsTarget}
        onOpenChange={(open) => { if (!open) setSearchTermsTarget(null); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit search terms</DialogTitle>
            <DialogDescription>
              Terms Discover sends to Google Maps — e.g. kopitiam, zi char. Defaults to the
              category name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="category-search-terms">Search terms</Label>
            <Input
              id="category-search-terms"
              value={searchTermsText}
              onChange={(e) => setSearchTermsText(e.target.value)}
              placeholder={searchTermsTarget?.name}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={searchTermsMutation.isPending}
              onClick={() => searchTermsMutation.mutate()}
            >
              {searchTermsMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!igTarget} onOpenChange={(open) => { if (!open) setIgTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Instagram hashtags</DialogTitle>
            <DialogDescription>
              Hashtags Discover fires for this category on the Instagram provider — e.g.
              sgnails, biabsg, homebasednailssg. Comma-separated; the # is optional. With none,
              Instagram search is unavailable for this category.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="category-ig-hashtags">Hashtags</Label>
            <Input
              id="category-ig-hashtags"
              value={igText}
              onChange={(e) => setIgText(e.target.value)}
              placeholder="sgnails, biabsg, homebasednailssg"
            />
          </div>
          <DialogFooter>
            <Button
              disabled={igHashtagsMutation.isPending}
              onClick={() => igHashtagsMutation.mutate()}
            >
              {igHashtagsMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!mergeSource} onOpenChange={(open) => { if (!open) setMergeSource(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Merge “{mergeSource?.name}”</DialogTitle>
            <DialogDescription>
              Moves every record to the target category and deletes “{mergeSource?.name}”.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>Merge into</Label>
            <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
              <SelectTrigger><SelectValue placeholder="Select target category" /></SelectTrigger>
              <SelectContent>
                {mergeTargets.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              disabled={!mergeTargetId || mergeMutation.isPending}
              onClick={() => mergeMutation.mutate()}
            >
              {mergeMutation.isPending ? 'Merging…' : 'Merge'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!territoryRenameTarget}
        onOpenChange={(open) => { if (!open) setTerritoryRenameTarget(null); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename territory</DialogTitle>
            <DialogDescription>
              This changes the picker label only. Previous Discover runs keep their saved area.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="territory-rename-to">New name</Label>
            <Input
              id="territory-rename-to"
              value={territoryRenameTo}
              onChange={(e) => setTerritoryRenameTo(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={
                !territoryRenameTo.trim()
                || territoryRenameTo.trim() === territoryRenameTarget?.name
                || renameTerritoryMutation.isPending
              }
              onClick={() => renameTerritoryMutation.mutate()}
            >
              {renameTerritoryMutation.isPending ? 'Renaming…' : 'Rename'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
