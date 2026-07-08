import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import Loader2 from 'lucide-react/icons/loader-2';
import { getDefaultRouteForRole } from '@/lib/utils';
import { IS_REDEEM_BUILD, MktrOnlyRedirect } from '@/components/auth/BrandRouteGuards';
import { isRedeemOpsUser, hasCapability } from '@/lib/redeemOpsPermissions';

/**
 * Route guard for /redeem-ops/* (docs/redeem-ops/ROUTE_MAP.md §2). Client-side
 * convenience only — the API enforces capabilities server-side regardless.
 * Mirrors ProtectedRoute's shape: on the redeem consumer build the whole
 * component is swapped for the mktr.sg redirect so no auth logic runs there.
 */
function RedeemOpsRouteImpl({ children, capability = null }) {
  const { user, token } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (token && user) {
      const status = user.approvalStatus || user.status;
      if (status === 'pending' || status === 'pending_approval') {
        navigate('/PendingApproval');
        return;
      }
      if (!isRedeemOpsUser(user)) {
        navigate(getDefaultRouteForRole(user.role));
        return;
      }
      if (capability && !hasCapability(user, capability)) {
        navigate('/redeem-ops');
        return;
      }
    } else {
      navigate('/CustomerLogin', { state: { from: location } });
      return;
    }

    setIsLoading(false);
  }, [navigate, capability, location, token, user]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return null;
  }

  return children;
}

export default function RedeemOpsRoute(props) {
  if (IS_REDEEM_BUILD) return <MktrOnlyRedirect />;
  return <RedeemOpsRouteImpl {...props} />;
}
