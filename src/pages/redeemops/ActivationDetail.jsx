import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ExternalLink from 'lucide-react/icons/external-link';
import { RoTag, RoStatTile, prettyEnum } from '@/components/redeemops/ui';

const ACTIVATION_TONE = { preparing: 'pending', completed: 'done' };

const NEXT_STATUS = {
  draft: ['preparing', 'cancelled'],
  preparing: ['active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export default function ActivationDetail() {
  const { id } = useParams();
  const user = useAuthStore((s) => s.user);
  const canManage = hasCapability(user, 'activations.manage');
  const canLink = hasCapability(user, 'activations.link_campaign');
  const canAllocate = hasCapability(user, 'activations.allocate_inventory');
  const queryClient = useQueryClient();

  const detailQuery = useQuery({ queryKey: ['redeem-ops', 'activation', id], queryFn: () => redeemOpsApi.getActivation(id) });
  const metricsQuery = useQuery({
    queryKey: ['redeem-ops', 'activation', id, 'metrics'],
    queryFn: () => redeemOpsApi.getActivationMetrics(id),
    enabled: !!detailQuery.data?.activation?.campaignId,
    retry: false,
  });

  const [campaignSearch, setCampaignSearch] = useState('');
  const campaignsQuery = useQuery({
    queryKey: ['redeem-ops', 'campaign-search', campaignSearch],
    queryFn: () => redeemOpsApi.searchCampaigns(campaignSearch ? { search: campaignSearch } : {}),
    enabled: canLink,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'activation', id] });
    queryClient.invalidateQueries({ queryKey: ['redeem-ops', 'activations'] });
  };

  const linkMutation = useMutation({
    mutationFn: (campaignId) => redeemOpsApi.linkActivationCampaign(id, campaignId),
    onSuccess: () => { toast.success('Campaign linked'); invalidate(); },
    onError: (err) => toast.error('Link failed', { description: err.message }),
  });
  const statusMutation = useMutation({
    mutationFn: (status) => redeemOpsApi.setActivationStatus(id, status),
    onSuccess: () => { toast.success('Status updated'); invalidate(); },
    onError: (err) => toast.error('Status change rejected', { description: err.message }),
  });

  const [alloc, setAlloc] = useState({ delta: '', reason: '' });
  const allocMutation = useMutation({
    mutationFn: () => redeemOpsApi.changeActivationAllocation(id, parseInt(alloc.delta, 10), alloc.reason),
    onSuccess: () => {
      toast.success('Allocation updated — ledgered');
      setAlloc({ delta: '', reason: '' });
      invalidate();
    },
    onError: (err) => toast.error('Allocation change rejected', { description: err.message }),
  });

  const data = detailQuery.data;
  if (detailQuery.isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!data?.activation) return <div className="p-6 text-muted-foreground">Activation not found.</div>;
  const a = data.activation;
  const campaign = data.campaign;
  const acquisition = metricsQuery.data?.acquisition;
  // Server-enforced linkage guard (PR C): live activations cannot change their
  // campaign link — relinking/unlinking one silently starves the funnel.
  const isLive = ['preparing', 'active', 'paused'].includes(a.status);
  const issuanceSkips = data.issuanceSkips24h || [];

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="ro-title text-[26px]">
            {a.rewardOffer?.title} <span className="font-normal" style={{ color: 'var(--ro-text-3)' }}>×</span> {a.campaignNameSnapshot || 'No campaign yet'}
          </h1>
          <p className="ro-sub">
            {a.partner?.tradingName || a.partner?.legalName}
            {' · unlock: '}{a.unlockPolicy === 'agent_unlock' ? 'at consultant meeting' : 'instant on signup'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RoTag tone={ACTIVATION_TONE[a.status] || a.status}>{prettyEnum(a.status)}</RoTag>
          {canManage && (NEXT_STATUS[a.status] || []).length > 0 && (
            <Select onValueChange={(s) => statusMutation.mutate(s)}>
              <SelectTrigger className="w-36 h-10"><SelectValue placeholder="Move to…" /></SelectTrigger>
              <SelectContent>
                {NEXT_STATUS[a.status].map((s) => <SelectItem key={s} value={s}>{prettyEnum(s)}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="ro-tiles">
        <RoStatTile label="Allocated" value={a.allocatedQuantity} />
        <RoStatTile label="Issued" value={a.issuedCount} />
        <RoStatTile label="Redeemed" value={a.redeemedCount} />
      </div>

      {issuanceSkips.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Skipped issuance — last 24h</CardTitle>
            <CardDescription>
              Sign-ups that did NOT earn a reward, by reason. A growing count here means the
              funnel is starved (allocation, offer status, activation link) or being farmed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {issuanceSkips.map((s) => (
                <span
                  key={s.reason}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs"
                  style={{ color: '#B45309' }}
                >
                  ⚠ {prettyEnum(s.reason)} <strong>×{s.count}</strong>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">MKTR campaign</CardTitle>
            <CardDescription>Read-only reference — manage the campaign itself on mktr.sg.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {campaign ? (
              <div className="space-y-2 text-sm">
                <p className="font-medium">{campaign.name}</p>
                <p className="text-muted-foreground">
                  Status: {campaign.status} · Host: {campaign.customerHost}
                </p>
                <p className="text-muted-foreground break-all">{campaign.publicUrl}</p>
                {acquisition && (
                  <p className="text-muted-foreground">
                    Leads: {acquisition.totalLeads ?? acquisition.leads ?? '—'}
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <Button asChild size="sm" variant="outline">
                    <a href={campaign.mktrAdminUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Open in MKTR
                    </a>
                  </Button>
                  {canLink && !isLive && (
                    <Button size="sm" variant="ghost" onClick={() => linkMutation.mutate(null)}>Unlink</Button>
                  )}
                </div>
                {canLink && isLive && (
                  <p className="text-xs m-0" style={{ color: 'var(--ro-text-3)' }}>
                    Complete or cancel the activation to change its campaign link — unlinking a live activation stops issuance.
                  </p>
                )}
              </div>
            ) : canLink && isLive ? (
              <p className="text-sm text-muted-foreground">
                No campaign linked — issuance is stopped. Complete or cancel the activation first, then link the campaign on a fresh activation.
              </p>
            ) : canLink ? (
              <div className="space-y-2">
                <Input
                  placeholder="Search campaigns…"
                  value={campaignSearch}
                  onChange={(e) => setCampaignSearch(e.target.value)}
                />
                <div className="max-h-56 overflow-y-auto space-y-1">
                  {(campaignsQuery.data || []).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full text-left rounded-md border border-border p-2 hover:bg-accent transition-colors disabled:opacity-50"
                      disabled={!!c.linkedActivationId || linkMutation.isPending}
                      onClick={() => linkMutation.mutate(c.id)}
                    >
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.status} · {c.customerHost}
                        {c.linkedActivationId ? ' · already linked to another activation' : ''}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No campaign linked.</p>
            )}
          </CardContent>
        </Card>

        {canAllocate && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Allocation</CardTitle>
              <CardDescription>
                Draws from the reward's unallocated pool; can never exceed committed supply or drop below issued.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Change (±)</Label>
                  <Input type="number" value={alloc.delta} onChange={(e) => setAlloc((v) => ({ ...v, delta: e.target.value }))} placeholder="+50 or -20" />
                </div>
                <div className="space-y-1.5">
                  <Label>Reason</Label>
                  <Input value={alloc.reason} onChange={(e) => setAlloc((v) => ({ ...v, reason: e.target.value }))} placeholder="Extended campaign run" />
                </div>
              </div>
              <Button
                size="sm"
                disabled={!alloc.delta || parseInt(alloc.delta, 10) === 0 || allocMutation.isPending}
                onClick={() => allocMutation.mutate()}
              >
                Apply change
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
