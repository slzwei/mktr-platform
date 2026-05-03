import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { Clock, ArrowRight, MoreHorizontal, Users, Search } from 'lucide-react';
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { statusStyles, statusLabels } from '@/constants/statusConfig';

export default function RecentActivity({ prospects }) {
 const [search, setSearch] = useState('');
 const [statusFilter, setStatusFilter] = useState('all');

 const formatProspectDate = (prospect) => {
 const raw =
 prospect.created_date || prospect.createdAt || prospect.created_at || prospect.created || prospect.createdDate;
 if (!raw) return '—';
 const date = raw instanceof Date ? raw : new Date(raw);
 return isNaN(date.getTime()) ? '—' : format(date, 'MMM d, h:mm a');
 };

 const filteredProspects = prospects.filter((p) => {
 const name = (p.name || p.firstName || '').toLowerCase();
 const matchesSearch = !search || name.includes(search.toLowerCase());
 const status = (p.leadStatus || p.status || 'new').toLowerCase();
 const matchesStatus = statusFilter === 'all' || status === statusFilter;
 return matchesSearch && matchesStatus;
 });
 const recentProspects = filteredProspects.slice(0, 8);
 const isFiltered = search !== '' || statusFilter !== 'all';

 return (
 <Card className="border border-border shadow-none bg-card h-full">
 <CardHeader className="space-y-0 pb-4">
 <div className="flex flex-row items-center justify-between">
 <div>
 <CardTitle className="text-base font-semibold tracking-tight">Recent Activity</CardTitle>
 <p className="text-sm text-muted-foreground mt-1">
 Showing {recentProspects.length} of {prospects.length} prospects
 {isFiltered && ' · filtered'}
 </p>
 </div>
 <Link to={'/AdminProspects'}>
 <Button variant="ghost" size="sm" className="text-primary hover:text-primary hover:bg-primary/10">
 View All
 <ArrowRight className="w-4 h-4 ml-1" aria-hidden="true"/>
 </Button>
 </Link>
 </div>
 <div className="flex items-center gap-2 mt-3">
 <div className="relative flex-1">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true"/>
 <Input
 placeholder="Search prospects..." value={search}
 onChange={(e) => setSearch(e.target.value)}
 aria-label="Search prospects" className="pl-9 h-8 text-sm" />
 </div>
 <Select value={statusFilter} onValueChange={setStatusFilter}>
 <SelectTrigger className="w-[130px] h-8 text-sm">
 <SelectValue placeholder="All Status"/>
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All Status</SelectItem>
 <SelectItem value="new">New</SelectItem>
 <SelectItem value="contacted">Contacted</SelectItem>
 <SelectItem value="meeting">Meeting</SelectItem>
 <SelectItem value="close_won">Won</SelectItem>
 <SelectItem value="close_lost">Lost</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </CardHeader>
 <CardContent className="p-0">
 <div className="overflow-x-auto">
 <table className="w-full text-sm text-left">
 <thead className="bg-muted/50 text-muted-foreground font-medium border-b border-border">
 <tr>
 <th className="px-6 py-3">Prospect</th>
 <th className="px-6 py-3">Status</th>
 <th className="px-6 py-3">Date</th>
 <th className="px-6 py-3 text-right">Actions</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border/50">
 {recentProspects.length > 0 ? (
 recentProspects.map((prospect) => (
 <tr key={prospect.id} className="hover:bg-muted/50 transition-colors group">
 <td className="px-6 py-4">
 <div className="flex items-center gap-3">
 <Avatar className="w-8 h-8 shrink-0 border border-border">
 <AvatarFallback className="bg-background text-foreground text-xs font-medium">
 {prospect.name?.charAt(0)?.toUpperCase()}
 </AvatarFallback>
 </Avatar>
 <div className="font-medium text-foreground group-hover:text-primary transition-colors">
 {prospect.name}
 </div>
 </div>
 </td>
 <td className="px-6 py-4">
 <Badge
 variant="outline" className={`font-normal ${statusStyles[prospect.status] || 'bg-muted text-muted-foreground'}`}
 >
 {statusLabels[prospect.status] || prospect.status}
 </Badge>
 </td>
 <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
 <div className="flex items-center gap-1.5">
 <Clock className="w-3.5 h-3.5 text-muted-foreground/70"/>
 {formatProspectDate(prospect)}
 </div>
 </td>
 <td className="px-6 py-4 text-right">
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button
 variant="ghost" className="h-9 w-9 p-0 opacity-60 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity" >
 <span className="sr-only">Open menu for {prospect.name}</span>
 <MoreHorizontal className="h-4 w-4" aria-hidden="true"/>
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end">
 <DropdownMenuItem asChild>
 <Link to={'/AdminProspects' + `?id=${prospect.id}`}>View Details</Link>
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </td>
 </tr>
 ))
 ) : (
 <tr>
 <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
 <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50"/>
 <p className="font-medium mb-1">No recent activity</p>
 <p className="text-xs text-muted-foreground/70 mb-4">
 Prospects will appear here as they are added
 </p>
 <Link to={'/AdminProspects'}>
 <Button variant="outline" size="sm">
 View All Prospects
 </Button>
 </Link>
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </CardContent>
 </Card>
 );
}
