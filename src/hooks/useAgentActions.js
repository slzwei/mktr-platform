import { useState, useCallback } from "react";
import { User } from "@/api/entities";
import { LeadPackage } from "@/api/entities";
import { agents as agentsAPI, apiClient } from "@/api/client";

/**
 * Custom hook encapsulating all agent CRUD operations:
 * sync, invite/edit, delete, bulk delete, toggle status, resend invite,
 * and package management (open, delete, update assignments).
 */
export default function useAgentActions({ queryClient, toast }) {
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(() =>
    localStorage.getItem("lyfe_last_sync")
  );

  // Confirm dialog state (rendered by consumer component)
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: "", description: "", onConfirm: null, destructive: false });

  const openConfirm = useCallback(({ title, description, onConfirm, destructive = true }) => {
    setConfirmDialog({ open: true, title, description, onConfirm, destructive });
  }, []);

  const closeConfirm = useCallback(() => {
    setConfirmDialog(prev => ({ ...prev, open: false }));
  }, []);

  // --- Package management state ---
  const [managePackagesDialogOpen, setManagePackagesDialogOpen] = useState(false);
  const [packagesForAgent, setPackagesForAgent] = useState([]);
  const [editingAssignmentId, setEditingAssignmentId] = useState(null);
  const [editLeadCount, setEditLeadCount] = useState("");

  // ---- Lyfe sync ----
  const handleSyncFromLyfe = async () => {
    setSyncing(true);
    try {
      const res = await apiClient.post("/lyfe/agents/sync");
      const { created, updated, deactivated, skipped } = res.data || {};
      const parts = [];
      if (created) parts.push(`${created} added`);
      if (updated) parts.push(`${updated} updated`);
      if (deactivated) parts.push(`${deactivated} deactivated`);
      if (skipped) parts.push(`${skipped} unchanged`);
      toast({
        title: "Sync Complete",
        description: parts.join(", ") || "No changes",
      });
      const now = new Date().toISOString();
      localStorage.setItem("lyfe_last_sync", now);
      setLastSyncTime(now);
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    } catch (error) {
      console.error("Error syncing from Lyfe:", error);
      toast({
        variant: "destructive",
        title: "Sync Failed",
        description: error?.message || "Could not fetch agents from Lyfe",
      });
    }
    setSyncing(false);
  };

  // ---- Agent form submit (create or update) ----
  const handleFormSubmit = async (formData, selectedAgent) => {
    const name = (formData.full_name || "").trim();
    const isActive = (formData.status || "active") === "active";

    if (selectedAgent) {
      const [firstName, ...rest] = name.split(" ");
      const lastName = rest.join(" ").trim();
      const normalizedPhone = (formData.phone || "").replace(/\D/g, "");
      await User.update(selectedAgent.id, {
        firstName,
        lastName,
        email: formData.email,
        phone: normalizedPhone || undefined,
        dateOfBirth: formData.dateOfBirth || undefined,
        isActive,
      });
    } else {
      await agentsAPI.invite({
        email: formData.email,
        full_name: name,
      });
    }

    queryClient.invalidateQueries({ queryKey: ["agents"] });
  };

  // ---- Delete single agent ----
  const handleDeleteAgent = (agent) => {
    if (!agent) return;
    openConfirm({
      title: "Delete Agent",
      description: `Permanently delete ${agent.fullName || agent.email}? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await apiClient.delete(`/users/${agent.id}/permanent`);
          queryClient.invalidateQueries({ queryKey: ["agents"] });
          toast({ title: "Success", description: "Agent deleted successfully" });
        } catch (error) {
          console.error("Error deleting agent:", error);
          toast({
            variant: "destructive",
            title: "Error",
            description: error?.message || "Failed to delete agent",
          });
        }
        closeConfirm();
      },
    });
  };

  // ---- Bulk delete ----
  const handleBulkDelete = (selectedAgentIds, clearSelection) => {
    if (selectedAgentIds.length === 0) return;
    openConfirm({
      title: "Delete Selected Agents",
      description: `Are you sure you want to permanently delete ${selectedAgentIds.length} agents? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await apiClient.post("/users/bulk-delete", { ids: selectedAgentIds });
          toast({
            title: "Success",
            description: `${selectedAgentIds.length} agents deleted successfully`,
          });
          clearSelection();
          queryClient.invalidateQueries({ queryKey: ["agents"] });
        } catch (error) {
          console.error("Error deleting agents:", error);
          toast({
            variant: "destructive",
            title: "Error",
            description: error?.message || "Failed to delete agents",
          });
        }
        closeConfirm();
      },
    });
  };

  // ---- Toggle active/inactive ----
  const handleToggleStatus = async (agent) => {
    if (!agent) return;
    try {
      await User.update(agent.id, { isActive: !agent.isActive });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    } catch (error) {
      console.error("Error toggling agent status:", error);
    }
  };

  // ---- Resend invite ----
  const handleResendInvite = async (agent) => {
    if (!agent?.email) return;
    try {
      const fullName =
        agent.fullName ||
        `${agent.firstName || ""} ${agent.lastName || ""}`.trim();
      await agentsAPI.invite({ email: agent.email, full_name: fullName });
      toast({ title: "Success", description: "Invitation email sent" });
    } catch (error) {
      console.error("Error resending invite:", error);
      toast({ variant: "destructive", title: "Error", description: error?.message || "Failed to resend invitation" });
    }
  };

  // ---- Approve / Reject ----
  const handleSetApprovalStatus = async (agentId, status) => {
    try {
      await User.setApprovalStatus(agentId, status);
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    } catch (e) {
      console.error(e);
    }
  };

  // ---- Package dialog helpers ----
  const openManagePackagesDialog = async (agent) => {
    if (!agent) return;
    try {
      const assignments = await LeadPackage.getAssignments(agent.id);
      setPackagesForAgent(assignments || []);
      setManagePackagesDialogOpen(true);
    } catch (e) {
      console.error("Failed to load agent packages", e);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load assigned packages",
      });
    }
  };

  const handleDeleteAssignment = (assignmentId, agentId) => {
    openConfirm({
      title: "Remove Package Assignment",
      description: "Are you sure you want to remove this package assignment? This cannot be undone.",
      onConfirm: async () => {
        try {
          await LeadPackage.deleteAssignment(assignmentId);
          toast({ title: "Success", description: "Package assignment removed" });
          const assignments = await LeadPackage.getAssignments(agentId);
          setPackagesForAgent(assignments || []);
          queryClient.invalidateQueries({ queryKey: ["agents"] });
        } catch (e) {
          console.error("Failed to delete assignment", e);
          toast({
            variant: "destructive",
            title: "Error",
            description: e.message || "Failed to delete assignment",
          });
        }
        closeConfirm();
      },
    });
  };

  const handleStartEdit = (assignment) => {
    setEditingAssignmentId(assignment.id);
    setEditLeadCount(String(assignment.leadsRemaining));
  };

  const handleCancelEdit = () => {
    setEditingAssignmentId(null);
    setEditLeadCount("");
  };

  const handleUpdateAssignment = async (assignmentId, agentId) => {
    try {
      const newCount = parseInt(editLeadCount, 10);
      if (isNaN(newCount) || newCount < 0) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Invalid lead count",
        });
        return;
      }

      await LeadPackage.updateAssignment(assignmentId, {
        leadsRemaining: newCount,
      });

      toast({ title: "Success", description: "Lead count updated" });
      setEditingAssignmentId(null);
      const assignments = await LeadPackage.getAssignments(agentId);
      setPackagesForAgent(assignments || []);
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    } catch (e) {
      console.error("Failed to update assignment", e);
      toast({
        variant: "destructive",
        title: "Error",
        description: e.message || "Failed to update assignment",
      });
    }
  };

  const handlePackageSubmit = async (selectedAgent) => {
    try {
      if (selectedAgent) {
        const assignments = await LeadPackage.getAssignments(selectedAgent.id);
        setPackagesForAgent(assignments || []);
      }
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      toast({ title: "Success", description: "Package assigned successfully" });
    } catch (error) {
      console.error("Error refreshing data:", error);
    }
  };

  return {
    // Sync
    syncing,
    lastSyncTime,
    handleSyncFromLyfe,

    // Agent CRUD
    handleFormSubmit,
    handleDeleteAgent,
    handleBulkDelete,
    handleToggleStatus,
    handleResendInvite,
    handleSetApprovalStatus,

    // Package management
    managePackagesDialogOpen,
    setManagePackagesDialogOpen,
    packagesForAgent,
    editingAssignmentId,
    editLeadCount,
    setEditLeadCount,
    openManagePackagesDialog,
    handleDeleteAssignment,
    handleStartEdit,
    handleCancelEdit,
    handleUpdateAssignment,
    handlePackageSubmit,

    // Confirm dialog state (render ConfirmDialog in consumer)
    confirmDialog,
    closeConfirm,
  };
}
