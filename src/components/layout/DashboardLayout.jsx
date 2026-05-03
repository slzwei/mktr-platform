import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import {
 LayoutDashboard,
 Users,
 QrCode,
 Car,
 DollarSign,
 FileText,
 Settings,
 LogOut,
 Menu,
 Shield,
 Link2,
 Package,
 Search,
} from 'lucide-react';
import NotificationBell from './NotificationBell.jsx';
import CommandPalette from './CommandPalette.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import {
 Sidebar,
 SidebarContent,
 SidebarGroup,
 SidebarGroupContent,
 SidebarGroupLabel,
 SidebarMenu,
 SidebarMenuButton,
 SidebarMenuItem,
 SidebarHeader,
 SidebarFooter,
 SidebarProvider,
 SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

const getNavigationItems = (user) => {
 const adminSections = [
 {
 label: 'Overview',
 items: [{ title: 'Dashboard', url: '/AdminDashboard', icon: LayoutDashboard }],
 },
 {
 label: 'Lead Generation',
 items: [
 { title: 'Prospects', url: '/AdminProspects', icon: Users },
 { title: 'Agents', url: '/AdminAgents', icon: Users },
 { title: 'Agent Groups', url: '/AdminAgentGroups', icon: Users },
 { title: 'Campaigns', url: '/AdminCampaigns', icon: Settings },
 { title: 'Lead Packages', url: '/AdminLeadPackages', icon: Package },
 { title: 'QR Codes', url: '/AdminQRCodes', icon: QrCode },
 { title: 'Short Links', url: '/AdminShortLinks', icon: Link2 },
 ],
 },
 {
 label: 'Fleet',
 items: [
 { title: 'Fleet Management', url: '/AdminFleet', icon: Car },
 { title: 'Vehicle Fleet', url: '/AdminVehicles', icon: Car },
 { title: 'Fleet Map', url: '/AdminFleetMap', icon: Car },
 { title: 'Tablet Devices', url: '/AdminDevices', icon: Settings },
 ],
 },
 {
 label: 'Finance',
 items: [{ title: 'Commissions', url: '/AdminCommissions', icon: DollarSign }],
 },
 {
 label: 'System',
 items: [
 { title: 'Users', url: '/AdminUsers', icon: Users },
 { title: 'App Versions', url: '/AdminApkManager', icon: Settings },
 ],
 },
 ];

 const agentItems = [
 { title: 'Dashboard', url: '/AgentDashboard', icon: LayoutDashboard },
 { title: 'My Prospects', url: '/MyProspects', icon: Users },
 { title: 'Edit Profile', url: '/profile', icon: Settings },
 ];

 const fleetOwnerItems = [
 { title: 'Dashboard', url: '/FleetOwnerDashboard', icon: LayoutDashboard },
 { title: 'My Fleet', url: '/AdminFleet', icon: Car },
 { title: 'My Commissions', url: '/AdminCommissions', icon: DollarSign },
 ];

 const driverPartnerItems = [
 { title: 'Dashboard', url: '/DriverDashboard', icon: LayoutDashboard },
 { title: 'Profile', url: '/DriverProfile', icon: Settings },
 { title: 'Payout History', url: '/DriverPayoutHistory', icon: DollarSign },
 { title: 'Payslip', url: '/DriverPayslip', icon: FileText },
 ];

 if (user.role === 'admin') return adminSections;

 // Non-admin roles: wrap flat items in a single section with no label
 const wrapFlat = (items) => [{ label: null, items }];
 if (user.role === 'agent') return wrapFlat(agentItems);
 if (user.role === 'fleet_owner') return wrapFlat(fleetOwnerItems);
 if (user.role === 'driver_partner') return wrapFlat(driverPartnerItems);
 return [];
};

// Helper function to get user display role
const getUserDisplayRole = (user) => {
 if (user.role === 'admin') return 'Administrator';
 if (user.role === 'agent') return 'Sales Agent';
 if (user.role === 'fleet_owner') return 'Fleet Owner';
 if (user.role === 'driver_partner') return 'Driver Partner';
 return 'User';
};

// Portal title appears in both the sidebar header and the top bar.
// Keep this a single source of truth so the two chrome surfaces can't drift.
const getPortalTitle = (role) => {
 if (role === 'admin') return 'MKTR Admin';
 if (role === 'agent') return 'MKTR Agent';
 return 'MKTR Portal';
};

export default function DashboardLayout({ children, user }) {
 const storeUser = useAuthStore((s) => s.user);
 const logout = useAuthStore((s) => s.logout);
 const refreshUser = useAuthStore((s) => s.refreshUser);
 const localUser = user || storeUser;
 const location = useLocation();

 useEffect(() => {
 if (!localUser) {
 refreshUser();
 }
 }, [localUser, refreshUser]);

 const handleLogout = async () => {
 logout();
 window.location.reload();
 };

 // Safety check - if user is null, return loading state
 if (!localUser) {
 return (
 <div className="min-h-screen flex items-center justify-center bg-background" role="status" aria-live="polite">
 <div className="flex flex-col items-center gap-3">
 <div
 className="w-8 h-8 border-2 border-muted border-t-foreground rounded-full animate-spin" aria-hidden="true" />
 <p className="text-xs text-muted-foreground">Loading…</p>
 </div>
 </div>
 );
 }

 const navigationItems = getNavigationItems(localUser);
 const portalTitle = getPortalTitle(localUser?.role);

 return (
 <SidebarProvider>
 <div className="min-h-screen flex w-full bg-background">
 <Sidebar className="border-r border-sidebar-border">
 <SidebarHeader className="border-b border-sidebar-border px-5 py-5">
 <div className="flex items-center gap-3">
 <div
 className="w-9 h-9 bg-foreground rounded-lg flex items-center justify-center" aria-hidden="true" >
 <Shield className="w-[18px] h-[18px] text-background"/>
 </div>
 <div className="min-w-0">
 <h2 className="font-semibold text-sidebar-foreground text-sm tracking-tight">
 {portalTitle}
 </h2>
 <p className="text-xs text-muted-foreground">Singapore</p>
 </div>
 </div>
 </SidebarHeader>

 <SidebarContent className="px-3 py-4">
 {navigationItems.map((section, sectionIdx) => (
 <SidebarGroup key={section.label || sectionIdx} className="mb-1">
 <SidebarGroupLabel className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] px-3 mb-1.5">
 {section.label || `${getUserDisplayRole(localUser)} Navigation`}
 </SidebarGroupLabel>
 <SidebarGroupContent>
 <SidebarMenu>
 {section.items.map((item) => {
 const isActive = location.pathname === item.url;
 return (
 <SidebarMenuItem key={item.title}>
 <SidebarMenuButton
 asChild
 aria-current={isActive ? 'page' : undefined}
 className={`rounded-lg mb-0.5 transition-colors duration-micro ease-out-quart ${
 isActive
 ? 'bg-sidebar-accent text-sidebar-accent-foreground'
 : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground'
 }`}
 >
 <Link to={item.url} className="flex items-center gap-3 px-3 py-2.5">
 <item.icon className="w-[18px] h-[18px]" aria-hidden="true"/>
 <span className="text-sm font-medium">{item.title}</span>
 </Link>
 </SidebarMenuButton>
 </SidebarMenuItem>
 );
 })}
 </SidebarMenu>
 </SidebarGroupContent>
 </SidebarGroup>
 ))}
 </SidebarContent>

 <SidebarFooter className="border-t border-sidebar-border p-4">
 <div className="flex items-center gap-3 mb-3 px-1">
 <Avatar className="w-8 h-8">
 <AvatarFallback className="bg-muted text-muted-foreground text-xs font-semibold">
 {localUser?.full_name?.charAt(0)?.toUpperCase() || 'U'}
 </AvatarFallback>
 </Avatar>
 <div className="flex-1 min-w-0">
 <p className="font-medium text-sidebar-foreground text-sm truncate leading-tight">
 {localUser?.full_name || 'User'}
 </p>
 <p className="text-[11px] text-muted-foreground truncate">
 {getUserDisplayRole(localUser)}
 </p>
 </div>
 </div>
 <Button
 variant="ghost" size="sm" onClick={handleLogout}
 className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors duration-micro ease-out-quart" >
 <LogOut className="w-4 h-4 mr-2" aria-hidden="true"/>
 Sign Out
 </Button>
 </SidebarFooter>
 </Sidebar>

 <main className="min-w-0 flex-1 flex flex-col">
 <header className="bg-card border-b border-border px-6 py-3 sticky top-0 z-50">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-4">
 <SidebarTrigger
 className="hover:bg-accent p-2 rounded-lg transition-colors duration-micro ease-out-quart" aria-label="Toggle sidebar" >
 <Menu className="w-[18px] h-[18px]" aria-hidden="true"/>
 </SidebarTrigger>
 <h1 className="text-sm font-semibold text-foreground tracking-tight hidden sm:block">
 {portalTitle}
 </h1>
 </div>
 <div className="flex items-center gap-2">
 <button
 onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
 className="hidden md:flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground bg-muted rounded-lg border border-border hover:bg-accent hover:text-foreground transition-colors duration-micro ease-out-quart" aria-label="Open command palette" >
 <Search className="w-3.5 h-3.5" aria-hidden="true"/>
 <span>Search…</span>
 <kbd className="ml-2 px-1.5 py-0.5 text-[10px] font-medium bg-background rounded border border-border">
 ⌘K
 </kbd>
 </button>
 <ThemeToggle />
 <NotificationBell />
 </div>
 </div>
 </header>

 <div className="flex-1 overflow-auto">{children}</div>
 </main>
 <CommandPalette user={localUser} />
 </div>
 </SidebarProvider>
 );
}
