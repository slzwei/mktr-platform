import { useState } from 'react';
import { agents as agentsAPI } from '@/api/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/queries/useUsersQuery';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, RefreshCw } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import PageHeader from '@/components/common/PageHeader';

import AgentFilters from '../components/agents/AgentFilters';
import AgentTable from '../components/agents/AgentTable';
import ManagePackagesDialog from '../components/agents/ManagePackagesDialog';
import InviteAgentDialog from '../components/agents/InviteAgentDialog';
import AgentDetailsDialog from '../components/agents/AgentDetailsDialog';
import AssignPackageDialog from '../components/agents/AssignPackageDialog';
import useAgentActions from '@/hooks/useAgentActions';

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
 const [isDetailsOpen, setIsDetailsOpen] = useState(false);
 const [isPackageDialogOpen, setIsPackageDialogOpen] = useState(false);
 const [selectedAgent, setSelectedAgent] = useState(null);
 const [searchTerm, setSearchTerm] = useState('');
 const [statusFilter, setStatusFilter] = useState('all');

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
 const isPending =
 agent?.isActive === true &&
 (agent?.status === 'pending_registration' || !!agent?.invitationToken || agent?.emailVerified === false);
 if (statusFilter === 'pending') matchesStatus = isPending;
 else if (statusFilter === 'active') matchesStatus = agent.isActive && !isPending;
 else if (statusFilter === 'inactive') matchesStatus = !agent.isActive;
 }
 return matchesSearch && matchesStatus;
 });

 // --- Selection handlers ---
 const handleSelectAll = (checked) => {
 setSelectedAgentIds(checked ? filteredAgents.map((a) => a.id) : []);
 };

 const handleSelectAgent = (agentId, checked) => {
 setSelectedAgentIds((prev) => (checked ? [...prev, agentId] : prev.filter((id) => id !== agentId)));
 };

 // --- Dialog openers ---
 const handleOpenForm = (agent = null) => {
 setSelectedAgent(agent);
 setIsFormOpen(true);
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

 // --- Form submit wrapper ---
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
 {actions.syncing ? 'Syncing...' : 'Sync from Lyfe'}
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
 agents={filteredAgents}
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
 </CardContent>
 </Card>

 {/* Dialogs */}
 <InviteAgentDialog
 open={isFormOpen}
 onOpenChange={setIsFormOpen}
 agent={selectedAgent}
 onSubmit={handleFormSubmit}
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
 confirmText={actions.confirmDialog.destructive ? 'Delete' : 'OK'}
 destructive={actions.confirmDialog.destructive}
 />
 </div>
 </div>
 );
}
