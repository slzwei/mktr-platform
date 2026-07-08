import { Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Users from 'lucide-react/icons/users';
import Building2 from 'lucide-react/icons/building-2';

/**
 * Redeem Ops overview (Phase 1 shell). Deliberately honest about what exists:
 * modules that haven't shipped are named with their phase, not faked as
 * functional placeholders (docs/redeem-ops/ROUTE_MAP.md §2).
 */
export default function RedeemOpsHome() {
  const user = useAuthStore((s) => s.user);
  const canManageTeam = hasCapability(user, 'team.manage_access');

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Redeem Ops</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Partner prospecting, rewards, and redemption operations.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="w-4 h-4" aria-hidden="true" />
              Team &amp; access
            </CardTitle>
            <CardDescription>
              {canManageTeam
                ? 'Invite outreach staff and manage Redeem Ops sub-roles.'
                : 'See who is on the Redeem Ops team.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="sm">
              <Link to="/redeem-ops/team">Open Team</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
              <Building2 className="w-4 h-4" aria-hidden="true" />
              Partner CRM
            </CardTitle>
            <CardDescription>
              Business search, duplicate-safe claiming, activity timeline, and the partner
              pipeline arrive in Phase 2.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
