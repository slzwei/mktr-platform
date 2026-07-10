import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
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
import { RoMobileCard, RoStat, RoPageHeader, RoTag, prettyEnum } from '@/components/redeemops/ui';

const ACTIVATION_TONE = { preparing: 'pending', completed: 'done' };

export default function ActivationsPage() {
  const user = useAuthStore((s) => s.user);
  const canManage = hasCapability(user, 'activations.manage');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const listQuery = useQuery({ queryKey: ['redeem-ops', 'activations'], queryFn: () => redeemOpsApi.listActivations() });
  const rewardsQuery = useQuery({
    queryKey: ['redeem-ops', 'rewards'],
    queryFn: () => redeemOpsApi.listRewards(),
    enabled: canManage,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ rewardOfferId: '', allocatedQuantity: '' });

  const createMutation = useMutation({
    mutationFn: () => redeemOpsApi.createActivation({
      rewardOfferId: form.rewardOfferId,
      allocatedQuantity: form.allocatedQuantity ? parseInt(form.allocatedQuantity, 10) : 0,
    }),
    onSuccess: (activation) => {
      toast.success('Activation created');
      setCreateOpen(false); setForm({ rewardOfferId: '', allocatedQuantity: '' });
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'activations'] });
      if (activation?.id) navigate(`/redeem-ops/activations/${activation.id}`);
    },
    onError: (err) => toast.error('Could not create activation', { description: err.message }),
  });

  const activations = listQuery.data || [];
  const rewards = (rewardsQuery.data || []).filter((r) => r.status !== 'ended');

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4 md:space-y-5">
      <RoPageHeader
        title="Activations"
        sub="A reward allocated to one MKTR campaign — the campaign itself stays managed on mktr.sg."
        actions={canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> New activation
          </Button>
        )}
      />

      <Card>
        <CardContent className="pt-4">
          <div className="md:hidden -mx-6 -mt-2">
            {activations.map((a) => (
              <RoMobileCard key={a.id} className="px-6" onClick={() => navigate(`/redeem-ops/activations/${a.id}`)}>
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-[14px] leading-tight">{a.rewardOffer?.title || '—'}</span>
                    <span className="block text-xs truncate mt-0.5" style={{ color: 'var(--ro-text-2)' }}>
                      {a.partner?.tradingName || a.partner?.legalName || '—'}
                      {' · '}
                      {a.campaignNameSnapshot || (a.campaignId ? a.campaignId.slice(0, 8) : 'Not linked')}
                    </span>
                  </span>
                  <RoTag tone={ACTIVATION_TONE[a.status] || a.status} size="sm">{prettyEnum(a.status)}</RoTag>
                </span>
                <span className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                  <RoStat label="allocated">{a.allocatedQuantity}</RoStat>
                  <RoStat label="issued">{a.issuedCount}</RoStat>
                  <RoStat label="redeemed">{a.redeemedCount}</RoStat>
                </span>
              </RoMobileCard>
            ))}
            {!listQuery.isLoading && activations.length === 0 && (
              <p className="text-sm text-center py-8 m-0" style={{ color: 'var(--ro-text-2)' }}>
                No activations yet{canManage ? ' — create one from an active reward.' : '.'}
              </p>
            )}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reward</TableHead>
                  <TableHead>Partner</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Allocated</TableHead>
                  <TableHead className="text-right">Issued</TableHead>
                  <TableHead className="text-right">Redeemed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activations.map((a) => (
                  <TableRow key={a.id} className="cursor-pointer" onClick={() => navigate(`/redeem-ops/activations/${a.id}`)}>
                    <TableCell className="font-medium">{a.rewardOffer?.title || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{a.partner?.tradingName || a.partner?.legalName || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.campaignNameSnapshot || (a.campaignId ? a.campaignId.slice(0, 8) : 'Not linked')}
                    </TableCell>
                    <TableCell><RoTag tone={ACTIVATION_TONE[a.status] || a.status} size="sm">{prettyEnum(a.status)}</RoTag></TableCell>
                    <TableCell className="text-right">{a.allocatedQuantity}</TableCell>
                    <TableCell className="text-right">{a.issuedCount}</TableCell>
                    <TableCell className="text-right">{a.redeemedCount}</TableCell>
                  </TableRow>
                ))}
                {!listQuery.isLoading && activations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                      No activations yet{canManage ? ' — create one from an active reward.' : '.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New activation</DialogTitle>
            <DialogDescription>
              Allocation draws from the reward's unallocated supply (oversubscription is impossible).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Reward offer *</Label>
              <Select value={form.rewardOfferId} onValueChange={(v) => setForm((f) => ({ ...f, rewardOfferId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select a reward" /></SelectTrigger>
                <SelectContent>
                  {rewards.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.title} ({r.committedQuantity - r.allocatedQuantity} unallocated)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Allocate quantity</Label>
              <Input type="number" min="0" value={form.allocatedQuantity} onChange={(e) => setForm((f) => ({ ...f, allocatedQuantity: e.target.value }))} placeholder="100" />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!form.rewardOfferId || createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
