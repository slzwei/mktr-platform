import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RoTag, RoStatTile, prettyEnum } from '@/components/redeemops/ui';

export default function RewardDetail() {
  const { id } = useParams();
  const user = useAuthStore((s) => s.user);
  const canManage = hasCapability(user, 'rewards.manage');
  const canAdjust = hasCapability(user, 'inventory.adjust');
  const queryClient = useQueryClient();

  const offerQuery = useQuery({ queryKey: ['redeem-ops', 'reward', id], queryFn: () => redeemOpsApi.getReward(id) });
  const ledgerQuery = useQuery({ queryKey: ['redeem-ops', 'reward', id, 'ledger'], queryFn: () => redeemOpsApi.getRewardLedger(id) });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'reward', id] });
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'rewards'] });
  };

  const [adjust, setAdjust] = useState({ type: 'committed_increase', quantity: '', reason: '' });
  const adjustMutation = useMutation({
    mutationFn: () => redeemOpsApi.adjustRewardInventory(id, {
      type: adjust.type, quantity: parseInt(adjust.quantity, 10), reason: adjust.reason,
    }),
    onSuccess: () => {
      toast.success('Inventory updated — ledger entry written');
      setAdjust({ type: 'committed_increase', quantity: '', reason: '' });
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'reward', id, 'ledger'] });
    },
    onError: (err) => toast.error('Inventory change rejected', { description: err.message }),
  });

  const statusMutation = useMutation({
    mutationFn: (status) => redeemOpsApi.setRewardStatus(id, status),
    onSuccess: () => { toast.success('Status updated'); invalidate(); },
    onError: (err) => toast.error('Status change failed', { description: err.message }),
  });

  const [terms, setTerms] = useState('');
  const termsMutation = useMutation({
    mutationFn: () => redeemOpsApi.addRewardTerms(id, { freeText: terms }),
    onSuccess: () => { toast.success('New terms version saved'); setTerms(''); invalidate(); },
    onError: (err) => toast.error('Could not save terms', { description: err.message }),
  });

  const data = offerQuery.data;
  if (offerQuery.isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!data?.offer) return <div className="p-6 text-muted-foreground">Reward not found.</div>;
  const offer = data.offer;
  const remaining = offer.committedQuantity - offer.allocatedQuantity;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="ro-title text-[26px]">{offer.title}</h1>
          <p className="ro-sub">
            {offer.partner?.tradingName || offer.partner?.legalName}
            {' · '}{prettyEnum(offer.rewardType)}
            {offer.retailValue ? ` · worth S$${offer.retailValue}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RoTag tone={offer.status}>{prettyEnum(offer.status)}</RoTag>
          {canManage && (
            <Select value={offer.status} onValueChange={(s) => statusMutation.mutate(s)}>
              <SelectTrigger className="w-32 h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['draft', 'active', 'paused', 'ended'].map((s) => (
                  <SelectItem key={s} value={s}>{prettyEnum(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="ro-tiles">
        <RoStatTile label="Committed" value={offer.committedQuantity} />
        <RoStatTile label="Allocated" value={offer.allocatedQuantity} />
        <RoStatTile label="Unallocated" value={remaining} />
        <RoStatTile label="Issued" value={offer.issuedQuantity} />
        <RoStatTile label="Redeemed" value={offer.redeemedQuantity} />
      </div>

      <Tabs defaultValue="ledger">
        <div className="max-w-full overflow-x-auto">
        <TabsList className="w-max">
          <TabsTrigger value="ledger">Inventory ledger</TabsTrigger>
          <TabsTrigger value="terms">Terms</TabsTrigger>
          {canAdjust && <TabsTrigger value="adjust">Adjust supply</TabsTrigger>}
        </TabsList>
        </div>

        <TabsContent value="ledger">
          <Card>
            <CardContent className="pt-5 space-y-2">
              {(ledgerQuery.data || []).map((e) => (
                <div key={e.id} className="flex items-center justify-between border-b border-border pb-2 last:border-0 text-sm">
                  <span className="flex items-center gap-2">
                    <RoTag tone="inactive" size="sm">{prettyEnum(e.type)}</RoTag>
                    <span className="tabular-nums">{e.quantity} unit{e.quantity === 1 ? '' : 's'}</span>
                    {e.reason ? <span className="text-muted-foreground">— {e.reason}</span> : ''}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {e.actor?.fullName || e.actorType} · {new Date(e.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
              {(ledgerQuery.data || []).length === 0 && (
                <p className="text-sm text-muted-foreground">No movements yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="terms">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Terms (version {offer.currentTermsVersion})</CardTitle>
              <CardDescription>Terms are versioned — every change is a new version, never an overwrite.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(data.terms || []).map((t) => (
                <div key={t.id} className="border-b border-border pb-3 last:border-0">
                  <p className="text-xs font-semibold text-muted-foreground">v{t.version} · {new Date(t.createdAt).toLocaleDateString()}</p>
                  <p className="text-sm whitespace-pre-wrap">{t.freeText || JSON.stringify(t.structured)}</p>
                </div>
              ))}
              {canManage && (
                <div className="space-y-2 pt-2">
                  <Textarea
                    rows={3}
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    placeholder="First-time customers only. Weekdays before 5pm. Appointment required."
                  />
                  <Button size="sm" disabled={!terms.trim() || termsMutation.isPending} onClick={() => termsMutation.mutate()}>
                    Save as v{offer.currentTermsVersion + 1}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {canAdjust && (
          <TabsContent value="adjust">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Adjust committed supply</CardTitle>
                <CardDescription>
                  Guarded: committed can never drop below what's already allocated. A reason is mandatory and ledgered.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Direction</Label>
                  <Select value={adjust.type} onValueChange={(v) => setAdjust((a) => ({ ...a, type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="committed_increase">Increase</SelectItem>
                      <SelectItem value="committed_decrease">Decrease</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Quantity</Label>
                  <Input type="number" min="1" value={adjust.quantity} onChange={(e) => setAdjust((a) => ({ ...a, quantity: e.target.value }))} />
                </div>
                <div className="space-y-1.5 col-span-3">
                  <Label>Reason *</Label>
                  <Input value={adjust.reason} onChange={(e) => setAdjust((a) => ({ ...a, reason: e.target.value }))} placeholder="Partner topped up 50 more for December" />
                </div>
                <Button
                  size="sm" className="justify-self-start"
                  disabled={!adjust.quantity || !adjust.reason.trim() || adjustMutation.isPending}
                  onClick={() => adjustMutation.mutate()}
                >
                  Apply
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
