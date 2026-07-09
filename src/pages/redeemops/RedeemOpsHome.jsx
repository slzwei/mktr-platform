import { Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import { Button } from '@/components/ui/button';
import { RoPageHeader } from '@/components/redeemops/ui';
import House from 'lucide-react/icons/house';
import Users from 'lucide-react/icons/users';
import Gift from 'lucide-react/icons/gift';
import UserCog from 'lucide-react/icons/user-cog';

/**
 * Redeem Ops overview. Deliberately honest about what exists: modules that
 * haven't shipped are named with their phase, not faked as functional
 * placeholders (docs/redeem-ops/ROUTE_MAP.md §2).
 */
function HomeCard({ icon: Icon, iconBg, iconFg, title, body, children }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <span className="ro-icon-circle mb-3" style={{ background: iconBg, color: iconFg }} aria-hidden="true">
        <Icon className="w-4 h-4" />
      </span>
      <p className="text-[15px] font-bold m-0">{title}</p>
      <p className="text-[13px] mt-1 mb-4 leading-relaxed" style={{ color: 'var(--ro-text-2)' }}>{body}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export default function RedeemOpsHome() {
  const user = useAuthStore((s) => s.user);
  const canManageTeam = hasCapability(user, 'team.manage_access');
  const canSeeTeam = hasCapability(user, 'analytics.view_team');
  const canSeeRewards = hasCapability(user, 'rewards.view');

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <RoPageHeader
        title="Redeem Ops"
        sub="Partner prospecting, rewards, and redemption operations."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <HomeCard
          icon={House}
          iconBg="var(--ro-tag-blue-bg)"
          iconFg="var(--ro-tag-blue-fg)"
          title="Your day"
          body="Start in the queue — overdue follow-ups, first touches and fresh replies, in order of urgency."
        >
          <Button asChild size="sm"><Link to="/redeem-ops/queue">My queue</Link></Button>
        </HomeCard>

        <HomeCard
          icon={Users}
          iconBg="var(--ro-tag-purple-bg)"
          iconFg="var(--ro-tag-purple-fg)"
          title="Partner CRM"
          body="Search the shared business database, claim prospects, log outreach, move the pipeline."
        >
          <Button asChild size="sm" variant="outline"><Link to="/redeem-ops/partners">Partners</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/redeem-ops/pools">Pools</Link></Button>
        </HomeCard>

        {canSeeRewards && (
          <HomeCard
            icon={Gift}
            iconBg="var(--ro-tag-green-bg)"
            iconFg="var(--ro-tag-green-fg)"
            title="Rewards & fulfilment"
            body="Partner-funded reward supply, campaign activations and counter redemptions — all ledgered."
          >
            <Button asChild size="sm" variant="outline"><Link to="/redeem-ops/rewards">Rewards</Link></Button>
            <Button asChild size="sm" variant="outline"><Link to="/redeem-ops/activations">Activations</Link></Button>
          </HomeCard>
        )}

        {canSeeTeam && (
          <HomeCard
            icon={UserCog}
            iconBg="var(--ro-tag-yellow-bg)"
            iconFg="var(--ro-tag-yellow-fg)"
            title="Team & access"
            body={canManageTeam
              ? 'Invite outreach staff and manage Redeem Ops sub-roles.'
              : 'See who is on the Redeem Ops team.'}
          >
            <Button asChild size="sm" variant="outline"><Link to="/redeem-ops/team">Open Team</Link></Button>
          </HomeCard>
        )}
      </div>
    </div>
  );
}
