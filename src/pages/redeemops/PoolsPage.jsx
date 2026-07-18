import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Plus from 'lucide-react/icons/plus';
import { RoPageHeader, RoTag, RoAvatar, RoStageTag } from '@/components/redeemops/ui';

function useDebounced(value, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Search-and-tick dialog for stocking a pool with businesses. */
function AddMembersDialog({ pool, onClose }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState({});
  const debounced = useDebounced(search);

  const results = useQuery({
    queryKey: ['redeem-ops', 'pool-add-search', debounced],
    queryFn: () => redeemOpsApi.listPartners({ limit: 10, ...(debounced ? { search: debounced } : {}) }),
    enabled: !!pool,
  });

  const addMutation = useMutation({
    mutationFn: () => redeemOpsApi.addPoolMembers(pool.id, Object.keys(selected)),
    onSuccess: (data) => {
      const added = data?.added ?? Object.keys(selected).length;
      toast.success(`Added ${added} business${added === 1 ? '' : 'es'} to ${pool.name}`);
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'pools'] });
      onClose();
    },
    onError: (err) => toast.error('Could not add businesses', { description: err.message }),
  });

  const partners = results.data?.partners || [];
  const count = Object.keys(selected).length;

  return (
    <Dialog open={!!pool} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add businesses to “{pool?.name}”</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <input
            className="ro-search w-full"
            placeholder="Search name, phone or UEN"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
            {partners.map((p) => {
              const name = p.tradingName || p.brandName || p.legalName;
              const checked = !!selected[p.id];
              return (
                <label
                  key={p.id}
                  className="flex items-center gap-3 px-3.5 py-2.5 border-t border-border first:border-t-0 cursor-pointer hover:bg-[var(--ro-subtle)]"
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-[var(--ro-bunker)]"
                    checked={checked}
                    onChange={() => setSelected((s) => {
                      const next = { ...s };
                      if (next[p.id]) delete next[p.id]; else next[p.id] = true;
                      return next;
                    })}
                  />
                  <RoAvatar name={name} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold truncate">{name}</span>
                    <span className="block text-xs truncate" style={{ color: 'var(--ro-text-2)' }}>
                      {[p.category, p.owner?.fullName && `owned by ${p.owner.fullName}`].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <RoStageTag stage={p.pipelineStage} size="sm" />
                </label>
              );
            })}
            {!results.isLoading && partners.length === 0 && (
              <p className="text-sm text-center py-6 m-0" style={{ color: 'var(--ro-text-2)' }}>
                No businesses match.
              </p>
            )}
          </div>
          <p className="text-xs m-0" style={{ color: 'var(--ro-text-3)' }}>
            Unclaimed businesses become claimable via “Claim next”; owned ones are skipped by the queue until released.
          </p>
        </div>
        <DialogFooter>
          <Button disabled={count === 0 || addMutation.isPending} onClick={() => addMutation.mutate()}>
            {addMutation.isPending ? 'Adding…' : `Add ${count || ''} selected`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PoolsPage() {
  const user = useAuthStore((s) => s.user);
  const canManage = hasCapability(user, 'pools.manage');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const poolsQuery = useQuery({ queryKey: ['redeem-ops', 'pools'], queryFn: redeemOpsApi.listPools });

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', category: '', area: '' });
  const [addTarget, setAddTarget] = useState(null);

  const createMutation = useMutation({
    mutationFn: () => redeemOpsApi.createPool(form),
    onSuccess: () => {
      toast.success('Queue created');
      setCreateOpen(false);
      setForm({ name: '', description: '', category: '', area: '' });
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'pools'] });
    },
    onError: (err) => toast.error('Could not create queue', { description: err.message }),
  });

  const claimMutation = useMutation({
    mutationFn: (poolId) => redeemOpsApi.claimNextFromPool(poolId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'pools'] });
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'partners'] });
      if (data?.partnerId) {
        toast.success('Prospect claimed — it’s yours');
        navigate(`/redeem-ops/partners/${data.partnerId}`);
      } else {
        toast.info('Queue exhausted', { description: 'No eligible prospects left in this queue.' });
      }
    },
    onError: (err) => toast.error('Claim failed', { description: err.message }),
  });

  const pools = poolsQuery.data || [];

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      <RoPageHeader
        title="Call Lists"
        sub="Curated prospect lists — hit “Claim next” to pull your next business, no cherry-picking, no collisions."
        actions={canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> New queue
          </Button>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {pools.map((pool) => {
          const available = pool.memberCounts?.available || 0;
          const claimed = pool.memberCounts?.claimed || 0;
          return (
            <Card key={pool.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="min-w-0 truncate">{pool.name}</span>
                  <RoTag tone={pool.status === 'exhausted' ? 'ended' : pool.status} size="sm">
                    {pool.status}
                  </RoTag>
                </CardTitle>
                <CardDescription>
                  {[pool.category, pool.area].filter(Boolean).join(' · ') || pool.description || '—'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex gap-2">
                  <RoTag tone={available > 0 ? 'active' : 'ended'}>{available} available</RoTag>
                  <RoTag tone="inactive">{claimed} claimed</RoTag>
                </div>
                <div className="flex gap-2">
                  {canManage && (
                    <Button
                      size="sm" variant="outline" disabled={pool.status === 'archived'}
                      onClick={() => setAddTarget(pool)}
                    >
                      Add businesses
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={claimMutation.isPending || pool.status !== 'active'}
                    onClick={() => claimMutation.mutate(pool.id)}
                  >
                    {claimMutation.isPending ? 'Claiming…' : 'Claim next'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {!poolsQuery.isLoading && pools.length === 0 && (
          <Card className="sm:col-span-2">
            <CardContent className="py-10 text-center text-muted-foreground">
              No assignment queues yet{canManage ? ' — create one and add businesses from the Partners list.' : '.'}
            </CardContent>
          </Card>
        )}
      </div>

      {addTarget && <AddMembersDialog pool={addTarget} onClose={() => setAddTarget(null)} />}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New assignment queue</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Pet Groomers — East" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Input
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="Any label, e.g. Pet Grooming"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Area</Label>
                <Input value={form.area} onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))} placeholder="East" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!form.name.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? 'Creating…' : 'Create queue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
