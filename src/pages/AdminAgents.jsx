import { useState, useMemo, useEffect } from 'react';
import { agents as agentsAPI } from '@/api/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/queries/useUsersQuery';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, RefreshCw } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import PageHeader from '@/components/common/PageHeader';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import AgentFilters from '../components/agents/AgentFilters';
import AgentTable from '../components/agents/AgentTable';
import ManagePackagesDialog from '../components/agents/ManagePackagesDialog';
import InviteAgentDialog from '../components/agents/InviteAgentDialog';
import MktrLeadsAgentDialog from '../components/agents/MktrLeadsAgentDialog';
import AgentDetailsDialog from '../components/agents/AgentDetailsDialog';
import AssignPackageDialog from '../components/agents/AssignPackageDialog';
import useAgentActions from '@/hooks/useAgentActions';
import { isMktrLeadsAgent, isLocalAgent } from '@/lib/agentSource';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/**
 * Build a page-number list with ellipses for long ranges.
 * Returns a mix of numbers and the literal string '…'.
 *   buildPageList(5, 1)  → [1]
 *   buildPageList(5, 3)  → [1, 2, 3, 4, 5]
 *   buildPageList(20, 1) → [1, 2, 3, '…', 20]
 *   buildPageList(20, 10)→ [1, '…', 9, 10, 11, '…', 20]
 */
function buildPageList(totalPages, current) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set([1, totalPages, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('…');
    out.push(sorted[i]);
  }
  return out;
}

export default function AdminAgents() {
 const queryClient = useQueryClient();
 const { data: user } = useCurrentUser();

 const { data: agentsData, isLoading: loading } = useQuery({
 queryKey: ['agents', 'list'],
 queryFn: () => agentsAPI.getAll(),
 enabled: !!user,
 });
 const agents = agentsData?.agents || [];

 // --- Local UI state ---
 const [selectedAgentIds, setSelectedAgentIds] = useState([]);
 const [isFormOpen, setIsFormOpen] = useState(false);
 const [isMktrFormOpen, setIsMktrFormOpen] = useState(false);
 const [isDetailsOpen, setIsDetailsOpen] = useState(false);
 const [isPackageDialogOpen, setIsPackageDialogOpen] = useState(false);
 const [selectedAgent, setSelectedAgent] = useState(null);
 const [searchTerm, setSearchTerm] = useState('');
 const [statusFilter, setStatusFilter] = useState('all');
 const [page, setPage] = useState(1);
 const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);

 // --- Actions hook ---
 const actions = useAgentActions({ queryClient });

 // --- Filtering ---
 const filteredAgents = agents.filter((agent) => {
 const needle = (searchTerm || '').toLowerCase();
 const name = (agent.fullName || agent.full_name || '').toLowerCase();
 const matchesSearch =
 name.includes(needle) || agent.email?.toLowerCase().includes(needle) || agent.phone?.includes(searchTerm);

 let matchesStatus = true;
 if (statusFilter !== 'all') {
 // Pending = locally-invited awaiting registration. Mirrored rows (Lyfe /
 // MKTR Leads) have no local password + emailVerified=false by
 // construction, so they must be excluded or they all read as pending.
 const isPending =
 isLocalAgent(agent) &&
 agent?.isActive === true &&
 (agent?.status === 'pending_registration' || !!agent?.invitationToken || agent?.emailVerified === false);
 if (statusFilter === 'pending') matchesStatus = isPending;
 else if (statusFilter === 'active') matchesStatus = agent.isActive && !isPending;
 else if (statusFilter === 'inactive') matchesStatus = !agent.isActive;
 }
 return matchesSearch && matchesStatus;
 });

 // --- Pagination (client-side; fetch already returns up to limit=200) ---
 const totalPages = Math.max(1, Math.ceil(filteredAgents.length / pageSize));
 const safePage = Math.min(page, totalPages);
 const paginatedAgents = useMemo(
 () => filteredAgents.slice((safePage - 1) * pageSize, safePage * pageSize),
 [filteredAgents, safePage, pageSize],
 );

 // Reset to page 1 whenever the filtered set shrinks beneath the current
 // page. Avoids a "no rows" page after filtering.
 useEffect(() => {
 if (page > totalPages) setPage(1);
 }, [totalPages, page]);

 // Reset to page 1 whenever filters change so users see results immediately.
 useEffect(() => {
 setPage(1);
 }, [searchTerm, statusFilter, pageSize]);

 const showingFrom = filteredAgents.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
 const showingTo = Math.min(safePage * pageSize, filteredAgents.length);

 // --- Selection handlers ---
 // Selection drives bulk-delete, which only applies to legacy LOCAL rows —
 // mirrored agents are owned by their source app (rows render disabled boxes).
 const handleSelectAll = (checked) => {
 setSelectedAgentIds(checked ? filteredAgents.filter(isLocalAgent).map((a) => a.id) : []);
 };

 const handleSelectAgent = (agentId, checked) => {
 setSelectedAgentIds((prev) => (checked ? [...prev, agentId] : prev.filter((id) => id !== agentId)));
 };

 // --- Dialog openers ---
 // Inviting a NEW agent always goes through MKTR Leads (the local invite
 // minted rows no app could deliver leads to). Editing routes by source:
 // MKTR-Leads-owned rows use the write-back dialog; legacy local rows keep
 // the original form. (Lyfe rows: Edit is disabled in the table.)
 const handleOpenForm = (agent = null) => {
 setSelectedAgent(agent);
 if (!agent || isMktrLeadsAgent(agent)) {
 setIsMktrFormOpen(true);
 } else {
 setIsFormOpen(true);
 }
 };

 const handleOpenDetails = (agent) => {
 setSelectedAgent(agent);
 setIsDetailsOpen(true);
 };

 const handleOpenPackageDialog = (agent) => {
 setSelectedAgent(agent);
 setIsPackageDialogOpen(true);
 };

 const handleOpenManagePackages = (agent) => {
 setSelectedAgent(agent);
 actions.openManagePackagesDialog(agent);
 };

 // --- Form submit wrappers ---
 const handleFormSubmit = async (formData) => {
 try {
 await actions.handleFormSubmit(formData, selectedAgent);
 setIsFormOpen(false);
 setSelectedAgent(null);
 } catch (error) {
 console.error('Error saving agent:', error);
 throw error;
 }
 };

 const handleMktrFormSubmit = async (formData, agent) => {
 try {
 await actions.handleMktrLeadsSubmit(formData, agent);
 setIsMktrFormOpen(false);
 setSelectedAgent(null);
 } catch (error) {
 console.error('Error saving MKTR Leads agent:', error);
 throw error;
 }
 };

 // --- Package submit wrapper ---
 const handlePackageSubmit = async () => {
 await actions.handlePackageSubmit(selectedAgent);
 setIsPackageDialogOpen(false);
 if (!actions.managePackagesDialogOpen) {
 setSelectedAgent(null);
 }
 };

 // --- Loading state ---
 if (loading) {
 return (
 <div className="p-6 lg:p-8 min-h-screen bg-background">
 <div className="max-w-[1600px] mx-auto space-y-6">
 <div className="h-8 bg-muted rounded w-48 animate-pulse"></div>
 <div className="h-96 bg-muted rounded-xl animate-pulse"></div>
 </div>
 </div>
 );
 }

 // Role gating handled by ProtectedRoute; avoid double-deny here

 return (
 <div className="p-6 lg:p-8 min-h-screen bg-background">
 <div className="max-w-[1600px] mx-auto space-y-6">
 <PageHeader
 title="Agents" description="Manage your sales agents and their performance." actions={
 <>
 {actions.lastSyncTime && (
 <span className="text-xs text-muted-foreground hidden lg:inline">
 Last synced {new Date(actions.lastSyncTime).toLocaleString()}
 </span>
 )}
 <Button variant="outline" onClick={actions.handleSyncFromLyfe} disabled={actions.syncing}>
 <RefreshCw className={`w-4 h-4 mr-2 ${actions.syncing ? 'animate-spin' : ''}`} />
 {actions.syncing ? 'Syncing...' : 'Sync Agents'}
 </Button>
 <Button onClick={() => handleOpenForm()} className="bg-primary hover:bg-primary/90">
 <Plus className="w-5 h-5 mr-2"/>
 Invite Agent
 </Button>
 </>
 }
 />

 {/* Filters + Table */}
 <Card className="border-border shadow-sm bg-card overflow-hidden">
 <CardHeader className="border-b border-border p-4 lg:p-6 bg-card">
 <AgentFilters
 searchTerm={searchTerm}
 onSearchChange={setSearchTerm}
 statusFilter={statusFilter}
 onStatusFilterChange={setStatusFilter}
 />
 </CardHeader>
 <CardContent className="p-0">
 <AgentTable
 agents={paginatedAgents}
 selectedAgentIds={selectedAgentIds}
 onSelectAll={handleSelectAll}
 onSelectAgent={handleSelectAgent}
 onBulkDelete={() => actions.handleBulkDelete(selectedAgentIds, () => setSelectedAgentIds([]))}
 onViewDetails={handleOpenDetails}
 onEditAgent={(agent) => handleOpenForm(agent)}
 onDeleteAgent={actions.handleDeleteAgent}
 onToggleStatus={actions.handleToggleStatus}
 onResendInvite={actions.handleResendInvite}
 onApprove={(id) => actions.handleSetApprovalStatus(id, 'approved')}
 onReject={(id) => actions.handleSetApprovalStatus(id, 'rejected')}
 onManagePackages={handleOpenManagePackages}
 onAssignPackage={handleOpenPackageDialog}
 />

 {/* Pagination footer */}
 <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border-t border-border p-3 lg:px-6">
 <div className="flex items-center gap-3 text-sm text-muted-foreground">
 <span>
 {filteredAgents.length === 0
 ? 'No agents'
 : `Showing ${showingFrom}–${showingTo} of ${filteredAgents.length}`}
 </span>
 <div className="flex items-center gap-2">
 <span className="hidden sm:inline">Per page:</span>
 <Select
 value={String(pageSize)}
 onValueChange={(v) => setPageSize(Number(v))}
 >
 <SelectTrigger className="h-8 w-20">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 {PAGE_SIZE_OPTIONS.map((n) => (
 <SelectItem key={n} value={String(n)}>{n}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>

 {totalPages > 1 && (
 <Pagination className="lg:justify-end lg:mx-0">
 <PaginationContent>
 <PaginationItem>
 <PaginationPrevious
 href="#"
 onClick={(e) => {
 e.preventDefault();
 if (safePage > 1) setPage(safePage - 1);
 }}
 className={safePage <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
 />
 </PaginationItem>

 {buildPageList(totalPages, safePage).map((p, i) =>
 p === '…' ? (
 <PaginationItem key={`ellipsis-${i}`}>
 <PaginationEllipsis />
 </PaginationItem>
 ) : (
 <PaginationItem key={p}>
 <PaginationLink
 href="#"
 isActive={p === safePage}
 onClick={(e) => {
 e.preventDefault();
 setPage(p);
 }}
 className="cursor-pointer"
 >
 {p}
 </PaginationLink>
 </PaginationItem>
 ),
 )}

 <PaginationItem>
 <PaginationNext
 href="#"
 onClick={(e) => {
 e.preventDefault();
 if (safePage < totalPages) setPage(safePage + 1);
 }}
 className={safePage >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
 />
 </PaginationItem>
 </PaginationContent>
 </Pagination>
 )}
 </div>
 </CardContent>
 </Card>

 {/* Dialogs */}
 <InviteAgentDialog
 open={isFormOpen}
 onOpenChange={setIsFormOpen}
 agent={selectedAgent}
 onSubmit={handleFormSubmit}
 />

 <MktrLeadsAgentDialog
 open={isMktrFormOpen}
 onOpenChange={setIsMktrFormOpen}
 agent={selectedAgent && isMktrLeadsAgent(selectedAgent) ? selectedAgent : null}
 onSubmit={handleMktrFormSubmit}
 />

 <AgentDetailsDialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen} agent={selectedAgent} />

 <AssignPackageDialog
 open={isPackageDialogOpen}
 onOpenChange={setIsPackageDialogOpen}
 agent={selectedAgent}
 onSubmitSuccess={handlePackageSubmit}
 />

 <ManagePackagesDialog
 open={actions.managePackagesDialogOpen}
 onOpenChange={actions.setManagePackagesDialogOpen}
 agent={selectedAgent}
 packages={actions.packagesForAgent}
 editingAssignmentId={actions.editingAssignmentId}
 editLeadCount={actions.editLeadCount}
 onEditLeadCountChange={actions.setEditLeadCount}
 onStartEdit={actions.handleStartEdit}
 onCancelEdit={actions.handleCancelEdit}
 onUpdateAssignment={(id) => actions.handleUpdateAssignment(id, selectedAgent?.id)}
 onDeleteAssignment={(id) => actions.handleDeleteAssignment(id, selectedAgent?.id)}
 onAssignPackage={() => handleOpenPackageDialog(selectedAgent)}
 />

 <ConfirmDialog
 open={actions.confirmDialog.open}
 onOpenChange={(open) => {
 if (!open) actions.closeConfirm();
 }}
 title={actions.confirmDialog.title}
 description={actions.confirmDialog.description}
 onConfirm={actions.confirmDialog.onConfirm}
 confirmText={actions.confirmDialog.confirmText || (actions.confirmDialog.destructive ? 'Delete' : 'OK')}
 destructive={actions.confirmDialog.destructive}
 />
 </div>
 </div>
 );
}
