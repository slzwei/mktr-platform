import { useQuery } from '@tanstack/react-query';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { RoMobileCard, RoStat, RoPageHeader, RoTag, prettyEnum } from '@/components/redeemops/ui';

function Section({ title, description, mobile, children }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {mobile && <div className="md:hidden -mx-6 -mt-2">{mobile}</div>}
        <div className={mobile ? 'hidden md:block overflow-x-auto' : 'overflow-x-auto'}>{children}</div>
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
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-5">
      <RoPageHeader
        title="Analytics"
        sub="Acquisition numbers come from MKTR's own metrics — nothing is re-counted here."
      />

      <Section
        title={teamWide ? 'Outreach — by team member' : 'Outreach — your performance'}
        mobile={(outreach.data?.members || []).map((m) => (
          <RoMobileCard key={m.userId} className="px-6">
            <span className="flex items-center gap-2">
              <span className="font-semibold text-[14px] flex-1 min-w-0 truncate">{m.name}</span>
              <RoTag tone="primary" size="sm">{m.partneredRate}% conv.</RoTag>
            </span>
            <span className="grid grid-cols-4 gap-2 mt-2.5">
              <RoStat label="Owned">{m.owned}</RoStat>
              <RoStat label="Contacted">{m.contacted}</RoStat>
              <RoStat label="Touches">{m.outboundTouches}</RoStat>
              <RoStat label="Replies">{m.replies}</RoStat>
              <RoStat label="Meetings">{m.meetingsBooked}</RoStat>
              <RoStat label="Proposals">{m.proposalsSent}</RoStat>
              <RoStat label="Partnered">{m.partnered}</RoStat>
              <RoStat label="Stale">{m.stale}</RoStat>
            </span>
            <span className="block text-[11px] mt-2" style={{ color: 'var(--ro-text-3)' }}>
              Avg {m.avgHoursToFirstOutreach ?? '—'}h to first touch
            </span>
          </RoMobileCard>
        ))}
      >
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
          <Section
            title="Category conversion"
            description="Where outreach converts — and where it doesn't."
            mobile={(categories.data?.categories || []).map((c) => (
              <RoMobileCard key={c.category} className="px-6">
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-[14px] flex-1 min-w-0 truncate">{c.category}</span>
                  <RoTag tone="primary" size="sm">{c.partnered} partnered</RoTag>
                </span>
                <span className="grid grid-cols-4 gap-2 mt-2.5">
                  <RoStat label="Total">{c.total}</RoStat>
                  <RoStat label="Contacted">{c.contacted}</RoStat>
                  <RoStat label="Replied">{c.replied}</RoStat>
                  <RoStat label="Meetings">{c.meetings}</RoStat>
                </span>
              </RoMobileCard>
            ))}
          >
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

          <Section
            title="Reward supply"
            description="Committed → allocated → issued → redeemed (ledger-audited counters)."
            mobile={(rewards.data?.rewards || []).map((r) => (
              <RoMobileCard key={r.id} className="px-6">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-[14px] leading-tight truncate">{r.title}</span>
                    <span className="block text-xs truncate" style={{ color: 'var(--ro-text-2)' }}>{r.partnerName || '—'}</span>
                  </span>
                  <RoTag tone="primary" size="sm">{r.redemptionRate}% redeemed</RoTag>
                </span>
                <span className="grid grid-cols-4 gap-2 mt-2.5">
                  <RoStat label="Committed">{r.committed}</RoStat>
                  <RoStat label="Allocated">{r.allocated}</RoStat>
                  <RoStat label="Issued">{r.issued}</RoStat>
                  <RoStat label="Redeemed">{r.redeemed}</RoStat>
                </span>
              </RoMobileCard>
            ))}
          >
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

          <Section
            title="Activation funnels"
            description="MKTR acquisition + Redeem fulfilment, per activation."
            mobile={(funnels.data?.funnels || []).map((f) => (
              <RoMobileCard key={f.id} className="px-6">
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-[14px] leading-tight">{f.rewardTitle}</span>
                    <span className="block text-xs truncate mt-0.5" style={{ color: 'var(--ro-text-2)' }}>
                      {f.partnerName}{f.campaignName ? ` · ${f.campaignName}` : ' · Not linked'}
                    </span>
                  </span>
                  <RoTag tone={f.status} size="sm">{prettyEnum(f.status)}</RoTag>
                </span>
                <span className="grid grid-cols-3 gap-2 mt-2.5">
                  <RoStat label="Leads (MKTR)">{f.acquisition?.totalLeads ?? f.acquisition?.leads ?? '—'}</RoStat>
                  <RoStat label="Issued">{f.reward.issued}</RoStat>
                  <RoStat label="Redeemed">{f.reward.redeemed}</RoStat>
                </span>
                <span className="block text-[11px] mt-2" style={{ color: 'var(--ro-text-3)' }}>
                  Renewal: {f.renewalOutcome || 'pending'}
                </span>
              </RoMobileCard>
            ))}
          >
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
                    <TableCell><RoTag tone={f.status} size="sm">{prettyEnum(f.status)}</RoTag></TableCell>
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
