import { format } from"date-fns";

export const statusStyles = {
 active:"bg-success/10 text-success border-success/30",
 inactive:"bg-muted text-muted-foreground border-border",
 pending:"bg-warning/10 text-warning border-warning/30",
 pending_registration:"bg-primary/10 text-primary border-info/30"};

/**
 * Derive status key and label from a user object.
 * @param {object} user
 * @param {boolean} shortLabels - use shorter labels (for grid cards)
 */
export function getUserStatus(user, shortLabels = false) {
 let statusKey = 'inactive';
 let statusLabel = 'Inactive';

 if (user.approvalStatus === 'pending' || user.status === 'pending_approval') {
 statusKey = 'pending';
 statusLabel = shortLabels ? 'Pending' : 'Pending Approval';
 } else if (user.isActive) {
 statusKey = 'active';
 statusLabel = 'Active';
 } else if (user.status === 'pending_registration' || (!user.isActive && user.invitationToken)) {
 statusKey = 'pending_registration';
 statusLabel = shortLabels ? 'Pending Reg' : 'Pending Reg.';
 }

 return { statusKey, statusLabel };
}

/**
 * Filter users by search, role, status, and lifecycle tab.
 */
export function filterUsers(users, { searchTerm, roleFilter, statusFilter, lifecycleTab }) {
 const term = searchTerm.toLowerCase();
 return users.filter(user => {
 const matchesSearch =
 (user.firstName?.toLowerCase() ||"").includes(term) ||
 (user.lastName?.toLowerCase() ||"").includes(term) ||
 (user.email?.toLowerCase() ||"").includes(term);
 const matchesRole = roleFilter ==="all"|| user.role === roleFilter;

 let matchesStatus = true;
 if (statusFilter !=="all") {
 matchesStatus = statusFilter ==="active"? user.isActive : !user.isActive;
 }

 let matchesLifecycle = true;
 if (lifecycleTab ==="pending_approval") {
 matchesLifecycle = user.approvalStatus === 'pending' || user.status === 'pending_approval';
 } else if (lifecycleTab ==="pending_registration") {
 matchesLifecycle = user.status === 'pending_registration' || !!user.invitationToken || (user.isActive && !user.passwordHash && !user.googleId);
 } else if (lifecycleTab ==="active") {
 matchesLifecycle = user.isActive && user.approvalStatus !== 'pending';
 } else if (lifecycleTab ==="inactive") {
 matchesLifecycle = !user.isActive;
 }

 return matchesSearch && matchesRole && matchesStatus && matchesLifecycle;
 });
}

/**
 * Export users to a CSV file and trigger download.
 */
export function exportUsersToCSV(users) {
 const headers = ['Name', 'Email', 'Role', 'Status', 'Joined Date'];
 const csvData = users.map(u => [
 `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
 u.email, u.role, u.isActive ? 'Active' : 'Inactive',
 u.createdAt ? format(new Date(u.createdAt), 'dd/MM/yyyy') : ''
 ]);
 const csvContent = [headers, ...csvData].map(row => row.map(f => `"${f}"`).join(',')).join('\n');
 const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
 const link = document.createElement('a');
 link.setAttribute('href', URL.createObjectURL(blob));
 link.setAttribute('download', `users_${format(new Date(), 'ddMMyyyy')}.csv`);
 document.body.appendChild(link);
 link.click();
 document.body.removeChild(link);
}
