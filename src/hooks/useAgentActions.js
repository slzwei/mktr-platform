import { useState, useCallback } from 'react';
import { User } from '@/api/entities';
import { LeadPackage } from '@/api/entities';
import { agents as agentsAPI, apiClient } from '@/api/client';
import { isMktrLeadsAgent, isLyfeAgent } from '@/lib/agentSource';
import { toast } from 'sonner';

/**
 * Custom hook encapsulating all agent CRUD operations:
 * sync, invite/edit, delete, bulk delete, toggle status, resend invite,
 * and package management (open, delete, update assignments).
 *
 * Source-awareness: Lyfe-owned agents are read-only here (managed in the Lyfe
 * app); MKTR-Leads-owned agents are managed via the /mktr-leads/agents/*
 * write-back endpoints (that app is the source of truth); legacy local rows
 * keep the original local behaviour.
 */
export default function useAgentActions({ queryClient }) {
 const [syncing, setSyncing] = useState(false);
 const [lastSyncTime, setLastSyncTime] = useState(() => localStorage.getItem('lyfe_last_sync'));

 // Confirm dialog state (rendered by consumer component)
 const [confirmDialog, setConfirmDialog] = useState({
 open: false,
 title: '',
 description: '',
 onConfirm: null,
 destructive: false,
 confirmText: null,
 });

 const openConfirm = useCallback(({ title, description, onConfirm, destructive = true, confirmText = null }) => {
 setConfirmDialog({ open: true, title, description, onConfirm, destructive, confirmText });
 }, []);

 const closeConfirm = useCallback(() => {
 setConfirmDialog((prev) => ({ ...prev, open: false }));
 }, []);

 // --- Package management state ---
 const [managePackagesDialogOpen, setManagePackagesDialogOpen] = useState(false);
 const [packagesForAgent, setPackagesForAgent] = useState([]);
 const [editingAssignmentId, setEditingAssignmentId] = useState(null);
 const [editLeadCount, setEditLeadCount] = useState('');

 // ---- Agent sync (both sources: Lyfe + MKTR Leads) ----
 const handleSyncFromLyfe = async () => {
 setSyncing(true);
 try {
 const res = await apiClient.post('/lyfe/agents/sync');
 const totals = { ...(res.data || {}) };

 // MKTR Leads is the second agent source. A 503 means it simply isn't
 // configured on this deployment — not an error worth surfacing.
 try {
 const mlRes = await apiClient.post('/mktr-leads/agents/sync');
 for (const k of ['created', 'updated', 'deactivated', 'skipped']) {
 totals[k] = (totals[k] || 0) + (mlRes.data?.[k] || 0);
 }
 } catch (mlError) {
 if (mlError?.status !== 503 && mlError?.response?.status !== 503) {
 console.error('Error syncing from MKTR Leads:', mlError);
 toast.error(mlError?.message || 'Could not sync MKTR Leads agents');
 }
 }

 const { created, updated, deactivated, skipped } = totals;
 const parts = [];
 if (created) parts.push(`${created} added`);
 if (updated) parts.push(`${updated} updated`);
 if (deactivated) parts.push(`${deactivated} deactivated`);
 if (skipped) parts.push(`${skipped} unchanged`);
 toast.success(parts.join(', ') || 'No changes');
 const now = new Date().toISOString();
 localStorage.setItem('lyfe_last_sync', now);
 setLastSyncTime(now);
 queryClient.invalidateQueries({ queryKey: ['agents'] });
 } catch (error) {
 console.error('Error syncing from Lyfe:', error);
 toast.error(error?.message || 'Could not fetch agents from Lyfe');
 }
 setSyncing(false);
 };

 // ---- Agent form submit (create or update) ----
 const handleFormSubmit = async (formData, selectedAgent) => {
 const name = (formData.full_name || '').trim();
 const isActive = (formData.status || 'active') === 'active';

 if (selectedAgent) {
 const [firstName, ...rest] = name.split(' ');
 const lastName = rest.join(' ').trim();
 const normalizedPhone = (formData.phone || '').replace(/\D/g, '');
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

 queryClient.invalidateQueries({ queryKey: ['agents'] });
 };

 // ---- MKTR Leads invite / edit (writes to the source app, then mirrors) ----
 const handleMktrLeadsSubmit = async (formData, agent) => {
 if (agent?.mktrLeadsId) {
 await apiClient.patch(`/mktr-leads/agents/${encodeURIComponent(agent.mktrLeadsId)}`, {
 full_name: (formData.full_name || '').trim(),
 email: (formData.email || '').trim() || null,
 agency: (formData.agency || '').trim() || null,
 });
 toast.success('Agent updated in MKTR Leads');
 } else {
 await apiClient.post('/mktr-leads/agents/invite', {
 phone: formData.phone,
 full_name: (formData.full_name || '').trim() || null,
 email: (formData.email || '').trim() || null,
 agency: (formData.agency || '').trim() || null,
 });
 toast.success(
 'Invitation created — they sign into the MKTR Leads app with this number via OTP, then appear here within ~10 minutes',
 { duration: 8000 },
 );
 }
 queryClient.invalidateQueries({ queryKey: ['agents'] });
 };

 // ---- Delete single agent ----
 const handleDeleteAgent = (agent) => {
 if (!agent) return;
 openConfirm({
 title: 'Delete Agent',
 description: `Permanently delete ${agent.fullName || agent.email}? This cannot be undone.`,
 onConfirm: async () => {
 try {
 await apiClient.delete(`/users/${agent.id}/permanent`);
 queryClient.invalidateQueries({ queryKey: ['agents'] });
 toast.success('Agent deleted successfully');
 } catch (error) {
 console.error('Error deleting agent:', error);
 toast.error(error?.message || 'Failed to delete agent');
 }
 closeConfirm();
 },
 });
 };

 // ---- Bulk delete ----
 const handleBulkDelete = (selectedAgentIds, clearSelection) => {
 if (selectedAgentIds.length === 0) return;
 openConfirm({
 title: 'Delete Selected Agents',
 description: `Are you sure you want to permanently delete ${selectedAgentIds.length} agents? This cannot be undone.`,
 onConfirm: async () => {
 try {
 await apiClient.post('/users/bulk-delete', { ids: selectedAgentIds });
 toast.success(`${selectedAgentIds.length} agents deleted successfully`);
 clearSelection();
 queryClient.invalidateQueries({ queryKey: ['agents'] });
 } catch (error) {
 console.error('Error deleting agents:', error);
 toast.error(error?.message || 'Failed to delete agents');
 }
 closeConfirm();
 },
 });
 };

 // ---- Toggle active/inactive (source-aware) ----
 const handleToggleStatus = async (agent) => {
 if (!agent) return;

 // Lyfe-owned rows are read-only here (the menu disables this, but guard anyway).
 if (isLyfeAgent(agent)) {
 toast.error('This agent is managed in the Lyfe app');
 return;
 }

 // MKTR-Leads-owned: write back to the source app. Deactivation also locks
 // them out of the MKTR Leads app (the OTP gate), so confirm with the real
 // effect spelled out.
 if (isMktrLeadsAgent(agent)) {
 const deactivating = !!agent.isActive;
 const name = agent.fullName || agent.email || agent.phone || 'this agent';
 openConfirm({
 title: deactivating ? 'Deactivate MKTR Leads Agent' : 'Reactivate MKTR Leads Agent',
 description: deactivating
 ? `Deactivate ${name}? They will no longer be able to sign into the MKTR Leads app and will stop receiving leads. You can reactivate them later.`
 : `Reactivate ${name}? They will regain access to the MKTR Leads app and can receive leads again.`,
 destructive: deactivating,
 confirmText: deactivating ? 'Deactivate' : 'Reactivate',
 onConfirm: async () => {
 try {
 await apiClient.post(
 `/mktr-leads/agents/${encodeURIComponent(agent.mktrLeadsId)}/${deactivating ? 'deactivate' : 'activate'}`,
 );
 toast.success(deactivating ? 'Agent deactivated in MKTR Leads' : 'Agent reactivated in MKTR Leads');
 queryClient.invalidateQueries({ queryKey: ['agents'] });
 } catch (error) {
 console.error('Error toggling MKTR Leads agent:', error);
 toast.error(error?.message || 'Failed to update agent in MKTR Leads');
 }
 closeConfirm();
 },
 });
 return;
 }

 // Legacy local rows keep the original behaviour.
 try {
 await User.update(agent.id, { isActive: !agent.isActive });
 queryClient.invalidateQueries({ queryKey: ['agents'] });
 } catch (error) {
 console.error('Error toggling agent status:', error);
 }
 };

 // ---- Resend invite ----
 const handleResendInvite = async (agent) => {
 if (!agent?.email) return;
 try {
 const fullName = agent.fullName || `${agent.firstName || ''} ${agent.lastName || ''}`.trim();
 await agentsAPI.invite({ email: agent.email, full_name: fullName });
 toast.success('Invitation email sent');
 } catch (error) {
 console.error('Error resending invite:', error);
 toast.error(error?.message || 'Failed to resend invitation');
 }
 };

 // ---- Approve / Reject ----
 const handleSetApprovalStatus = async (agentId, status) => {
 try {
 await User.setApprovalStatus(agentId, status);
 queryClient.invalidateQueries({ queryKey: ['agents'] });
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
 console.error('Failed to load agent packages', e);
 toast.error('Failed to load assigned packages');
 }
 };

 const handleDeleteAssignment = (assignmentId, agentId) => {
 openConfirm({
 title: 'Remove Package Assignment',
 description: 'Are you sure you want to remove this package assignment? This cannot be undone.',
 onConfirm: async () => {
 try {
 await LeadPackage.deleteAssignment(assignmentId);
 toast.success('Package assignment removed');
 const assignments = await LeadPackage.getAssignments(agentId);
 setPackagesForAgent(assignments || []);
 queryClient.invalidateQueries({ queryKey: ['agents'] });
 } catch (e) {
 console.error('Failed to delete assignment', e);
 toast.error(e.message || 'Failed to delete assignment');
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
 setEditLeadCount('');
 };

 const handleUpdateAssignment = async (assignmentId, agentId) => {
 try {
 const newCount = parseInt(editLeadCount, 10);
 if (isNaN(newCount) || newCount < 0) {
 toast.error('Invalid lead count');
 return;
 }

 await LeadPackage.updateAssignment(assignmentId, {
 leadsRemaining: newCount,
 });

 toast.success('Lead count updated');
 setEditingAssignmentId(null);
 const assignments = await LeadPackage.getAssignments(agentId);
 setPackagesForAgent(assignments || []);
 queryClient.invalidateQueries({ queryKey: ['agents'] });
 } catch (e) {
 console.error('Failed to update assignment', e);
 toast.error(e.message || 'Failed to update assignment');
 }
 };

 const handlePackageSubmit = async (selectedAgent) => {
 try {
 if (selectedAgent) {
 const assignments = await LeadPackage.getAssignments(selectedAgent.id);
 setPackagesForAgent(assignments || []);
 }
 queryClient.invalidateQueries({ queryKey: ['agents'] });
 toast.success('Package assigned successfully');
 } catch (error) {
 console.error('Error refreshing data:', error);
 }
 };

 return {
 // Sync
 syncing,
 lastSyncTime,
 handleSyncFromLyfe,

 // Agent CRUD
 handleFormSubmit,
 handleMktrLeadsSubmit,
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
