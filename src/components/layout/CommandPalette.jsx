import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Users,
  QrCode,
  Car,
  DollarSign,
  FileText,
  Settings,
  Link2,
  Package,
  Map,
  Tablet,
  UserCog,
  AppWindow,
} from "lucide-react";

function getNavGroups(role) {
  if (role === "admin") {
    return [
      {
        label: "Navigation",
        items: [
          { title: "Dashboard", url: createPageUrl("AdminDashboard"), icon: LayoutDashboard },
          { title: "Prospects", url: createPageUrl("AdminProspects"), icon: Users },
          { title: "Campaigns", url: createPageUrl("AdminCampaigns"), icon: Settings },
          { title: "Agents", url: createPageUrl("AdminAgents"), icon: UserCog },
        ],
      },
      {
        label: "Lead Gen",
        items: [
          { title: "Lead Packages", url: createPageUrl("AdminLeadPackages"), icon: Package },
          { title: "QR Codes", url: createPageUrl("AdminQRCodes"), icon: QrCode },
          { title: "Short Links", url: createPageUrl("AdminShortLinks"), icon: Link2 },
        ],
      },
      {
        label: "Fleet",
        items: [
          { title: "Fleet Management", url: createPageUrl("AdminFleet"), icon: Car },
          { title: "Vehicle Fleet", url: createPageUrl("AdminVehicles"), icon: Car },
          { title: "Fleet Map", url: createPageUrl("AdminFleetMap"), icon: Map },
          { title: "Tablet Devices", url: createPageUrl("AdminDevices"), icon: Tablet },
        ],
      },
      {
        label: "Finance",
        items: [
          { title: "Commissions", url: createPageUrl("AdminCommissions"), icon: DollarSign },
        ],
      },
      {
        label: "System",
        items: [
          { title: "Users", url: createPageUrl("AdminUsers"), icon: Users },
          { title: "App Versions", url: createPageUrl("AdminApkManager"), icon: AppWindow },
        ],
      },
    ];
  }

  if (role === "agent") {
    return [
      {
        label: "Navigation",
        items: [
          { title: "Dashboard", url: createPageUrl("AgentDashboard"), icon: LayoutDashboard },
          { title: "My Prospects", url: createPageUrl("MyProspects"), icon: Users },
          { title: "Edit Profile", url: "/profile", icon: Settings },
        ],
      },
    ];
  }

  if (role === "fleet_owner") {
    return [
      {
        label: "Navigation",
        items: [
          { title: "Dashboard", url: createPageUrl("FleetOwnerDashboard"), icon: LayoutDashboard },
          { title: "My Fleet", url: createPageUrl("AdminFleet"), icon: Car },
          { title: "My Commissions", url: createPageUrl("AdminCommissions"), icon: DollarSign },
        ],
      },
    ];
  }

  if (role === "driver_partner") {
    return [
      {
        label: "Navigation",
        items: [
          { title: "Dashboard", url: createPageUrl("DriverDashboard"), icon: LayoutDashboard },
          { title: "Profile", url: createPageUrl("DriverProfile"), icon: Settings },
          { title: "Payout History", url: createPageUrl("DriverPayoutHistory"), icon: DollarSign },
          { title: "Payslip", url: createPageUrl("DriverPayslip"), icon: FileText },
        ],
      },
    ];
  }

  return [];
}

export default function CommandPalette({ user }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const down = (e) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const runCommand = (url) => {
    setOpen(false);
    navigate(url);
  };

  const navGroups = getNavGroups(user?.role);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {navGroups.map((group, i) => (
          <React.Fragment key={group.label}>
            {i > 0 && <CommandSeparator />}
            <CommandGroup heading={group.label}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.title}
                  onSelect={() => runCommand(item.url)}
                  className="cursor-pointer"
                >
                  <item.icon className="mr-2 h-4 w-4" />
                  <span>{item.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </React.Fragment>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
