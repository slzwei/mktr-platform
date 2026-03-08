import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { auth } from "@/api/client";
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
  Search
} from "lucide-react";
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
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const getNavigationItems = (user) => {
  const adminSections = [
    {
      label: "Overview",
      items: [
        { title: "Dashboard", url: createPageUrl("AdminDashboard"), icon: LayoutDashboard }
      ]
    },
    {
      label: "Lead Generation",
      items: [
        { title: "Prospects", url: createPageUrl("AdminProspects"), icon: Users },
        { title: "Agents", url: createPageUrl("AdminAgents"), icon: Users },
        { title: "Campaigns", url: createPageUrl("AdminCampaigns"), icon: Settings },
        { title: "Lead Packages", url: createPageUrl("AdminLeadPackages"), icon: Package },
        { title: "QR Codes", url: createPageUrl("AdminQRCodes"), icon: QrCode },
        { title: "Short Links", url: createPageUrl("AdminShortLinks"), icon: Link2 }
      ]
    },
    {
      label: "Fleet",
      items: [
        { title: "Fleet Management", url: createPageUrl("AdminFleet"), icon: Car },
        { title: "Vehicle Fleet", url: createPageUrl("AdminVehicles"), icon: Car },
        { title: "Fleet Map", url: createPageUrl("AdminFleetMap"), icon: Car },
        { title: "Tablet Devices", url: createPageUrl("AdminDevices"), icon: Settings }
      ]
    },
    {
      label: "Finance",
      items: [
        { title: "Commissions", url: createPageUrl("AdminCommissions"), icon: DollarSign }
      ]
    },
    {
      label: "System",
      items: [
        { title: "Users", url: createPageUrl("AdminUsers"), icon: Users },
        { title: "App Versions", url: createPageUrl("AdminApkManager"), icon: Settings }
      ]
    }
  ];

  const agentItems = [
    { title: "Dashboard", url: createPageUrl("AgentDashboard"), icon: LayoutDashboard },
    { title: "My Prospects", url: createPageUrl("MyProspects"), icon: Users },
    { title: "Edit Profile", url: "/profile", icon: Settings }
  ];

  const fleetOwnerItems = [
    { title: "Dashboard", url: createPageUrl("FleetOwnerDashboard"), icon: LayoutDashboard },
    { title: "My Fleet", url: createPageUrl("AdminFleet"), icon: Car },
    { title: "My Commissions", url: createPageUrl("AdminCommissions"), icon: DollarSign }
  ];

  const driverPartnerItems = [
    { title: "Dashboard", url: createPageUrl("DriverDashboard"), icon: LayoutDashboard },
    { title: "Profile", url: createPageUrl("DriverProfile"), icon: Settings },
    { title: "Payout History", url: createPageUrl("DriverPayoutHistory"), icon: DollarSign },
    { title: "Payslip", url: createPageUrl("DriverPayslip"), icon: FileText }
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

export default function DashboardLayout({ children, user, userRole }) {
  const [localUser, setLocalUser] = useState(user || auth.getUser());
  const location = useLocation();

  useEffect(() => {
    if (!localUser) {
      auth.getCurrentUser().then((u) => {
        if (u) setLocalUser(u);
      }).catch(() => {
        // leave as null; ProtectedRoute should handle redirect
      });
    }
  }, [localUser]);

  const handleLogout = async () => {
    auth.logout();
    window.location.reload();
  };

  // Safety check - if user is null, return loading state
  if (!localUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const navigationItems = getNavigationItems(localUser);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gray-50 dark:bg-gray-900">
        <Sidebar className="border-r border-gray-200 dark:border-gray-700">
          <SidebarHeader className="border-b border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-r from-red-600 to-blue-600 rounded-xl flex items-center justify-center">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="font-bold text-gray-900 dark:text-gray-100">
                  MKTR {localUser?.role === 'admin' ? 'Admin' : localUser?.role === 'agent' ? 'Agent' : 'Portal'}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Singapore</p>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent className="p-4">
            {navigationItems.map((section, sectionIdx) => (
              <SidebarGroup key={section.label || sectionIdx}>
                {section.label ? (
                  <SidebarGroupLabel className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                    {section.label}
                  </SidebarGroupLabel>
                ) : (
                  <SidebarGroupLabel className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                    {getUserDisplayRole(localUser)} Navigation
                  </SidebarGroupLabel>
                )}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {section.items.map((item) => {
                      const isActive = location.pathname === item.url;
                      return (
                        <SidebarMenuItem key={item.title}>
                          <SidebarMenuButton
                            asChild
                            className={`hover:bg-blue-50 dark:hover:bg-blue-950 hover:text-blue-700 transition-colors rounded-lg mb-1 ${isActive ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 border-l-4 border-blue-600' : ''
                              }`}
                          >
                            <Link to={item.url} className="flex items-center gap-3 px-3 py-3">
                              <item.icon className="w-5 h-5" />
                              <span className="font-medium">{item.title}</span>
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

          <SidebarFooter className="border-t border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center gap-3 mb-4">
              <Avatar className="w-10 h-10">
                <AvatarFallback className="bg-red-100 text-red-700 font-semibold">
                  {localUser?.full_name?.charAt(0)?.toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">
                  {localUser?.full_name || 'User'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {getUserDisplayRole(localUser)}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="w-full text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </SidebarFooter>
        </Sidebar>

        <main className="min-w-0 flex-1 flex flex-col">
          <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 sticky top-0 z-50">
            <div className="flex items-center justify-between">
              <SidebarTrigger className="hover:bg-gray-100 dark:hover:bg-gray-700 p-2 rounded-lg">
                <Menu className="w-5 h-5" />
              </SidebarTrigger>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                MKTR {localUser?.role === 'admin' ? 'Admin' : localUser?.role === 'agent' ? 'Agent' : 'Portal'}
              </h1>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
                  className="hidden md:flex items-center gap-2 px-3 py-1.5 text-xs text-gray-400 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>Search...</span>
                  <kbd className="ml-2 px-1.5 py-0.5 text-[10px] font-medium bg-white dark:bg-gray-600 rounded border border-gray-200 dark:border-gray-500">⌘K</kbd>
                </button>
                <ThemeToggle />
                <NotificationBell />
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </main>
        <CommandPalette user={localUser} />
      </div>
    </SidebarProvider>
  );
}
