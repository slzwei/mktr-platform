import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
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
import Merge from 'lucide-react/icons/merge';
import Trash2 from 'lucide-react/icons/trash-2';
import { RoPageHeader, RoTag } from '@/components/redeemops/ui';

const CATEGORIES_KEY = ['redeem-ops', 'categories'];

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

  const invalidate = () => {
    // Both the settings list (…, 'all') and the picker list share the prefix.
    queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
  };
  const onError = (title) => (err) => toast.error(title, { description: err.message });

  // ── Add ────────────────────────────────────────────────────────────────
  const [newName, setNewName] = useState('');
  const createMutation = useMutation({
    mutationFn: () => redeemOpsApi.createCategory({ name: newName.trim() }),
    onSuccess: (cat) => {
      toast.success(`Added '${cat?.name || newName.trim()}'`);
      setNewName('');
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

  return (
    <div className="space-y-6">
      <RoPageHeader
        title="Settings"
        sub="Categories are managed here and picked everywhere else — partner forms, pools, imports, and the partners filter."
      />

      <Card>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <CardDescription>
            Rename updates every business, pool, and reward carrying the old name. Retire to stop
            new use without touching history; merge to consolidate duplicates like “Nails” into
            “Nail Salon”.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex gap-2 mb-4"
            onSubmit={(e) => { e.preventDefault(); if (newName.trim()) createMutation.mutate(); }}
          >
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New category, e.g. Pet Grooming"
              className="max-w-xs"
            />
            <Button type="submit" disabled={!newName.trim() || createMutation.isPending}>
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
    </div>
  );
}
