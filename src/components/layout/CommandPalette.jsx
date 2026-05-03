import React, { useEffect, useState } from"react";
import { useNavigate } from"react-router-dom";
import {
 CommandDialog,
 CommandEmpty,
 CommandGroup,
 CommandInput,
 CommandItem,
 CommandList,
 CommandSeparator,
} from"@/components/ui/command";
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
} from"lucide-react";

function getNavGroups(role) {
 if (role ==="admin") {
 return [
 {
 label:"Navigation",
 items: [
 { title:"Dashboard", url:"/AdminDashboard", icon: LayoutDashboard },
 { title:"Prospects", url:"/AdminProspects", icon: Users },
 { title:"Campaigns", url:"/AdminCampaigns", icon: Settings },
 { title:"Agents", url:"/AdminAgents", icon: UserCog },
 ],
 },
 {
 label:"Lead Gen",
 items: [
 { title:"Lead Packages", url:"/AdminLeadPackages", icon: Package },
 { title:"QR Codes", url:"/AdminQRCodes", icon: QrCode },
 { title:"Short Links", url:"/AdminShortLinks", icon: Link2 },
 ],
 },
 {
 label:"Fleet",
 items: [
 { title:"Fleet Management", url:"/AdminFleet", icon: Car },
 { title:"Vehicle Fleet", url:"/AdminVehicles", icon: Car },
 { title:"Fleet Map", url:"/AdminFleetMap", icon: Map },
 { title:"Tablet Devices", url:"/AdminDevices", icon: Tablet },
 ],
 },
 {
 label:"Finance",
 items: [
 { title:"Commissions", url:"/AdminCommissions", icon: DollarSign },
 ],
 },
 {
 label:"System",
 items: [
 { title:"Users", url:"/AdminUsers", icon: Users },
 { title:"App Versions", url:"/AdminApkManager", icon: AppWindow },
 ],
 },
 ];
 }

 if (role ==="agent") {
 return [
 {
 label:"Navigation",
 items: [
 { title:"Dashboard", url:"/AgentDashboard", icon: LayoutDashboard },
 { title:"My Prospects", url:"/MyProspects", icon: Users },
 { title:"Edit Profile", url:"/profile", icon: Settings },
 ],
 },
 ];
 }

 if (role ==="fleet_owner") {
 return [
 {
 label:"Navigation",
 items: [
 { title:"Dashboard", url:"/FleetOwnerDashboard", icon: LayoutDashboard },
 { title:"My Fleet", url:"/AdminFleet", icon: Car },
 { title:"My Commissions", url:"/AdminCommissions", icon: DollarSign },
 ],
 },
 ];
 }

 if (role ==="driver_partner") {
 return [
 {
 label:"Navigation",
 items: [
 { title:"Dashboard", url:"/DriverDashboard", icon: LayoutDashboard },
 { title:"Profile", url:"/DriverProfile", icon: Settings },
 { title:"Payout History", url:"/DriverPayoutHistory", icon: DollarSign },
 { title:"Payslip", url:"/DriverPayslip", icon: FileText },
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
 if (e.key ==="k"&& (e.metaKey || e.ctrlKey)) {
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
 <CommandInput placeholder="Search pages..."/>
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
 className="cursor-pointer" >
 <item.icon className="mr-2 h-4 w-4"/>
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
