import { useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { User, Prospect } from '@/api/entities';
import { useCampaignLookup } from '@/hooks/queries/useCampaignsQuery';
import { useBulkAssignProspects, useBulkReturnProspects, useBulkDeleteProspects } from '@/hooks/queries/useProspectsQuery';
import useRowSelection from '@/hooks/useRowSelection';
import BulkActionBar from '@/components/bulk/BulkActionBar';
import BulkAssignDialog from '@/components/bulk/BulkAssignDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
 Trash2,
} from 'lucide-react';
import { format } from 'date-fns';
import ProspectDetails from '@/components/prospects/ProspectDetails';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import normalizeProspect, { sourceLine } from '@/utils/normalizeProspect';
import { statusStyles, statusLabels } from '@/constants/statusConfig';

export default function AdminAgentDetail() {
 const { agentId } = useParams();
 const queryClient = useQueryClient();
 const [selectedProspect, setSelectedProspect] = useState(null);
 const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
 const [bulkReturnOpen, setBulkReturnOpen] = useState(false);
 const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

 const bulkAssignMutation = useBulkAssignProspects();
 const bulkReturnMutation = useBulkReturnProspects();
 const bulkDeleteMutation = useBulkDeleteProspects();

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

 // Row selection for bulk ops — survives page turns; cleared synchronously when
 // filters change (see applyFilterChange below).
 const selection = useRowSelection(prospects);

 const handlePageChange = (newPage) => {
 setPagination((prev) => ({ ...prev, page: newPage }));
 };

 // Filter/search changes reset to page 1 (the query key reads pagination.page —
 // a `page` key inside filters was dead state) and clear the selection.
 const applyFilterChange = useCallback((patch) => {
 selection.clear();
 setPagination((prev) => ({ ...prev, page: 1 }));
 setFilters((prev) => ({ ...prev, ...patch }));
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [selection.clear]);

 const previewNames = (rows, max = 5) => {
 const names = rows.slice(0, max).map((r) => r.name || 'Unnamed');
 const extra = rows.length - names.length;
 return extra > 0 ? `${names.join(', ')} and ${extra} more` : names.join(', ');
 };

 const bulkBusy = bulkAssignMutation.isPending || bulkReturnMutation.isPending || bulkDeleteMutation.isPending;

 const handleBulkAssign = async (targetAgentId) => {
 try {
 const res = await bulkAssignMutation.mutateAsync({ prospectIds: selection.selectedIds, agentId: targetAgentId });
 const skippedTotal = res?.skipped ? Object.values(res.skipped).reduce((a, b) => a + b, 0) : 0;
 const parts = [`${res?.affectedCount ?? 0} reassigned`];
 if (skippedTotal > 0) parts.push(`${skippedTotal} skipped`);
 toast.success(parts.join(' · '));
 setBulkAssignOpen(false);
 selection.clear();
 } catch (error) {
 toast.error(error?.message || 'Bulk reassign failed');
 }
 };

 const handleBulkReturn = async () => {
 try {
 const res = await bulkReturnMutation.mutateAsync({ prospectIds: selection.selectedIds });
 const moved = (res?.returned ?? 0) + (res?.promoted ?? 0);
 if (res?.undeliverable > 0) {
 toast.warning(`${res.undeliverable} could not be returned — lead delivery is not configured for the owning app.`);
 }
 toast.success(`${moved} returned to held`);
 setBulkReturnOpen(false);
 selection.clear();
 } catch (error) {
 toast.error(error?.message || 'Return to held failed');
 }
 };

 const handleBulkDelete = async () => {
 try {
 const res = await bulkDeleteMutation.mutateAsync({ prospectIds: selection.selectedIds });
 toast.success(`${res?.deleted ?? 0} deleted`);
 setBulkDeleteOpen(false);
 selection.clear();
 } catch (error) {
 toast.error(error?.message || 'Bulk delete failed');
 }
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
 onChange={(e) => applyFilterChange({ search: e.target.value })}
 />
 </div>
 <div className="flex items-center gap-2 w-full sm:w-auto">
 <Select
 value={filters.status}
 onValueChange={(val) => applyFilterChange({ status: val })}
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
 <TableHead className="py-3 pl-6 pr-2 w-[44px]">
 <Checkbox
 checked={selection.allVisibleSelected ? true : selection.someVisibleSelected ? 'indeterminate' : false}
 onCheckedChange={selection.toggleAllVisible}
 aria-label="Select all leads on this page" />
 </TableHead>
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
 <TableCell colSpan={6} className="h-24 text-center">
 <div className="flex justify-center items-center gap-2 text-muted-foreground">
 <Loader2 className="w-4 h-4 animate-spin"/> Loading...
 </div>
 </TableCell>
 </TableRow>
 ) : prospects.length === 0 ? (
 <TableRow>
 <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
 No prospects found for this agent.
 </TableCell>
 </TableRow>
 ) : (
 prospects.map((prospect) => (
 <TableRow
 key={prospect.id}
 className={`hover:bg-muted/50 cursor-pointer group ${selection.isSelected(prospect.id) ? 'bg-primary/5' : ''}`} onClick={() => setSelectedProspect(prospect)}
 >
 <TableCell className="pl-6 pr-2" onClick={(e) => e.stopPropagation()}>
 <Checkbox
 checked={selection.isSelected(prospect.id)}
 onClick={(e) => { e.preventDefault(); selection.toggleRow(prospect, { shiftKey: e.shiftKey }); }}
 aria-label={`Select ${prospect.name}`} />
 </TableCell>
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
 {sourceLine(prospect)}
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

 {/* ── Bulk selection actions ─────────────────────────────── */}
 <BulkActionBar
 count={selection.count}
 busy={bulkBusy}
 assignLabel="Reassign to…" onAssign={() => setBulkAssignOpen(true)}
 onReturnToHeld={() => setBulkReturnOpen(true)}
 onDelete={() => setBulkDeleteOpen(true)}
 onClear={selection.clear}
 />

 <BulkAssignDialog
 open={bulkAssignOpen}
 onOpenChange={setBulkAssignOpen}
 selectedRows={selection.selectedRows}
 busy={bulkAssignMutation.isPending}
 onConfirm={handleBulkAssign}
 />

 <ConfirmDialog
 open={bulkReturnOpen}
 onOpenChange={setBulkReturnOpen}
 title={`Return ${selection.count} lead${selection.count === 1 ? '' : 's'} to the held queue?`}
 description={
 <>
 <span className="font-medium">{previewNames(selection.selectedRows)}</span>
 {' '}will be pulled back from {agent?.firstName || 'this agent'} and moved to the Held
 queue, pending reassignment. The agent loses access; credits are not refunded.
 </>
 }
 confirmText="Return to held" onConfirm={handleBulkReturn}
 />

 <ConfirmDialog
 open={bulkDeleteOpen}
 onOpenChange={setBulkDeleteOpen}
 title={`Delete ${selection.count} prospect${selection.count === 1 ? '' : 's'}?`}
 description={
 <>
 <span className="font-medium">{previewNames(selection.selectedRows)}</span>
 {' '}will be permanently deleted from MKTR. This can't be undone.
 </>
 }
 confirmText="Delete" destructive
 confirmIcon={<Trash2 className="w-4 h-4"/>}
 onConfirm={handleBulkDelete}
 />
 </div>
 </div>
 );
}
