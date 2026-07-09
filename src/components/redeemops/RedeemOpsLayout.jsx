import { useEffect } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { hasCapability } from '@/lib/redeemOpsPermissions';
import { RoAvatar, roRoleLabel } from '@/components/redeemops/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import House from 'lucide-react/icons/house';
import Users from 'lucide-react/icons/users';
import Kanban from 'lucide-react/icons/kanban';
import ListChecks from 'lucide-react/icons/list-checks';
import Layers from 'lucide-react/icons/layers';
import Gift from 'lucide-react/icons/gift';
import Link2 from 'lucide-react/icons/link-2';
import QrCode from 'lucide-react/icons/qr-code';
import ChartColumn from 'lucide-react/icons/chart-column';
import UserCog from 'lucide-react/icons/user-cog';
import Shield from 'lucide-react/icons/shield';
import Settings from 'lucide-react/icons/settings';
import LogOut from 'lucide-react/icons/log-out';
import '@/styles/redeem-ops-theme.css';

/**
 * Fresha-language shell for /redeem-ops/* (design source of truth:
 * claude.ai/design "Redeem Ops Design System"): slim dark icon rail on white
 * canvas. Nav items mirror the capability their page requires, same as the
 * route guards — nobody sees a link the API would 403.
 */
const NAV = [
  { title: 'Queue', url: '/redeem-ops/queue', icon: House },
  { title: 'Partners', url: '/redeem-ops/partners', icon: Users, capability: 'partners.view' },
  { title: 'Pipeline', url: '/redeem-ops/pipeline', icon: Kanban, capability: 'pipeline.view_team' },
  { title: 'Tasks', url: '/redeem-ops/tasks', icon: ListChecks, capability: 'tasks.manage' },
  { title: 'Pools', url: '/redeem-ops/pools', icon: Layers, capability: 'pools.claim_next' },
  { title: 'Rewards', url: '/redeem-ops/rewards', icon: Gift, capability: 'rewards.view' },
  { title: 'Activations', url: '/redeem-ops/activations', icon: Link2, capability: 'activations.view' },
  { title: 'Redemptions', url: '/redeem-ops/redemptions', icon: QrCode, capability: 'redemptions.verify' },
  { title: 'Analytics', url: '/redeem-ops/analytics', icon: ChartColumn, capability: 'analytics.view_own' },
  { title: 'Team', url: '/redeem-ops/team', icon: UserCog, capability: 'analytics.view_team' },
];

const FIGTREE_LINK_ID = 'ro-figtree-font';

export default function RedeemOpsLayout({ children }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  // Figtree loads only when a Redeem Ops screen mounts — the mktr admin and
  // both public brands never pay for it. The link persists once added (fonts
  // cache; removing it on unmount would just cause refetch churn).
  useEffect(() => {
    if (document.getElementById(FIGTREE_LINK_ID)) return;
    const link = document.createElement('link');
    link.id = FIGTREE_LINK_ID;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  const items = NAV.filter((item) => !item.capability || hasCapability(user, item.capability));
  const displayName = user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'Me';

  const handleLogout = () => {
    logout();
    navigate('/CustomerLogin');
  };

  return (
    <div className="ro-app">
      <aside className="ro-rail" aria-label="Redeem Ops navigation">
        <Link to="/redeem-ops" className="ro-rail-logo" aria-label="Redeem Ops home">
          R
        </Link>
        <nav className="ro-rail-nav">
          {items.map((item) => (
            <NavLink
              key={item.url}
              to={item.url}
              className={({ isActive }) => `ro-rail-item${isActive ? ' active' : ''}`}
            >
              <item.icon aria-hidden="true" />
              <span>{item.title}</span>
            </NavLink>
          ))}
        </nav>
        <div className="ro-rail-me">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Account menu"
            >
              <RoAvatar name={displayName} size={34} title={displayName} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-60">
              <DropdownMenuLabel className="font-normal">
                <p className="text-sm font-semibold m-0">{displayName}</p>
                <p className="text-xs m-0" style={{ color: 'var(--ro-azure)' }}>{roRoleLabel(user)}</p>
                <p className="text-xs text-muted-foreground m-0 truncate">{user?.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/redeem-ops/profile')}>
                <Settings className="w-4 h-4 mr-2" aria-hidden="true" />
                Edit profile
              </DropdownMenuItem>
              {user?.role === 'admin' && (
                <DropdownMenuItem onClick={() => navigate('/AdminDashboard')}>
                  <Shield className="w-4 h-4 mr-2" aria-hidden="true" />
                  MKTR admin console
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="w-4 h-4 mr-2" aria-hidden="true" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
      <main className="ro-main">{children}</main>
    </div>
  );
}
