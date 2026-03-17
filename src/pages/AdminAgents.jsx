import { useState } from "react";
import { agents as agentsAPI } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/queries/useUsersQuery";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Plus, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

import AgentFilters from "../components/agents/AgentFilters";
import AgentTable from "../components/agents/AgentTable";
import ManagePackagesDialog from "../components/agents/ManagePackagesDialog";
import InviteAgentDialog from "../components/agents/InviteAgentDialog";
import AgentDetailsDialog from "../components/agents/AgentDetailsDialog";
import AssignPackageDialog from "../components/agents/AssignPackageDialog";
import useAgentActions from "@/hooks/useAgentActions";

export default function AdminAgents() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useCurrentUser();

  const { data: agentsData, isLoading: loading } = useQuery({
    queryKey: ["agents", "list"],
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
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // --- Actions hook ---
  const actions = useAgentActions({ queryClient, toast });

  // --- Filtering ---
  const filteredAgents = agents.filter((agent) => {
    const needle = (searchTerm || "").toLowerCase();
    const name = (agent.fullName || agent.full_name || "").toLowerCase();
    const matchesSearch =
      name.includes(needle) ||
      agent.email?.toLowerCase().includes(needle) ||
      agent.phone?.includes(searchTerm);

    let matchesStatus = true;
    if (statusFilter !== "all") {
      const isPending =
        agent?.isActive === true &&
        (agent?.status === "pending_registration" ||
          !!agent?.invitationToken ||
          agent?.emailVerified === false);
      if (statusFilter === "pending") matchesStatus = isPending;
      else if (statusFilter === "active") matchesStatus = agent.isActive && !isPending;
      else if (statusFilter === "inactive") matchesStatus = !agent.isActive;
    }
    return matchesSearch && matchesStatus;
  });

  // --- Selection handlers ---
  const handleSelectAll = (checked) => {
    setSelectedAgentIds(checked ? filteredAgents.map((a) => a.id) : []);
  };

  const handleSelectAgent = (agentId, checked) => {
    setSelectedAgentIds((prev) =>
      checked ? [...prev, agentId] : prev.filter((id) => id !== agentId)
    );
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
      console.error("Error saving agent:", error);
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
      <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50 dark:bg-gray-900/50">
        <div className="max-w-[1600px] mx-auto space-y-6">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-48 animate-pulse"></div>
          <div className="h-96 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse"></div>
        </div>
      </div>
    );
  }

  // Role gating handled by ProtectedRoute; avoid double-deny here

  return (
    <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50 dark:bg-gray-900/50">
      <div className="max-w-[1600px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Agents</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Manage your sales agents and their performance.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              {actions.lastSyncTime && (
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  Last synced {new Date(actions.lastSyncTime).toLocaleString()}
                </span>
              )}
              <Button variant="outline" onClick={actions.handleSyncFromLyfe} disabled={actions.syncing}>
                <RefreshCw className={`w-4 h-4 mr-2 ${actions.syncing ? "animate-spin" : ""}`} />
                {actions.syncing ? "Syncing..." : "Sync from Lyfe"}
              </Button>
            </div>
            <Button onClick={() => handleOpenForm()} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-5 h-5 mr-2" />
              Invite Agent
            </Button>
          </div>
        </div>

        {/* Filters + Table */}
        <Card className="border-gray-200/50 dark:border-gray-700/50 shadow-sm bg-white dark:bg-gray-900 overflow-hidden">
          <CardHeader className="border-b border-gray-100 dark:border-gray-700 p-4 lg:p-6 bg-white dark:bg-gray-900">
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
              onApprove={(id) => actions.handleSetApprovalStatus(id, "approved")}
              onReject={(id) => actions.handleSetApprovalStatus(id, "rejected")}
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

        <AgentDetailsDialog
          open={isDetailsOpen}
          onOpenChange={setIsDetailsOpen}
          agent={selectedAgent}
        />

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
          onOpenChange={(open) => { if (!open) actions.closeConfirm(); }}
          title={actions.confirmDialog.title}
          description={actions.confirmDialog.description}
          onConfirm={actions.confirmDialog.onConfirm}
          confirmText={actions.confirmDialog.destructive ? "Delete" : "OK"}
          destructive={actions.confirmDialog.destructive}
        />
      </div>
    </div>
  );
}
