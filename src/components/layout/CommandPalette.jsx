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
 Settings,
 Link2,
 Package,
 UserCog,
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
 label:"System",
 items: [
 { title:"Users", url:"/AdminUsers", icon: Users },
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

 // fleet_owner / driver_partner portals retired (Phase D teardown, 2026-07)

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
