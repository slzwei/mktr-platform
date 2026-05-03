import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { User, Prospect } from '@/api/entities';
import { useCampaignLookup } from '@/hooks/queries/useCampaignsQuery';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
 ChevronLeft,
 ChevronRight,
 Search,
 ArrowLeft,
 User as UserIcon,
 Phone,
 Mail,
 Calendar,
 Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import ProspectDetails from '@/components/prospects/ProspectDetails';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import normalizeProspect from '@/utils/normalizeProspect';
import { statusStyles, statusLabels } from '@/constants/statusConfig';

export default function AdminAgentDetail() {
 const { agentId } = useParams();
 const queryClient = useQueryClient();
 const [selectedProspect, setSelectedProspect] = useState(null);

 const [pagination, setPagination] = useState({
 page: 1,
 limit: 25,
 });

 const [filters, setFilters] = useState({
 search: '',
 status: 'all',
 });

 const { data: agent, isLoading: agentLoading } = useQuery({
 queryKey: ['users', 'detail', agentId],
 queryFn: () => User.get(agentId),
 enabled: !!agentId,
 });

 const { data: campaigns = [] } = useCampaignLookup();

 const { data: prospectsRaw, isLoading: prospectsLoading } = useQuery({
 queryKey: ['prospects', 'by-agent', agentId, pagination.page, pagination.limit, filters],
 queryFn: () => {
 const params = {
 assignedAgentId: agentId,
 page: pagination.page,
 limit: pagination.limit,
 };
 if (filters.search) params.search = filters.search;
 if (filters.status !== 'all') params.leadStatus = filters.status;
 return Prospect.list(params);
 },
 enabled: !!agentId,
 });

 const { prospects, totalProspects, totalPages } = useMemo(() => {
 if (!prospectsRaw) return { prospects: [], totalProspects: 0, totalPages: 1 };
 const response = prospectsRaw;
 let list = [];
 let count = 0;
 let tp = 1;

 if (response && response.prospects) {
 list = response.prospects;
 count = response.pagination?.totalItems || list.length;
 tp = response.pagination?.totalPages || 1;
 } else if (response && response.data) {
 list = response.data.prospects || [];
 count = response.data.pagination?.totalItems || list.length;
 tp = response.data.pagination?.totalPages || 1;
 } else if (Array.isArray(response)) {
 list = response;
 count = list.length;
 }

 return { prospects: list.map(normalizeProspect), totalProspects: count, totalPages: tp };
 }, [prospectsRaw]);

 const loading = prospectsLoading;

 const handlePageChange = (newPage) => {
 setPagination((prev) => ({ ...prev, page: newPage }));
 };

 const handleStatusUpdate = async (prospectId, newStatus) => {
 try {
 await Prospect.update(prospectId, { leadStatus: newStatus });
 if (selectedProspect?.id === prospectId) {
 setSelectedProspect((prev) => ({ ...prev, leadStatus: newStatus, status: newStatus }));
 }
 queryClient.invalidateQueries({ queryKey: ['prospects', 'by-agent', agentId] });
 } catch (error) {
 console.error('Error updating status:', error);
 toast.error('Failed to update status');
 }
 };

 if (agentLoading) {
 return (
 <div className="p-6 lg:p-8 min-h-screen bg-background flex items-center justify-center">
 <Loader2 className="w-8 h-8 animate-spin text-primary"/>
 </div>
 );
 }

 if (!agent) {
 return (
 <div className="p-6 lg:p-8 min-h-screen bg-background">
 <div className="max-w-[1600px] mx-auto text-center py-12">
 <h2 className="text-xl font-semibold text-foreground">Agent not found</h2>
 <Link to="/AdminAgents">
 <Button variant="outline" className="mt-4">
 Back to Agents
 </Button>
 </Link>
 </div>
 </div>
 );
 }

 return (
 <div className="p-6 lg:p-8 min-h-screen bg-background">
 <div className="max-w-[1600px] mx-auto space-y-6">
 {/* Header */}
 <div>
 <Link
 to="/AdminAgents" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground dark:hover:text-muted-foreground mb-4 transition-colors" >
 <ArrowLeft className="w-4 h-4 mr-1"/>
 Back to Agents
 </Link>
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
 <div>
 <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
 {agent.firstName} {agent.lastName}
 <Badge
 variant="outline" className="font-normal text-sm bg-muted text-muted-foreground" >
 ID: {agent.id.slice(-8)}
 </Badge>
 </h1>
 <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
 <span className="flex items-center gap-1">
 <Mail className="w-3.5 h-3.5"/> {agent.email}
 </span>
 {agent.phone && (
 <span className="flex items-center gap-1">
 <Phone className="w-3.5 h-3.5"/> {agent.phone}
 </span>
 )}
 </div>
 </div>

 <div className="flex items-center gap-2">{/* Can add agent specific actions here later */}</div>
 </div>
 </div>

 {/* Filters */}
 <Card className="border-border shadow-sm bg-card">
 <CardHeader className="border-b border-border p-4">
 <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
 <div className="relative w-full sm:w-72">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
 <Input
 placeholder="Search leads..." className="pl-9" value={filters.search}
 onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value, page: 1 }))} // Reset to page 1 on search
 />
 </div>
 <div className="flex items-center gap-2 w-full sm:w-auto">
 <Select
 value={filters.status}
 onValueChange={(val) => setFilters((prev) => ({ ...prev, status: val, page: 1 }))}
 >
 <SelectTrigger className="w-[180px]">
 <SelectValue placeholder="Status"/>
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All Statuses</SelectItem>
 {Object.entries(statusLabels).map(([key, label]) => (
 <SelectItem key={key} value={key}>
 {label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>
 </CardHeader>
 <CardContent className="p-0">
 <div className="overflow-x-auto">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-border">
 <TableHead className="py-3 px-6">Prospect</TableHead>
 <TableHead className="py-3 px-6">Campaign</TableHead>
 <TableHead className="py-3 px-6">Status</TableHead>
 <TableHead className="py-3 px-6">Source</TableHead>
 <TableHead className="py-3 px-6">Date Assigned</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {loading ? (
 <TableRow>
 <TableCell colSpan={5} className="h-24 text-center">
 <div className="flex justify-center items-center gap-2 text-muted-foreground">
 <Loader2 className="w-4 h-4 animate-spin"/> Loading...
 </div>
 </TableCell>
 </TableRow>
 ) : prospects.length === 0 ? (
 <TableRow>
 <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
 No prospects found for this agent.
 </TableCell>
 </TableRow>
 ) : (
 prospects.map((prospect) => (
 <TableRow
 key={prospect.id}
 className="hover:bg-muted/50 cursor-pointer group" onClick={() => setSelectedProspect(prospect)}
 >
 <TableCell className="px-6 py-4">
 <div className="flex items-center gap-3">
 <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold uppercase">
 {prospect.firstName?.[0] || <UserIcon className="w-4 h-4"/>}
 </div>
 <div>
 <p className="font-medium text-foreground group-hover:text-primary dark:group-hover:text-primary transition-colors">
 {prospect.name}
 </p>
 <p className="text-xs text-muted-foreground">{prospect.company}</p>
 </div>
 </div>
 </TableCell>
 <TableCell className="px-6 py-4">
 <span className="text-sm text-foreground">
 {prospect.campaign?.name || 'Unknown'}
 </span>
 </TableCell>
 <TableCell className="px-6 py-4">
 <Badge
 variant="outline" className={statusStyles[prospect.leadStatus] || 'bg-muted'}
 >
 {statusLabels[prospect.leadStatus] || prospect.leadStatus}
 </Badge>
 </TableCell>
 <TableCell className="px-6 py-4">
 <code className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded border border-border uppercase">
 {prospect.leadSource}
 </code>
 </TableCell>
 <TableCell className="px-6 py-4 text-sm text-muted-foreground">
 <div className="flex items-center gap-1.5">
 <Calendar className="w-3.5 h-3.5 text-muted-foreground"/>
 {format(new Date(prospect.createdAt), 'MMM d, yyyy')}
 </div>
 </TableCell>
 </TableRow>
 ))
 )}
 </TableBody>
 </Table>
 </div>

 {/* Pagination */}
 {totalPages > 1 && (
 <div className="border-t border-border p-4 flex items-center justify-between bg-muted/30">
 <span className="text-sm text-muted-foreground">
 Page {pagination.page} of {totalPages} ({totalProspects} records)
 </span>
 <div className="flex items-center gap-2">
 <Button
 variant="outline" size="sm" onClick={() => handlePageChange(pagination.page - 1)}
 disabled={pagination.page <= 1}
 >
 <ChevronLeft className="w-4 h-4"/> Previous
 </Button>
 <Button
 variant="outline" size="sm" onClick={() => handlePageChange(pagination.page + 1)}
 disabled={pagination.page >= totalPages}
 >
 Next <ChevronRight className="w-4 h-4"/>
 </Button>
 </div>
 </div>
 )}
 </CardContent>
 </Card>

 {/* Detail Dialog */}
 <Dialog open={!!selectedProspect} onOpenChange={() => setSelectedProspect(null)}>
 <DialogContent
 hideClose={true}
 className="max-w-4xl max-h-[90vh] p-0 flex flex-col gap-0 overflow-hidden text-clip" >
 {selectedProspect && (
 <ProspectDetails
 prospect={selectedProspect}
 campaigns={campaigns}
 onStatusUpdate={handleStatusUpdate}
 onClose={() => setSelectedProspect(null)}
 userRole="admin" onEdited={() => queryClient.invalidateQueries({ queryKey: ['prospects', 'by-agent', agentId] })}
 />
 )}
 </DialogContent>
 </Dialog>
 </div>
 </div>
 );
}
