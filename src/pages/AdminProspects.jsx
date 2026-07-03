import { useState, useEffect, useMemo, useCallback } from"react";
import { useQuery, useQueryClient, keepPreviousData } from"@tanstack/react-query";
import { Prospect } from"@/api/entities";
import { useCurrentUser } from"@/hooks/queries/useUsersQuery";
import {
 useUpdateProspect,
 useDeleteProspect,
 useBulkAssignProspects,
 useBulkReturnProspects,
 useBulkDeleteProspects,
} from"@/hooks/queries/useProspectsQuery";
import { useCampaignLookup } from"@/hooks/queries/useCampaignsQuery";
import useRowSelection from"@/hooks/useRowSelection";
import BulkActionBar from"@/components/bulk/BulkActionBar";
import BulkAssignDialog from"@/components/bulk/BulkAssignDialog";
import { holdReasonLabel } from"@/constants/holdReasons";
import { Card, CardContent, CardHeader } from"@/components/ui/card";
import { Button } from"@/components/ui/button";
import { Input } from"@/components/ui/input";
import { Badge } from"@/components/ui/badge";
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow
} from"@/components/ui/table";
import { useLocation } from"react-router-dom";
import { format } from"date-fns";
import {
 Search,
 FileSpreadsheet,
 FileText,
 Trash2,
 User
} from"lucide-react";
import { Checkbox } from"@/components/ui/checkbox";
import { toast } from"sonner";
import { useIsMobile } from"@/hooks/use-mobile";
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from"@/components/ui/select";

import ProspectFilters from"@/components/prospects/ProspectFilters";
import ProspectDetails from"@/components/prospects/ProspectDetails";
import EmptyState from"@/components/common/EmptyState";
import TableEmpty from"@/components/common/TableEmpty";
import TablePagination from"@/components/common/TablePagination";
import PageHeader from"@/components/common/PageHeader";
import { ConfirmDialog } from"@/components/ConfirmDialog";
import normalizeProspect, { sourceDisplay } from"@/utils/normalizeProspect";
import { statusStyles, statusLabels } from"@/constants/statusConfig";
import {
 Tooltip,
 TooltipContent,
 TooltipProvider,
 TooltipTrigger,
} from"@/components/ui/tooltip";

/**
 * Source badge with ad-campaign / referrer context. Desktop: badge + detail
 * line + hover tooltip. compact: single line for the mobile card list (no
 * hover on touch).
 */
function SourceTag({ prospect, compact = false }) {
 const d = sourceDisplay(prospect);
 const badgeClass = `text-xs px-1.5 py-0.5 rounded border uppercase ${
 d.label.endsWith(" AD")
 ?"bg-primary/10 text-primary border-primary/30"
 :"bg-muted text-muted-foreground border-border"
 }`;

 if (compact) {
 return (
 <div className="flex items-center gap-1.5 text-xs min-w-0">
 <code className={badgeClass}>{d.label}</code>
 {d.detail && <span className="text-muted-foreground truncate">{d.detail}</span>}
 </div>
 );
 }

 const badge = (
 <div className="inline-flex flex-col items-start gap-1">
 <code className={badgeClass}>{d.label}</code>
 {d.detail && (
 <span className="text-xs text-muted-foreground truncate max-w-[160px]">{d.detail}</span>
 )}
 </div>
 );

 if (!d.tooltip) return badge;
 return (
 <TooltipProvider delayDuration={150}>
 <Tooltip>
 <TooltipTrigger asChild>{badge}</TooltipTrigger>
 <TooltipContent side="top" className="max-w-[280px]">
 {d.tooltip}
 </TooltipContent>
 </Tooltip>
 </TooltipProvider>
 );
}

export default function AdminProspects() {
 const location = useLocation();
 const queryClient = useQueryClient();
 const { data: user } = useCurrentUser();
 const updateProspectMutation = useUpdateProspect();
 const deleteProspectMutation = useDeleteProspect();
 const bulkAssignMutation = useBulkAssignProspects();
 const bulkReturnMutation = useBulkReturnProspects();
 const bulkDeleteMutation = useBulkDeleteProspects();

 const [selectedProspect, setSelectedProspect] = useState(null);
 const [deleteConfirm, setDeleteConfirm] = useState(null);
 const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
 const [bulkReturnOpen, setBulkReturnOpen] = useState(false);
 const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
 const [filters, setFilters] = useState(() => {
 const params = new URLSearchParams(window.location.search);
 return {
 search:"", status:"all",
 campaign: params.get('campaign') ||"all",
 qrTagId: params.get('qrTagId') ||"all",
 source:"all",
 assignment:"all" };
 });
 const [currentPage, setCurrentPage] = useState(1);
 const [itemsPerPage, setItemsPerPage] = useState(25);
 const isMobile = useIsMobile();

 // Debounce the free-text search so we issue one server query after the user
 // pauses typing, not one per keystroke. The input stays bound to
 // `filters.search` (instant), so typing never lags; only the value that
 // flows into the query key is delayed. Discrete filters apply immediately.
 const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
 useEffect(() => {
 const t = setTimeout(() => setDebouncedSearch(filters.search), 300);
 return () => clearTimeout(t);
 }, [filters.search]);

 const queryParams = useMemo(() => {
 const params = { page: currentPage, limit: itemsPerPage };
 if (debouncedSearch) params.search = debouncedSearch;
 if (filters.status !=="all") params.leadStatus = filters.status;
 if (filters.campaign !=="all") params.campaignId = filters.campaign;
 if (filters.qrTagId !=="all") params.qrTagId = filters.qrTagId;
 if (filters.assignment !=="all") params.assignment = filters.assignment;
 if (filters.source !=="all") {
 if (filters.source ==="qr") params.leadSource ="qr_code";
 else if (filters.source ==="form") params.leadSource ="website";
 else params.leadSource = filters.source;
 }
 return params;
 }, [debouncedSearch, filters.status, filters.campaign, filters.qrTagId, filters.source, filters.assignment, currentPage, itemsPerPage]);

 const { data: prospectsResponse, isLoading: prospectsLoading, isPlaceholderData } = useQuery({
 queryKey: ['prospects', 'list', queryParams],
 queryFn: () => Prospect.list(queryParams),
 // Keep the previous page's rows rendered while the next query loads so a
 // search/filter/page change never drops the whole view into the loading
 // skeleton — that full unmount was stealing focus from the search box on
 // every keystroke.
 placeholderData: keepPreviousData,
 });
 const { data: campaigns = [] } = useCampaignLookup();

 const prospects = useMemo(() => {
 const data = prospectsResponse?.prospects || prospectsResponse || [];
 return (Array.isArray(data) ? data : []).map(normalizeProspect);
 }, [prospectsResponse]);

 const pagination = prospectsResponse?.pagination || {
 currentPage, totalPages: 1, totalItems: prospects.length, itemsPerPage
 };

 // Row selection survives page turns (Map of row snapshots, so exports and the
 // assign preview keep working across pages). It is cleared SYNCHRONOUSLY in the
 // filter/search handlers below — an effect watching queryParams would wipe it on
 // every page turn and let keepPreviousData's stale rows be selected under a new
 // filter.
 const selection = useRowSelection(prospects);

 // Any filter/search change redefines the working set — clear the selection in the
 // same event, then apply the filter. Page turns intentionally do NOT clear.
 const applyFilters = useCallback((next) => {
 selection.clear();
 setCurrentPage(1);
 setFilters(next);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [selection.clear]);

 useEffect(() => {
 const params = new URLSearchParams(location.search);
 const campaignId = params.get('campaign') ||"all";
 const qrTagId = params.get('qrTagId') ||"all";
 setFilters(prev => {
 if (prev.campaign === campaignId && prev.qrTagId === qrTagId) return prev;
 selection.clear();
 setCurrentPage(1);
 return { ...prev, campaign: campaignId, qrTagId: qrTagId };
 });
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [location.search]);

 const exportRows = useMemo(
 () => (selection.count > 0 ? selection.selectedRows : prospects),
 // eslint-disable-next-line react-hooks/exhaustive-deps
 [prospects, selection.selected]
 );
 const heldSelectedCount = useMemo(
 () => selection.selectedRows.filter((r) => r.quarantinedAt).length,
 // eslint-disable-next-line react-hooks/exhaustive-deps
 [selection.selected]
 );
 const bulkBusy = bulkAssignMutation.isPending || bulkReturnMutation.isPending || bulkDeleteMutation.isPending;

 const handleRefresh = () => queryClient.invalidateQueries({ queryKey: ['prospects'] });

 // Up-to-five-name preview for the bulk confirm dialogs.
 const previewNames = (rows, max = 5) => {
 const names = rows.slice(0, max).map((r) => r.name || 'Unnamed');
 const extra = rows.length - names.length;
 return extra > 0 ? `${names.join(', ')} and ${extra} more` : names.join(', ');
 };

 const handleBulkAssign = async (agentId) => {
 try {
 const res = await bulkAssignMutation.mutateAsync({ prospectIds: selection.selectedIds, agentId });
 const skippedTotal = res?.skipped ? Object.values(res.skipped).reduce((a, b) => a + b, 0) : 0;
 const parts = [`${res?.affectedCount ?? 0} assigned`];
 if (res?.releasedCount > 0) parts.push(`${res.releasedCount} released from held`);
 if (skippedTotal > 0) parts.push(`${skippedTotal} skipped`);
 toast.success(parts.join(' · '));
 setBulkAssignOpen(false);
 selection.clear();
 } catch (error) {
 toast.error(error?.message || 'Bulk assign failed');
 }
 };

 const handleBulkReturn = async () => {
 try {
 const res = await bulkReturnMutation.mutateAsync({ prospectIds: selection.selectedIds });
 const moved = (res?.returned ?? 0) + (res?.promoted ?? 0);
 const parts = [`${moved} returned to held`];
 if (res?.alreadyHeld > 0) parts.push(`${res.alreadyHeld} already held`);
 if (res?.notFound > 0) parts.push(`${res.notFound} not found`);
 if (res?.undeliverable > 0) {
 toast.warning(`${res.undeliverable} could not be returned — lead delivery is not configured for the owning app.`);
 }
 toast.success(parts.join(' · '));
 setBulkReturnOpen(false);
 selection.clear();
 } catch (error) {
 toast.error(error?.message || 'Return to held failed');
 }
 };

 const handleBulkDelete = async () => {
 try {
 const res = await bulkDeleteMutation.mutateAsync({ prospectIds: selection.selectedIds });
 const parts = [`${res?.deleted ?? 0} deleted`];
 if (res?.notFound > 0) parts.push(`${res.notFound} not found`);
 if (res?.failed > 0) parts.push(`${res.failed} failed`);
 toast.success(parts.join(' · '));
 setBulkDeleteOpen(false);
 selection.clear();
 } catch (error) {
 toast.error(error?.message || 'Bulk delete failed');
 }
 };

 const handleStatusUpdate = async (prospectId, newStatus) => {
 try {
 await updateProspectMutation.mutateAsync({ id: prospectId, data: { leadStatus: newStatus } });
 } catch (error) { console.error('Error updating status:', error); }
 };

 const handleDeleteProspect = async (prospectId) => {
 try {
 await deleteProspectMutation.mutateAsync(prospectId);
 setDeleteConfirm(null);
 if (selectedProspect?.id === prospectId) setSelectedProspect(null);
 } catch (error) { console.error('Error deleting prospect:', error); }
 };

 // Exports act on the current selection if any rows are ticked (across pages),
 // otherwise the whole visible page.
 const exportFileName = (ext) =>
 `prospects_${format(new Date(), 'ddMMyyyy_HHmm')}${selection.count > 0 ? '_selected' : ''}.${ext}`;

 const fmtDob = (v) => {
 if (!v) return '';
 const d = new Date(v);
 return isNaN(d.getTime()) ? '' : format(d, 'dd/MM/yyyy');
 };
 // 'Source' keeps the stable enum (FORM/QR/REFERRAL/…) for downstream
 // consumers; ad-campaign / referrer context goes in the new 'Attribution'.
 const exportColumns = ['Created Date', 'Campaign', 'Name', 'Phone', 'Email', 'Date of Birth', 'Postal Code', 'Status', 'Assigned To', 'Source', 'Attribution'];
 const exportRowValues = (p) => {
 const campaign = campaigns.find((c) => c.id === p.campaign_id);
 return [
 format(new Date(p.created_date), 'dd/MM/yyyy HH:mm'),
 campaign?.name || '',
 p.name || '',
 p.phone || '',
 p.email || '',
 fmtDob(p.date_of_birth),
 p.postal_code || '',
 statusLabels[p.status] || p.status || '',
 p.assigned_agent_name || '',
 (p.source || '').toUpperCase(),
 sourceDisplay(p).attribution,
 ];
 };

 const exportToCSV = () => {
 if (exportRows.length === 0) return;
 const csvData = exportRows.map(exportRowValues);
 const csvContent = [exportColumns, ...csvData]
 .map((row) => row.map((field) => '"' + String(field ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
 const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
 const link = document.createElement('a');
 link.setAttribute('href', URL.createObjectURL(blob));
 link.setAttribute('download', exportFileName('csv'));
 document.body.appendChild(link);
 link.click();
 document.body.removeChild(link);
 };

 const exportToPDF = async () => {
 if (exportRows.length === 0) return;
 try {
 const [{ jsPDF }, autoTableModule] = await Promise.all([
 import('jspdf'),
 import('jspdf-autotable'),
 ]);
 const autoTable = autoTableModule.default;
 const doc = new jsPDF({ orientation: 'landscape' });
 const generatedAt = format(new Date(), 'dd MMM yyyy, h:mm a');
 const scopeLabel = selection.count > 0 ? `${exportRows.length} selected` : `${exportRows.length} total`;
 doc.setFontSize(14);
 doc.text('Prospects Export', 14, 15);
 doc.setFontSize(9);
 doc.setTextColor(110);
 doc.text(`${scopeLabel} • Generated ${generatedAt}`, 14, 21);
 autoTable(doc, {
 startY: 26,
 head: [exportColumns],
 body: exportRows.map(exportRowValues),
 styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
 headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
 alternateRowStyles: { fillColor: [245, 247, 250] },
 margin: { left: 14, right: 14 },
 });
 doc.save(exportFileName('pdf'));
 } catch (err) {
 console.error('Error generating PDF:', err);
 toast.error('Could not generate PDF. Please try again.');
 }
 };

 if (prospectsLoading) {
 return (
 <div className="p-6 lg:p-8 min-h-screen bg-background">
 <div className="max-w-[1400px] mx-auto space-y-6">
 <div className="h-8 bg-muted rounded w-48 animate-pulse"/>
 <div className="h-96 bg-muted rounded-xl animate-pulse"/>
 </div>
 </div>
 );
 }

 /* ═══════════════════════════════════════════════════════
 DETAIL VIEW — full-width, replaces the table
 ═══════════════════════════════════════════════════════ */
 if (selectedProspect) {
 return (
 <div className="p-6 lg:p-8 min-h-screen bg-background">
 <div className="max-w-[1200px] mx-auto">
 <ProspectDetails
 prospect={selectedProspect}
 campaigns={campaigns}
 onStatusUpdate={handleStatusUpdate}
 onClose={() => setSelectedProspect(null)}
 userRole={user?.role}
 onEdited={handleRefresh}
 />
 </div>
 </div>
 );
 }

 /* ═══════════════════════════════════════════════════════
 LIST VIEW — table with filters
 ═══════════════════════════════════════════════════════ */
 return (
 <div className="p-6 lg:p-8 min-h-screen bg-background">
 <div className="max-w-[1400px] mx-auto space-y-6">
 <PageHeader
 title="Prospects" description="Manage and track your sales prospects across all campaigns." actions={
 <div className="flex items-center gap-2">
 <Button variant="outline" className="bg-card" onClick={exportToCSV} disabled={exportRows.length === 0}>
 <FileSpreadsheet className="w-4 h-4 mr-2"/>
 Export CSV{selection.count > 0 ? ` (${selection.count})` : ''}
 </Button>
 <Button variant="outline" className="bg-card" onClick={exportToPDF} disabled={exportRows.length === 0}>
 <FileText className="w-4 h-4 mr-2"/>
 Export PDF{selection.count > 0 ? ` (${selection.count})` : ''}
 </Button>
 </div>
 }
 />

 {/* Table Card */}
 <Card className="border-border shadow-sm bg-card overflow-hidden">
 <CardHeader className="border-b border-border p-4 lg:p-6 bg-card">
 <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
 <div className="flex flex-1 flex-col sm:flex-row gap-3 w-full lg:max-w-4xl">
 <div className="relative flex-1 min-w-[240px]">
 <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4"/>
 <Input
 placeholder="Search prospects..." value={filters.search}
 onChange={(e) => applyFilters({ ...filters, search: e.target.value })}
 className="pl-9 h-10 bg-muted/50 border-border focus:bg-background transition-colors" />
 </div>
 <ProspectFilters filters={filters} onFilterChange={applyFilters} campaigns={campaigns} />
 </div>
 <div className="flex items-center gap-2 text-sm text-muted-foreground">
 <span className=" hidden sm:inline">Rows per page:</span>
 <Select value={String(pagination.itemsPerPage)} onValueChange={(v) => { setCurrentPage(1); setItemsPerPage(parseInt(v)); }}>
 <SelectTrigger className="w-[70px] h-9"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="10">10</SelectItem>
 <SelectItem value="25">25</SelectItem>
 <SelectItem value="50">50</SelectItem>
 <SelectItem value="100">100</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>
 </CardHeader>

 <CardContent className="p-0">
 {!isMobile ? (
 <div className="overflow-x-auto">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-border">
 <TableHead className="py-3 pl-6 pr-2 w-[44px]">
 <Checkbox
 checked={selection.allVisibleSelected ? true : selection.someVisibleSelected ?"indeterminate" : false}
 onCheckedChange={selection.toggleAllVisible}
 disabled={isPlaceholderData}
 aria-label="Select all prospects on this page" />
 </TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground">Prospect</TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground">Campaign</TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground">Status</TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground">Date Added</TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground">Source</TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground w-[100px] text-right">Actions</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {prospects.map((prospect) => {
 const campaign = campaigns.find(c => c.id === prospect.campaign_id);
 return (
 <TableRow
 key={prospect.id}
 className={`hover:bg-muted/50 transition-colors border-border group cursor-pointer ${selection.isSelected(prospect.id) ?"bg-primary/5" :""}`} onClick={() => setSelectedProspect(prospect)}
 >
 <TableCell className="pl-6 pr-2" onClick={(e) => e.stopPropagation()}>
 {/* onClick (not onCheckedChange) so shift-click range selection sees the
 modifier; preventDefault stops Radix's own toggle — checked stays
 fully controlled. Keyboard Space still fires click (shiftKey false). */}
 <Checkbox
 checked={selection.isSelected(prospect.id)}
 onClick={(e) => { e.preventDefault(); selection.toggleRow(prospect, { shiftKey: e.shiftKey }); }}
 aria-label={`Select ${prospect.name}`} />
 </TableCell>
 <TableCell className="px-6 py-4">
 <div className="flex items-center gap-3">
 <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold uppercase">
 {prospect.name?.charAt(0) || <User className="w-4 h-4"/>}
 </div>
 <div>
 <span className="font-medium text-foreground group-hover:text-primary dark:group-hover:text-primary transition-colors">
 {prospect.name}
 </span>
 {prospect.repeatSignupCount > 1 && (
 <span className="ml-2 inline-block align-middle text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" title={`Signed up for ${prospect.repeatSignupCount} campaigns`}>
 ⚠ {prospect.repeatSignupCount} campaigns
 </span>
 )}
 {prospect.quarantinedAt ? (
 <span
 className="block text-xs font-medium mt-0.5 text-amber-700 dark:text-amber-400" title={holdReasonLabel(prospect.quarantineReason)}>
 Held — {holdReasonLabel(prospect.quarantineReason)}
 </span>
 ) : prospect.assigned_agent_name ? (
 <span className="block text-xs text-muted-foreground font-normal mt-0.5">
 Agent: {prospect.assigned_agent_name}
 </span>
 ) : (
 <span className="block text-xs text-warning font-normal mt-0.5">
 Unassigned
 </span>
 )}
 </div>
 </div>
 </TableCell>
 <TableCell className="px-6 py-4">
 {campaign ? (
 <span className="text-sm text-foreground">{campaign.name}</span>
 ) : (
 <span className="text-muted-foreground text-sm italic">—</span>
 )}
 </TableCell>
 <TableCell className="px-6 py-4">
 <Badge variant="outline" className={`font-normal ${statusStyles[prospect.status] ||"bg-muted text-muted-foreground border-border"}`}>
 {statusLabels[prospect.status] || prospect.status}
 </Badge>
 </TableCell>
 <TableCell className="px-6 py-4 text-sm text-muted-foreground">
 {format(new Date(prospect.created_date), 'MMM d, yyyy')}
 <span className="block text-xs text-muted-foreground mt-0.5">
 {format(new Date(prospect.created_date), 'h:mm a')}
 </span>
 </TableCell>
 <TableCell className="px-6 py-4">
 <SourceTag prospect={prospect} />
 </TableCell>
 <TableCell className="px-6 py-4 text-right">
 <Button
 variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(prospect); }}
 className="text-muted-foreground hover:text-destructive dark:hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0" >
 <Trash2 className="w-4 h-4"/>
 </Button>
 </TableCell>
 </TableRow>
 );
 })}
 {prospects.length === 0 && (
 <TableEmpty
 colSpan={7}
 icon={Search}
 title="No prospects found"
 description="Try adjusting your filters or search terms." />
 )}
 </TableBody>
 </Table>
 </div>
 ) : (
 <div className="divide-y divide-border">
 {prospects.length === 0 ? (
 <EmptyState
 icon={Search}
 title="No prospects found"
 description="Try adjusting your filters or search terms." />
 ) : prospects.map((prospect) => (
 <div
 key={prospect.id}
 className={`flex items-start gap-3 p-4 ${selection.isSelected(prospect.id) ?"bg-primary/5" :""}`}>
 <Checkbox
 checked={selection.isSelected(prospect.id)}
 onClick={(e) => { e.preventDefault(); selection.toggleRow(prospect, { shiftKey: e.shiftKey }); }}
 aria-label={`Select ${prospect.name}`}
 className="mt-1.5" />
 <button
 type="button"
 onClick={() => setSelectedProspect(prospect)}
 aria-label={`View prospect ${prospect.name}`}
 className="flex-1 min-w-0 text-left active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-md">
 <div className="flex justify-between items-start mb-2">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">
 {prospect.name?.charAt(0)}
 </div>
 <div>
 <div className="font-medium text-foreground flex items-center gap-2">
 {prospect.name}
 {prospect.repeatSignupCount > 1 && (
 <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" title={`Signed up for ${prospect.repeatSignupCount} campaigns`}>
 ⚠ {prospect.repeatSignupCount}
 </span>
 )}
 </div>
 <div className="text-xs text-muted-foreground">{format(new Date(prospect.created_date), 'MMM d, h:mm a')}</div>
 </div>
 </div>
 <Badge variant="outline" className={statusStyles[prospect.status] ||"bg-muted"}>
 {statusLabels[prospect.status] || prospect.status}
 </Badge>
 </div>
 <div className="text-sm text-muted-foreground mt-3 pl-13 space-y-1.5">
 <div>{campaigns.find(c => c.id === prospect.campaign_id)?.name || 'Unknown Campaign'}</div>
 <SourceTag prospect={prospect} compact />
 </div>
 </button>
 </div>
 ))}
 </div>
 )}

 {pagination.totalPages > 1 && (
 <div className="px-4">
 <TablePagination
 currentPage={pagination.currentPage}
 totalItems={pagination.totalItems}
 itemsPerPage={pagination.itemsPerPage}
 onPageChange={setCurrentPage}
 itemLabel="prospect" />
 </div>
 )}
 </CardContent>
 </Card>

 <ConfirmDialog
 open={!!deleteConfirm}
 onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}
 title="Delete prospect?" description={
 <>
 Are you sure you want to delete{' '}
 <span className="font-semibold">{deleteConfirm?.name}</span>?
 This can't be undone.
 </>
 }
 confirmText="Delete" destructive
 confirmIcon={<Trash2 className="w-4 h-4"/>}
 onConfirm={() => deleteConfirm && handleDeleteProspect(deleteConfirm.id)}
 />

 {/* ── Bulk selection actions ─────────────────────────────── */}
 <BulkActionBar
 count={selection.count}
 heldCount={heldSelectedCount}
 busy={bulkBusy}
 onAssign={() => setBulkAssignOpen(true)}
 onReturnToHeld={() => setBulkReturnOpen(true)}
 onDelete={() => setBulkDeleteOpen(true)}
 onExportCSV={exportToCSV}
 onExportPDF={exportToPDF}
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
 {' '}will be pulled back from their agents and moved to the Held queue, pending
 reassignment. The previous agents lose access; credits are not refunded. You can
 re-assign them anytime from the Held filter.
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
 {' '}will be permanently deleted from MKTR. This can't be undone. Copies already
 delivered to a Lyfe agent's app are not removed by this action.
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
