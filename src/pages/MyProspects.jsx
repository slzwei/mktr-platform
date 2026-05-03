import { useState, useMemo } from"react";
import { Prospect } from"@/api/entities";
import { useQuery, useQueryClient } from"@tanstack/react-query";
import { useCurrentUser } from"@/hooks/queries/useUsersQuery";
import { useUpdateProspect } from"@/hooks/queries/useProspectsQuery";
import { useCampaignLookup } from"@/hooks/queries/useCampaignsQuery";
import { Card, CardContent } from"@/components/ui/card";
import { Input } from"@/components/ui/input";
import { Button } from"@/components/ui/button";
import { Badge } from"@/components/ui/badge";
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from"@/components/ui/table";
import {
 Search,
 Filter,
 Download,
 MoreHorizontal,
 Phone,
 Mail,
 Calendar,
 User,
 RefreshCw,
 Loader2
} from"lucide-react";
import { format } from"date-fns";
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuLabel,
 DropdownMenuTrigger,
} from"@/components/ui/dropdown-menu";
import {
 Dialog,
 DialogContent,
} from"@/components/ui/dialog";
import ProspectDetails from"@/components/prospects/ProspectDetails";
import normalizeProspect from"@/utils/normalizeProspect";
import { getStatusColor, formatStatus } from"@/constants/statusConfig";

export default function MyProspects() {
 const [searchQuery, setSearchQuery] = useState("");
 const [selectedProspect, setSelectedProspect] = useState(null);

 const queryClient = useQueryClient();
 const { data: currentUser } = useCurrentUser();

 const { data: prospectsRaw, isLoading: loading } = useQuery({
 queryKey: ['prospects', 'list', { limit: 100 }],
 queryFn: () => Prospect.list({ limit: 100 }),
 });

 const prospects = useMemo(() => {
 if (!prospectsRaw) return [];
 let rawProspects = [];
 if (Array.isArray(prospectsRaw.prospects)) {
 rawProspects = prospectsRaw.prospects;
 } else if (prospectsRaw.data && Array.isArray(prospectsRaw.data.prospects)) {
 rawProspects = prospectsRaw.data.prospects;
 } else if (Array.isArray(prospectsRaw)) {
 rawProspects = prospectsRaw;
 }
 return rawProspects.map(normalizeProspect);
 }, [prospectsRaw]);

 const { data: campaigns = [] } = useCampaignLookup();

 const updateMutation = useUpdateProspect();

 const handleStatusUpdate = async (prospectId, newStatus) => {
 try {
 await updateMutation.mutateAsync({ id: prospectId, data: { leadStatus: newStatus } });
 if (selectedProspect && selectedProspect.id === prospectId) {
 setSelectedProspect(prev => ({
 ...prev,
 status: newStatus,
 leadStatus: newStatus
 }));
 }
 } catch (error) {
 console.error('Error updating status:', error);
 }
 };

 const filteredProspects = prospects.filter(p => {
 const searchLower = searchQuery.toLowerCase();
 return (
 p.firstName?.toLowerCase().includes(searchLower) ||
 p.lastName?.toLowerCase().includes(searchLower) ||
 p.email?.toLowerCase().includes(searchLower) ||
 p.phone?.includes(searchQuery)
 );
 });


 return (
 <div className="p-6 lg:p-8 space-y-6">
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
 <div>
 <h1 className="text-2xl font-bold tracking-tight text-foreground">My Prospects</h1>
 <p className="text-muted-foreground">Manage and track your assigned leads</p>
 </div>
 <div className="flex items-center gap-3">
 <Button variant="outline" size="sm" className="h-9" onClick={() => queryClient.invalidateQueries({ queryKey: ['prospects'] })}>
 <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
 Refresh
 </Button>
 <Button size="sm" className="h-9 bg-primary hover:bg-primary/90">
 <Download className="w-4 h-4 mr-2"/>
 Export
 </Button>
 </div>
 </div>

 {/* Stats Overview */}
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <Card>
 <CardContent className="p-6 flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Total Assigned</p>
 <p className="text-2xl font-bold text-foreground mt-1">{prospects.length}</p>
 </div>
 <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
 <User className="w-5 h-5 text-primary"/>
 </div>
 </CardContent>
 </Card>
 <Card>
 <CardContent className="p-6 flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Active Leads</p>
 <p className="text-2xl font-bold text-foreground mt-1">
 {prospects.filter(p => !['won', 'lost', 'rejected'].includes(p.status || p.leadStatus)).length}
 </p>
 </div>
 <div className="w-10 h-10 bg-success/10 rounded-full flex items-center justify-center">
 <RefreshCw className="w-5 h-5 text-success"/>
 </div>
 </CardContent>
 </Card>
 <Card>
 <CardContent className="p-6 flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Conversion Rate</p>
 <p className="text-2xl font-bold text-foreground mt-1">
 {prospects.length > 0
 ? Math.round((prospects.filter(p => (p.status || p.leadStatus) === 'won').length / prospects.length) * 100)
 : 0}%
 </p>
 </div>
 <div className="w-10 h-10 bg-plum/10 rounded-full flex items-center justify-center">
 <Download className="w-5 h-5 text-plum"/>
 </div>
 </CardContent>
 </Card>
 </div>

 <Card className="border-border shadow-sm">
 <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-4 justify-between items-center">
 <div className="relative w-full sm:w-72">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
 <Input
 placeholder="Search prospects..." className="pl-9 bg-muted border-border focus:bg-background dark:focus:bg-foreground transition-colors" value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 />
 </div>
 <Button variant="outline" size="sm" className="w-full sm:w-auto text-muted-foreground">
 <Filter className="w-4 h-4 mr-2"/>
 Filter
 </Button>
 </div>

 <div className="relative overflow-x-auto">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50">
 <TableHead className="w-[250px]">Prospect Name</TableHead>
 <TableHead>Status</TableHead>
 <TableHead>Contact Info</TableHead>
 <TableHead>Campaign</TableHead>
 <TableHead>Assigned Date</TableHead>
 <TableHead className="text-right">Actions</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {loading ? (
 <TableRow>
 <TableCell colSpan={6} className="h-32 text-center">
 <div className="flex flex-col items-center justify-center text-muted-foreground">
 <Loader2 className="w-6 h-6 animate-spin mb-2"/>
 <p>Loading prospects...</p>
 </div>
 </TableCell>
 </TableRow>
 ) : filteredProspects.length === 0 ? (
 <TableRow>
 <TableCell colSpan={6} className="h-64 text-center">
 <div className="flex flex-col items-center justify-center text-muted-foreground">
 <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-4">
 <User className="w-6 h-6 text-muted-foreground"/>
 </div>
 <p className="text-lg font-medium text-foreground">No prospects found</p>
 <p className="text-sm text-muted-foreground max-w-xs mx-auto mt-1">
 {searchQuery
 ? `No results matching"${searchQuery}"`
 :"You haven't been assigned any prospects yet."}
 </p>
 </div>
 </TableCell>
 </TableRow>
 ) : (
 filteredProspects.map((prospect) => (
 <TableRow key={prospect.id} className="group hover:bg-primary/10 transition-colors">
 <TableCell>
 <div className="flex items-center gap-3">
 <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-background font-medium shadow-sm">
 {prospect.firstName?.[0]}{prospect.lastName?.[0]}
 </div>
 <div>
 <p className="font-medium text-foreground">{prospect.firstName} {prospect.lastName}</p>
 <p className="text-xs text-muted-foreground">{prospect.company || 'Individual'}</p>
 </div>
 </div>
 </TableCell>
 <TableCell>
 <Badge variant="outline" className={getStatusColor(prospect.status || prospect.leadStatus)}>
 {formatStatus(prospect.status || prospect.leadStatus)}
 </Badge>
 </TableCell>
 <TableCell>
 <div className="space-y-1">
 {prospect.email && (
 <div className="flex items-center text-sm text-muted-foreground">
 <Mail className="w-3.5 h-3.5 mr-2 text-muted-foreground"/>
 {prospect.email}
 </div>
 )}
 {prospect.phone && (
 <div className="flex items-center text-sm text-muted-foreground">
 <Phone className="w-3.5 h-3.5 mr-2 text-muted-foreground"/>
 {prospect.phone}
 </div>
 )}
 </div>
 </TableCell>
 <TableCell>
 <div className="text-sm">
 <p className="font-medium text-foreground">{prospect.campaign?.name || 'Unknown Campaign'}</p>
 <p className="text-xs text-muted-foreground">{prospect.leadSource}</p>
 </div>
 </TableCell>
 <TableCell>
 <div className="flex items-center text-sm text-muted-foreground">
 <Calendar className="w-3.5 h-3.5 mr-2 text-muted-foreground"/>
 {format(new Date(prospect.createdAt), 'MMM d, yyyy')}
 </div>
 </TableCell>
 <TableCell className="text-right">
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" aria-label="Prospect actions" className="h-8 w-8 text-muted-foreground hover:text-foreground dark:hover:text-muted-foreground">
 <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end">
 <DropdownMenuLabel>Actions</DropdownMenuLabel>
 <DropdownMenuItem onClick={() => setSelectedProspect(prospect)}>View Details</DropdownMenuItem>
 <DropdownMenuItem onClick={() => setSelectedProspect(prospect)}>Log Activity</DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </TableCell>
 </TableRow>
 ))
 )}
 </TableBody>
 </Table>
 </div>
 </Card>

 <Dialog open={!!selectedProspect} onOpenChange={() => setSelectedProspect(null)}>
 <DialogContent hideClose={true} className="max-w-4xl h-[90vh] p-0 flex flex-col gap-0 overflow-hidden">
 {selectedProspect && (
 <ProspectDetails
 prospect={selectedProspect}
 campaigns={campaigns}
 onStatusUpdate={handleStatusUpdate}
 onClose={() => setSelectedProspect(null)}
 userRole="agent" onEdited={() => queryClient.invalidateQueries({ queryKey: ['prospects'] })}
 />
 )}
 </DialogContent>
 </Dialog>
 </div>
 );
}
