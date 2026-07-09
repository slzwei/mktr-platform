import { useState } from 'react';
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
import { RoPageHeader, RoTag } from '@/components/redeemops/ui';

export default function PoolsPage() {
  const user = useAuthStore((s) => s.user);
  const canManage = hasCapability(user, 'pools.manage');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const poolsQuery = useQuery({ queryKey: ['redeem-ops', 'pools'], queryFn: redeemOpsApi.listPools });

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', category: '', area: '' });

  const createMutation = useMutation({
    mutationFn: () => redeemOpsApi.createPool(form),
    onSuccess: () => {
      toast.success('Pool created');
      setCreateOpen(false);
      setForm({ name: '', description: '', category: '', area: '' });
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'pools'] });
    },
    onError: (err) => toast.error('Could not create pool', { description: err.message }),
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
        toast.info('Pool exhausted', { description: 'No eligible prospects left in this pool.' });
      }
    },
    onError: (err) => toast.error('Claim failed', { description: err.message }),
  });

  const pools = poolsQuery.data || [];

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-5">
      <RoPageHeader
        title="Prospecting pools"
        sub="Curated prospect lists — hit “Claim next” to pull your next business, no cherry-picking, no collisions."
        actions={canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> New pool
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
                <CardTitle className="text-base">{pool.name}</CardTitle>
                <CardDescription>
                  {[pool.category, pool.area].filter(Boolean).join(' · ') || pool.description || '—'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <div className="flex gap-2">
                  <RoTag tone={available > 0 ? 'active' : 'ended'}>{available} available</RoTag>
                  <RoTag tone="inactive">{claimed} claimed</RoTag>
                </div>
                <Button
                  size="sm"
                  disabled={claimMutation.isPending || available === 0}
                  onClick={() => claimMutation.mutate(pool.id)}
                >
                  {claimMutation.isPending ? 'Claiming…' : 'Claim next'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
        {!poolsQuery.isLoading && pools.length === 0 && (
          <Card className="sm:col-span-2">
            <CardContent className="py-10 text-center text-muted-foreground">
              No pools yet{canManage ? ' — create one and add businesses from the Partners list.' : '.'}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New prospecting pool</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Pet Groomers — East" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Pet Grooming" />
              </div>
              <div className="space-y-1.5">
                <Label>Area</Label>
                <Input value={form.area} onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))} placeholder="East" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!form.name.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? 'Creating…' : 'Create pool'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
