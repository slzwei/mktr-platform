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

const EMPTY = { partnerOrganisationId: '', title: '', rewardType: 'free_service', retailValue: '', committedQuantity: '' };

export default function RewardsPage() {
  const user = useAuthStore((s) => s.user);
  const canManage = hasCapability(user, 'rewards.manage');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const offersQuery = useQuery({ queryKey: ['redeem-ops', 'rewards'], queryFn: () => redeemOpsApi.listRewards() });
  const partnersQuery = useQuery({
    queryKey: ['redeem-ops', 'partners', { stage: 'PARTNERED' }],
    queryFn: () => redeemOpsApi.listPartners({ stage: 'PARTNERED', limit: 100 }),
    enabled: canManage,
  });
  const constants = useQuery({
    queryKey: ['redeem-ops', 'constants'],
    queryFn: redeemOpsApi.getConstants,
    staleTime: Infinity,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const createMutation = useMutation({
    mutationFn: () => redeemOpsApi.createReward({
      ...form,
      retailValue: form.retailValue ? Number(form.retailValue) : null,
      committedQuantity: form.committedQuantity ? parseInt(form.committedQuantity, 10) : 0,
    }),
    onSuccess: (offer) => {
      toast.success('Reward offer created');
      setCreateOpen(false); setForm(EMPTY);
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'rewards'] });
      if (offer?.id) navigate(`/redeem-ops/rewards/${offer.id}`);
    },
    onError: (err) => toast.error('Could not create reward', { description: err.message }),
  });

  const offers = offersQuery.data || [];
  const partners = partnersQuery.data?.partners || [];
  const rewardTypes = constants.data?.rewardTypes || [];

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4 md:space-y-5">
      <RoPageHeader
        title="Rewards"
        sub="Partner-funded reward supply — every quantity movement is ledgered."
        actions={canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> New reward
          </Button>
        )}
      />

      <Card>
        <CardContent className="pt-4">
          <div className="md:hidden -mx-6 -mt-2">
            {offers.map((o) => (
              <RoMobileCard key={o.id} className="px-6" onClick={() => navigate(`/redeem-ops/rewards/${o.id}`)}>
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-[14px] leading-tight">{o.title}</span>
                    <span className="block text-xs truncate mt-0.5" style={{ color: 'var(--ro-text-2)' }}>
                      {o.partner?.tradingName || o.partner?.legalName || '—'}
                    </span>
                  </span>
                  <RoTag tone={o.status} size="sm">{prettyEnum(o.status)}</RoTag>
                </span>
                <span className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                  <RoStat label="committed">{o.committedQuantity}</RoStat>
                  <RoStat label="allocated">{o.allocatedQuantity}</RoStat>
                  <RoStat label="issued">{o.issuedQuantity}</RoStat>
                  <RoStat label="redeemed">{o.redeemedQuantity}</RoStat>
                </span>
              </RoMobileCard>
            ))}
            {!offersQuery.isLoading && offers.length === 0 && (
              <p className="text-sm text-center py-8 m-0" style={{ color: 'var(--ro-text-2)' }}>
                No rewards yet{canManage ? ' — create the first one from a PARTNERED business.' : '.'}
              </p>
            )}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reward</TableHead>
                  <TableHead>Partner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Committed</TableHead>
                  <TableHead className="text-right">Allocated</TableHead>
                  <TableHead className="text-right">Issued</TableHead>
                  <TableHead className="text-right">Redeemed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offers.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => navigate(`/redeem-ops/rewards/${o.id}`)}>
                    <TableCell className="font-medium">{o.title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {o.partner?.tradingName || o.partner?.legalName || '—'}
                    </TableCell>
                    <TableCell><RoTag tone={o.status} size="sm">{prettyEnum(o.status)}</RoTag></TableCell>
                    <TableCell className="text-right">{o.committedQuantity}</TableCell>
                    <TableCell className="text-right">{o.allocatedQuantity}</TableCell>
                    <TableCell className="text-right">{o.issuedQuantity}</TableCell>
                    <TableCell className="text-right">{o.redeemedQuantity}</TableCell>
                  </TableRow>
                ))}
                {!offersQuery.isLoading && offers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                      No rewards yet{canManage ? ' — create the first one from a PARTNERED business.' : '.'}
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
            <DialogTitle>New reward offer</DialogTitle>
            <DialogDescription>The committed quantity becomes the opening ledger entry.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Partner *</Label>
              <Select value={form.partnerOrganisationId} onValueChange={(v) => setForm((f) => ({ ...f, partnerOrganisationId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select a PARTNERED business" /></SelectTrigger>
                <SelectContent>
                  {partners.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.tradingName || p.brandName || p.legalName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Complimentary Express Manicure" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-1">
                <Label>Type</Label>
                <Select value={form.rewardType} onValueChange={(v) => setForm((f) => ({ ...f, rewardType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {rewardTypes.map((t) => <SelectItem key={t} value={t}>{t.replaceAll('_', ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Retail value (S$)</Label>
                <Input type="number" value={form.retailValue} onChange={(e) => setForm((f) => ({ ...f, retailValue: e.target.value }))} placeholder="35" />
              </div>
              <div className="space-y-1.5">
                <Label>Committed qty</Label>
                <Input type="number" value={form.committedQuantity} onChange={(e) => setForm((f) => ({ ...f, committedQuantity: e.target.value }))} placeholder="100" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!form.partnerOrganisationId || !form.title.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Creating…' : 'Create reward'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
