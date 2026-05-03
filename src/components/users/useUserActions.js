import { useState, useCallback } from"react";
import { auth } from"@/api/client";
import { User } from"@/api/entities";
import { useQueryClient } from"@tanstack/react-query";

export default function useUserActions(users) {
 const queryClient = useQueryClient();
 const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

 // Confirm dialog state (rendered by consumer component)
 const [confirmDialog, setConfirmDialog] = useState({ open: false, title:"", description:"", onConfirm: null, destructive: false });

 const openConfirm = useCallback(({ title, description, onConfirm, destructive = true }) => {
 setConfirmDialog({ open: true, title, description, onConfirm, destructive });
 }, []);

 const closeConfirm = useCallback(() => {
 setConfirmDialog(prev => ({ ...prev, open: false }));
 }, []);

 // Invite dialog
 const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
 const [inviteLoading, setInviteLoading] = useState(false);
 const [inviteData, setInviteData] = useState({ email:"", role:"user", fullName:""});

 const handleInviteUser = async (e) => {
 e.preventDefault();
 setInviteLoading(true);
 try {
 await auth.inviteUser(inviteData.email, inviteData.role, inviteData.fullName);
 setInviteDialogOpen(false);
 setInviteData({ email:"", role:"user", fullName:""});
 invalidate();
 } catch (error) {
 console.error('Error inviting user:', error);
 openConfirm({ title:"Error", description: 'Failed to invite user: ' + (error.message || 'Unknown error'), onConfirm: closeConfirm, destructive: false });
 } finally {
 setInviteLoading(false);
 }
 };

 // Edit dialog
 const [editDialogOpen, setEditDialogOpen] = useState(false);
 const [editLoading, setEditLoading] = useState(false);
 const [selectedUser, setSelectedUser] = useState(null);
 const [editData, setEditData] = useState({ firstName:"", lastName:"", email:"", role:"", status:""});

 const openEditDialog = (user) => {
 if (user.firstName === 'System' && user.lastName === 'Agent') return;
 setSelectedUser(user);
 setEditData({
 firstName: user.firstName ||"",
 lastName: user.lastName ||"",
 email: user.email ||"",
 role: user.role ||"user",
 status: user.isActive ?"active":"inactive" });
 setEditDialogOpen(true);
 };

 const handleEditUser = async (e) => {
 e.preventDefault();
 if (!selectedUser) return;
 setEditLoading(true);
 try {
 await User.update(selectedUser.id, {
 firstName: editData.firstName,
 lastName: editData.lastName,
 role: editData.role,
 isActive: editData.status === 'active'
 });
 setEditDialogOpen(false);
 setSelectedUser(null);
 invalidate();
 } catch (error) {
 console.error('Error updating user:', error);
 openConfirm({ title:"Error", description:"Failed to update user", onConfirm: closeConfirm, destructive: false });
 } finally {
 setEditLoading(false);
 }
 };

 // Delete
 const handleDeleteUser = (userId) => {
 const user = users.find(u => u.id === userId);
 if (user && user.firstName === 'System' && user.lastName === 'Agent') {
 openConfirm({
 title:"Cannot Delete",
 description:"Cannot delete the System Agent.",
 onConfirm: closeConfirm,
 destructive: false,
 });
 return;
 }
 openConfirm({
 title:"Delete User",
 description:"Are you sure you want to PERMANENTLY delete this user? This cannot be undone.",
 onConfirm: async () => {
 try {
 await User.permanentDelete(userId);
 invalidate();
 } catch (error) {
 console.error('Error deleting user:', error);
 }
 closeConfirm();
 },
 });
 };

 // Resend invite
 const handleResendInvite = async (email) => {
 try {
 await auth.resendInvite(email);
 openConfirm({ title:"Success", description:"Invitation resent successfully", onConfirm: closeConfirm, destructive: false });
 } catch (error) {
 console.error('Error resending invite:', error);
 openConfirm({ title:"Error", description:"Failed to resend invite", onConfirm: closeConfirm, destructive: false });
 }
 };

 // Approve
 const handleApproveUser = async (userId) => {
 try {
 await User.setApprovalStatus(userId, 'approved');
 invalidate();
 } catch (error) {
 console.error('Error approving user:', error);
 }
 };

 return {
 invite: {
 open: inviteDialogOpen, setOpen: setInviteDialogOpen,
 data: inviteData, setData: setInviteData,
 loading: inviteLoading, onSubmit: handleInviteUser,
 },
 edit: {
 open: editDialogOpen, setOpen: setEditDialogOpen,
 data: editData, setData: setEditData,
 loading: editLoading, onSubmit: handleEditUser,
 openFor: openEditDialog,
 },
 handleDeleteUser,
 handleResendInvite,
 handleApproveUser,
 confirmDialog,
 closeConfirm,
 };
}
