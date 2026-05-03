import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock dependencies
vi.mock('@/api/entities', () => ({
 User: {
 update: vi.fn(),
 setApprovalStatus: vi.fn(),
 },
 LeadPackage: {
 getAssignments: vi.fn(),
 deleteAssignment: vi.fn(),
 updateAssignment: vi.fn(),
 },
}));

vi.mock('@/api/client', () => ({
 agents: {
 invite: vi.fn(),
 },
 apiClient: {
 post: vi.fn(),
 delete: vi.fn(),
 },
}));

vi.mock('sonner', () => ({
 toast: {
 success: vi.fn(),
 error: vi.fn(),
 },
}));

import useAgentActions from '../useAgentActions';
import { User, LeadPackage } from '@/api/entities';
import { agents as agentsAPI, apiClient } from '@/api/client';
import { toast } from 'sonner';

describe('useAgentActions', () => {
 let queryClient;

 beforeEach(() => {
 vi.clearAllMocks();
 localStorage.clear();
 queryClient = {
 invalidateQueries: vi.fn(),
 };
 });

 // --- handleSyncFromLyfe ---

 it('handleSyncFromLyfe success: shows toast and invalidates queries', async () => {
 apiClient.post.mockResolvedValue({
 data: { created: 2, updated: 1, deactivated: 0, skipped: 3 },
 });

 const { result } = renderHook(() => useAgentActions({ queryClient }));

 await act(async () => {
 await result.current.handleSyncFromLyfe();
 });

 expect(apiClient.post).toHaveBeenCalledWith('/lyfe/agents/sync');
 expect(toast.success).toHaveBeenCalledWith('2 added, 1 updated, 3 unchanged');
 expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['agents'] });
 expect(result.current.syncing).toBe(false);
 expect(result.current.lastSyncTime).toBeTruthy();
 });

 it('handleSyncFromLyfe error: shows error toast', async () => {
 apiClient.post.mockRejectedValue(new Error('Network error'));

 const { result } = renderHook(() => useAgentActions({ queryClient }));

 await act(async () => {
 await result.current.handleSyncFromLyfe();
 });

 expect(toast.error).toHaveBeenCalledWith('Network error');
 expect(result.current.syncing).toBe(false);
 });

 // --- handleFormSubmit ---

 it('handleFormSubmit creates a new agent when no selectedAgent', async () => {
 agentsAPI.invite.mockResolvedValue({ success: true });

 const { result } = renderHook(() => useAgentActions({ queryClient }));

 await act(async () => {
 await result.current.handleFormSubmit(
 { email: 'new@test.com', full_name: 'Jane Doe' },
 null
 );
 });

 expect(agentsAPI.invite).toHaveBeenCalledWith({
 email: 'new@test.com',
 full_name: 'Jane Doe',
 });
 expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['agents'] });
 });

 it('handleFormSubmit updates existing agent when selectedAgent provided', async () => {
 User.update.mockResolvedValue({ success: true });

 const { result } = renderHook(() => useAgentActions({ queryClient }));

 await act(async () => {
 await result.current.handleFormSubmit(
 { full_name: 'John Smith', email: 'john@test.com', phone: '91234567', status: 'active' },
 { id: 'agent-1' }
 );
 });

 expect(User.update).toHaveBeenCalledWith('agent-1', {
 firstName: 'John',
 lastName: 'Smith',
 email: 'john@test.com',
 phone: '91234567',
 dateOfBirth: undefined,
 isActive: true,
 });
 expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['agents'] });
 });

 // --- handleDeleteAgent ---

 it('handleDeleteAgent opens confirm dialog then deletes on confirm', async () => {
 apiClient.delete.mockResolvedValue({ success: true });

 const { result } = renderHook(() => useAgentActions({ queryClient }));

 act(() => {
 result.current.handleDeleteAgent({ id: 'a-1', fullName: 'Test Agent', email: 'test@test.com' });
 });

 expect(result.current.confirmDialog.open).toBe(true);
 expect(result.current.confirmDialog.title).toBe('Delete Agent');

 // Execute the confirm callback
 await act(async () => {
 await result.current.confirmDialog.onConfirm();
 });

 expect(apiClient.delete).toHaveBeenCalledWith('/users/a-1/permanent');
 expect(toast.success).toHaveBeenCalledWith('Agent deleted successfully');
 expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['agents'] });
 });

 it('handleDeleteAgent does nothing if agent is null', () => {
 const { result } = renderHook(() => useAgentActions({ queryClient }));

 act(() => {
 result.current.handleDeleteAgent(null);
 });

 expect(result.current.confirmDialog.open).toBe(false);
 });

 // --- handleBulkDelete ---

 it('handleBulkDelete deletes multiple agents and clears selection', async () => {
 apiClient.post.mockResolvedValue({ success: true });
 const clearSelection = vi.fn();

 const { result } = renderHook(() => useAgentActions({ queryClient }));

 act(() => {
 result.current.handleBulkDelete(['a-1', 'a-2'], clearSelection);
 });

 expect(result.current.confirmDialog.open).toBe(true);

 await act(async () => {
 await result.current.confirmDialog.onConfirm();
 });

 expect(apiClient.post).toHaveBeenCalledWith('/users/bulk-delete', { ids: ['a-1', 'a-2'] });
 expect(clearSelection).toHaveBeenCalled();
 expect(toast.success).toHaveBeenCalledWith('2 agents deleted successfully');
 });

 it('handleBulkDelete does nothing for empty selection', () => {
 const { result } = renderHook(() => useAgentActions({ queryClient }));

 act(() => {
 result.current.handleBulkDelete([], vi.fn());
 });

 expect(result.current.confirmDialog.open).toBe(false);
 });

 // --- handleToggleStatus ---

 it('handleToggleStatus toggles agent isActive and invalidates', async () => {
 User.update.mockResolvedValue({ success: true });

 const { result } = renderHook(() => useAgentActions({ queryClient }));

 await act(async () => {
 await result.current.handleToggleStatus({ id: 'a-1', isActive: true });
 });

 expect(User.update).toHaveBeenCalledWith('a-1', { isActive: false });
 expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['agents'] });
 });

 it('handleToggleStatus does nothing if agent is null', async () => {
 const { result } = renderHook(() => useAgentActions({ queryClient }));

 await act(async () => {
 await result.current.handleToggleStatus(null);
 });

 expect(User.update).not.toHaveBeenCalled();
 });

 // --- handleResendInvite ---

 it('handleResendInvite sends invitation and shows toast', async () => {
 agentsAPI.invite.mockResolvedValue({ success: true });

 const { result } = renderHook(() => useAgentActions({ queryClient }));

 await act(async () => {
 await result.current.handleResendInvite({ email: 'agent@test.com', fullName: 'Test Agent' });
 });

 expect(agentsAPI.invite).toHaveBeenCalledWith({
 email: 'agent@test.com',
 full_name: 'Test Agent',
 });
 expect(toast.success).toHaveBeenCalledWith('Invitation email sent');
 });

 it('handleResendInvite does nothing if agent has no email', async () => {
 const { result } = renderHook(() => useAgentActions({ queryClient }));

 await act(async () => {
 await result.current.handleResendInvite({});
 });

 expect(agentsAPI.invite).not.toHaveBeenCalled();
 });

 // --- handleSetApprovalStatus ---

 it('handleSetApprovalStatus calls User.setApprovalStatus and invalidates', async () => {
 User.setApprovalStatus.mockResolvedValue({ success: true });

 const { result } = renderHook(() => useAgentActions({ queryClient }));

 await act(async () => {
 await result.current.handleSetApprovalStatus('a-1', 'approved');
 });

 expect(User.setApprovalStatus).toHaveBeenCalledWith('a-1', 'approved');
 expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['agents'] });
 });

 // --- Package management ---

 it('openManagePackagesDialog loads assignments and opens dialog', async () => {
 const mockAssignments = [{ id: 'pa-1', leadsRemaining: 5 }];
 LeadPackage.getAssignments.mockResolvedValue(mockAssignments);

 const { result } = renderHook(() => useAgentActions({ queryClient }));

 await act(async () => {
 await result.current.openManagePackagesDialog({ id: 'a-1' });
 });

 expect(LeadPackage.getAssignments).toHaveBeenCalledWith('a-1');
 expect(result.current.packagesForAgent).toEqual(mockAssignments);
 expect(result.current.managePackagesDialogOpen).toBe(true);
 });

 it('handleStartEdit sets editing state', () => {
 const { result } = renderHook(() => useAgentActions({ queryClient }));

 act(() => {
 result.current.handleStartEdit({ id: 'pa-1', leadsRemaining: 10 });
 });

 expect(result.current.editingAssignmentId).toBe('pa-1');
 expect(result.current.editLeadCount).toBe('10');
 });

 it('handleCancelEdit clears editing state', () => {
 const { result } = renderHook(() => useAgentActions({ queryClient }));

 act(() => {
 result.current.handleStartEdit({ id: 'pa-1', leadsRemaining: 10 });
 });

 act(() => {
 result.current.handleCancelEdit();
 });

 expect(result.current.editingAssignmentId).toBeNull();
 expect(result.current.editLeadCount).toBe('');
 });
});
