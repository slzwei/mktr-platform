import { useQuery } from '@tanstack/react-query';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

function Section({ title, description, children }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">{children}</div>
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const user = useAuthStore((s) => s.user);
  const teamWide = hasCapability(user, 'analytics.view_team');

  const outreach = useQuery({
    queryKey: ['redeem-ops', 'analytics', 'outreach'],
    queryFn: () => redeemOpsApi.getOutreachAnalytics(),
  });
  const categories = useQuery({
    queryKey: ['redeem-ops', 'analytics', 'categories'],
    queryFn: () => redeemOpsApi.getCategoryAnalytics(),
    enabled: teamWide,
  });
  const rewards = useQuery({
    queryKey: ['redeem-ops', 'analytics', 'rewards'],
    queryFn: () => redeemOpsApi.getRewardAnalytics(),
    enabled: teamWide,
  });
  const funnels = useQuery({
    queryKey: ['redeem-ops', 'analytics', 'activations'],
    queryFn: () => redeemOpsApi.getActivationAnalytics(),
    enabled: teamWide,
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Acquisition numbers come from MKTR's own metrics — nothing is re-counted here.
        </p>
      </div>

      <Section title={teamWide ? 'Outreach — by team member' : 'Outreach — your performance'}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead className="text-right">Owned</TableHead>
              <TableHead className="text-right">Contacted</TableHead>
              <TableHead className="text-right">Touches</TableHead>
              <TableHead className="text-right">Replies</TableHead>
              <TableHead className="text-right">Meetings</TableHead>
              <TableHead className="text-right">Proposals</TableHead>
              <TableHead className="text-right">Partnered</TableHead>
              <TableHead className="text-right">Conv.</TableHead>
              <TableHead className="text-right">Avg h → 1st touch</TableHead>
              <TableHead className="text-right">Stale</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(outreach.data?.members || []).map((m) => (
              <TableRow key={m.userId}>
                <TableCell className="font-medium">{m.name}</TableCell>
                <TableCell className="text-right">{m.owned}</TableCell>
                <TableCell className="text-right">{m.contacted}</TableCell>
                <TableCell className="text-right">{m.outboundTouches}</TableCell>
                <TableCell className="text-right">{m.replies}</TableCell>
                <TableCell className="text-right">{m.meetingsBooked}</TableCell>
                <TableCell className="text-right">{m.proposalsSent}</TableCell>
                <TableCell className="text-right">{m.partnered}</TableCell>
                <TableCell className="text-right">{m.partneredRate}%</TableCell>
                <TableCell className="text-right">{m.avgHoursToFirstOutreach ?? '—'}</TableCell>
                <TableCell className="text-right">{m.stale}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      {teamWide && (
        <>
          <Section title="Category conversion" description="Where outreach converts — and where it doesn't.">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Contacted</TableHead>
                  <TableHead className="text-right">Replied</TableHead>
                  <TableHead className="text-right">Meetings</TableHead>
                  <TableHead className="text-right">Partnered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(categories.data?.categories || []).map((c) => (
                  <TableRow key={c.category}>
                    <TableCell className="font-medium">{c.category}</TableCell>
                    <TableCell className="text-right">{c.total}</TableCell>
                    <TableCell className="text-right">{c.contacted}</TableCell>
                    <TableCell className="text-right">{c.replied}</TableCell>
                    <TableCell className="text-right">{c.meetings}</TableCell>
                    <TableCell className="text-right">{c.partnered}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section title="Reward supply" description="Committed → allocated → issued → redeemed (ledger-audited counters).">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reward</TableHead>
                  <TableHead>Partner</TableHead>
                  <TableHead className="text-right">Committed</TableHead>
                  <TableHead className="text-right">Allocated</TableHead>
                  <TableHead className="text-right">Issued</TableHead>
                  <TableHead className="text-right">Redeemed</TableHead>
                  <TableHead className="text-right">Redemption rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rewards.data?.rewards || []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell className="text-muted-foreground">{r.partnerName || '—'}</TableCell>
                    <TableCell className="text-right">{r.committed}</TableCell>
                    <TableCell className="text-right">{r.allocated}</TableCell>
                    <TableCell className="text-right">{r.issued}</TableCell>
                    <TableCell className="text-right">{r.redeemed}</TableCell>
                    <TableCell className="text-right">{r.redemptionRate}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section title="Activation funnels" description="MKTR acquisition + Redeem fulfilment, per activation.">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Activation</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Leads (MKTR)</TableHead>
                  <TableHead className="text-right">Issued</TableHead>
                  <TableHead className="text-right">Redeemed</TableHead>
                  <TableHead>Renewal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(funnels.data?.funnels || []).map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">
                      {f.rewardTitle} <span className="text-muted-foreground">· {f.partnerName}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{f.campaignName || 'Not linked'}</TableCell>
                    <TableCell><Badge variant={f.status === 'active' ? 'default' : 'secondary'}>{f.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {f.acquisition?.totalLeads ?? f.acquisition?.leads ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">{f.reward.issued}</TableCell>
                    <TableCell className="text-right">{f.reward.redeemed}</TableCell>
                    <TableCell className="text-muted-foreground">{f.renewalOutcome || 'pending'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        </>
      )}
    </div>
  );
}
