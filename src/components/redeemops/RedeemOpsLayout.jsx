import { useEffect, useState } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
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
import Compass from 'lucide-react/icons/compass';
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
import Ellipsis from 'lucide-react/icons/ellipsis';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
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
  // Discover has no capability gate (all principals), so its own build flag is what
  // keeps it hidden until go-live (backend DISCOVERY_ENABLED + Apify token).
  ...(import.meta.env.VITE_DISCOVERY_ENABLED === 'true'
    ? [{ title: 'Discover', url: '/redeem-ops/discover', icon: Compass }]
    : []),
  { title: 'Pipeline', url: '/redeem-ops/pipeline', icon: Kanban, capability: 'pipeline.view_team' },
  { title: 'Tasks', url: '/redeem-ops/tasks', icon: ListChecks, capability: 'tasks.manage' },
  { title: 'Pools', url: '/redeem-ops/pools', icon: Layers, capability: 'pools.claim_next' },
  { title: 'Rewards', url: '/redeem-ops/rewards', icon: Gift, capability: 'rewards.view' },
  { title: 'Activations', url: '/redeem-ops/activations', icon: Link2, capability: 'activations.view' },
  { title: 'Redemptions', url: '/redeem-ops/redemptions', icon: QrCode, capability: 'redemptions.verify' },
  { title: 'Analytics', url: '/redeem-ops/analytics', icon: ChartColumn, capability: 'analytics.view_own' },
  { title: 'Team', url: '/redeem-ops/team', icon: UserCog, capability: 'analytics.view_team' },
  { title: 'Settings', url: '/redeem-ops/settings', icon: Settings, capability: 'settings.manage' },
];

const FIGTREE_LINK_ID = 'ro-figtree-font';

export default function RedeemOpsLayout({ children }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

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
  // Mobile bottom bar (design: screens/mobile-shell.html): first four sections
  // get a slot, the rest live behind "More" with the account block.
  const barItems = items.slice(0, 4);
  const moreItems = items.slice(4);
  const moreActive = moreItems.some((i) => location.pathname.startsWith(i.url));
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

      <nav className="ro-tabbar" aria-label="Redeem Ops navigation">
        {barItems.map((item) => (
          <NavLink
            key={item.url}
            to={item.url}
            className={({ isActive }) => `ro-tabbar-item${isActive ? ' active' : ''}`}
          >
            <item.icon aria-hidden="true" />
            {item.title}
          </NavLink>
        ))}
        <button
          type="button"
          className={`ro-tabbar-item${moreActive || moreOpen ? ' active' : ''}`}
          onClick={() => setMoreOpen(true)}
        >
          <Ellipsis aria-hidden="true" />
          More
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-[20px] px-4 pb-6 max-h-[80dvh] overflow-y-auto">
          <SheetTitle className="sr-only">More</SheetTitle>
          <div className="w-9 h-1 rounded-full mx-auto mb-2" style={{ background: 'var(--ro-border-strong)' }} />
          {moreItems.map((item) => (
            <button
              key={item.url}
              type="button"
              className="ro-sheet-row"
              onClick={() => { setMoreOpen(false); navigate(item.url); }}
            >
              <span className="ro-sheet-icon"><item.icon aria-hidden="true" /></span>
              {item.title}
            </button>
          ))}
          <div className="h-px my-2" style={{ background: 'var(--ro-divider, #EEF1F3)' }} />
          <div className="flex items-center gap-3 px-1 py-2">
            <RoAvatar name={displayName} size={40} />
            <span className="min-w-0">
              <span className="block text-[14px] font-bold truncate">{displayName}</span>
              <span className="block text-[12px] font-semibold" style={{ color: 'var(--ro-azure)' }}>{roRoleLabel(user)}</span>
            </span>
          </div>
          <button type="button" className="ro-sheet-row" onClick={() => { setMoreOpen(false); navigate('/redeem-ops/profile'); }}>
            <span className="ro-sheet-icon"><Settings aria-hidden="true" /></span>
            Edit profile
          </button>
          {user?.role === 'admin' && (
            <button type="button" className="ro-sheet-row" onClick={() => { setMoreOpen(false); navigate('/AdminDashboard'); }}>
              <span className="ro-sheet-icon"><Shield aria-hidden="true" /></span>
              MKTR admin console
            </button>
          )}
          <button type="button" className="ro-sheet-row" style={{ color: 'var(--ro-tag-red-fg)' }} onClick={handleLogout}>
            <span className="ro-sheet-icon"><LogOut aria-hidden="true" /></span>
            Log out
          </button>
        </SheetContent>
      </Sheet>
    </div>
  );
}
