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
  Settings,
  LogOut,
  Menu,
  Bell,
  Shield
} from "lucide-react";
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
  const adminItems = [
    {
      title: "Dashboard",
      url: createPageUrl("AdminDashboard"),
      icon: LayoutDashboard
    },
    {
      title: "Prospects",
      url: createPageUrl("AdminProspects"),
      icon: Users
    },
    {
      title: "Agents",
      url: createPageUrl("AdminAgents"),
      icon: Users
    },
    {
      title: "Campaigns",
      url: createPageUrl("AdminCampaigns"),
      icon: Settings
    },
    {
      title: "QR Codes",
      url: createPageUrl("AdminQRCodes"),
      icon: QrCode
    },
    {
      title: "Fleet Management",
      url: createPageUrl("AdminFleet"),
      icon: Car
    },
    {
      title: "Commissions",
      url: createPageUrl("AdminCommissions"),
      icon: DollarSign
    }
  ];

  const agentItems = [
    {
      title: "Dashboard",
      url: createPageUrl("AgentDashboard"),
      icon: LayoutDashboard
    },
    {
      title: "My Prospects",
      url: createPageUrl("AdminProspects"),
      icon: Users
    },
    {
      title: "My Commissions",
      url: createPageUrl("AdminCommissions"),
      icon: DollarSign
    }
  ];

  const fleetOwnerItems = [
    {
      title: "Dashboard",
      url: createPageUrl("FleetOwnerDashboard"),
      icon: LayoutDashboard
    },
    {
      title: "My Fleet",
      url: createPageUrl("AdminFleet"),
      icon: Car
    },
    {
      title: "My Commissions",
      url: createPageUrl("AdminCommissions"),
      icon: DollarSign
    }
  ];

  if (user.role === 'admin') return adminItems;
  if (user.role === 'agent') return agentItems;
  if (user.role === 'fleet_owner') return fleetOwnerItems;
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const navigationItems = getNavigationItems(localUser);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gray-50">
        <Sidebar className="border-r border-gray-200">
          <SidebarHeader className="border-b border-gray-200 p-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-r from-red-600 to-blue-600 rounded-xl flex items-center justify-center">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="font-bold text-gray-900">
                  MKTR {localUser?.role === 'admin' ? 'Admin' : localUser?.role === 'agent' ? 'Agent' : 'Portal'}
                </h2>
                <p className="text-sm text-gray-500">Singapore</p>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent className="p-4">
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                {getUserDisplayRole(localUser)} Navigation
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navigationItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        className={`hover:bg-blue-50 hover:text-blue-700 transition-colors rounded-lg mb-1 ${
                          location.pathname === item.url ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600' : ''
                        }`}
                      >
                        <Link to={item.url} className="flex items-center gap-3 px-3 py-3">
                          <item.icon className="w-5 h-5" />
                          <span className="font-medium">{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="border-t border-gray-200 p-4">
            <div className="flex items-center gap-3 mb-4">
              <Avatar className="w-10 h-10">
                <AvatarFallback className="bg-red-100 text-red-700 font-semibold">
                  {localUser?.full_name?.charAt(0)?.toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm truncate">
                  {localUser?.full_name || 'User'}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {getUserDisplayRole(localUser)}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="w-full text-gray-600 hover:text-gray-900"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </SidebarFooter>
        </Sidebar>

        <main className="min-w-0 flex-1 flex flex-col">
          <header className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-50">
            <div className="flex items-center justify-between">
              <SidebarTrigger className="hover:bg-gray-100 p-2 rounded-lg">
                <Menu className="w-5 h-5" />
              </SidebarTrigger>
              <h1 className="text-xl font-semibold text-gray-900">
                MKTR {localUser?.role === 'admin' ? 'Admin' : localUser?.role === 'agent' ? 'Agent' : 'Portal'}
              </h1>
              <Bell className="w-5 h-5 text-gray-400" />
            </div>
          </header>

          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
