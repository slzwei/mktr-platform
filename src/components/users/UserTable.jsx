import React from"react";
import { Button } from"@/components/ui/button";
import { Badge } from"@/components/ui/badge";
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow
} from"@/components/ui/table";
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuLabel,
 DropdownMenuSeparator,
 DropdownMenuTrigger,
} from"@/components/ui/dropdown-menu";
import {
 Search,
 Trash2,
 Mail,
 Edit,
 CheckCircle,
 MoreHorizontal,
 ChevronLeft,
 ChevronRight,
} from"lucide-react";
import { format } from"date-fns";
import { getUserStatus, statusStyles } from"./userHelpers";

export default function UserTable({
 users,
 pagination,
 totalPages,
 onPageChange,
 onEditUser,
 onDeleteUser,
 onApproveUser,
 onResendInvite,
}) {
 return (
 <>
 <div className="overflow-x-auto">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-border text-xs uppercase tracking-wider">
 <TableHead className="py-3 px-6 font-medium text-muted-foreground">User</TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground">Role</TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground">Status</TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground">Joined</TableHead>
 <TableHead className="py-3 px-6 font-medium text-muted-foreground w-[100px] text-right">Actions</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {users.length === 0 ? (
 <TableRow>
 <TableCell colSpan={5} className="h-64 text-center">
 <div className="flex flex-col items-center justify-center text-muted-foreground">
 <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-3">
 <Search className="w-6 h-6 text-muted-foreground"/>
 </div>
 <p className="font-medium text-foreground">No users found</p>
 <p className="text-sm mt-1">Try adjusting your filters or search terms</p>
 </div>
 </TableCell>
 </TableRow>
 ) : (
 users.map(user => (
 <UserRow
 key={user.id}
 user={user}
 onEditUser={onEditUser}
 onDeleteUser={onDeleteUser}
 onApproveUser={onApproveUser}
 onResendInvite={onResendInvite}
 />
 ))
 )}
 </TableBody>
 </Table>
 </div>

 {/* Pagination Footer */}
 {totalPages > 1 && (
 <div className="border-t border-border bg-muted/50 p-4 flex items-center justify-between">
 <span className="text-sm text-muted-foreground hidden sm:inline">
 Page {pagination.currentPage} of {totalPages}
 </span>
 <div className="flex items-center gap-2 w-full sm:w-auto justify-center">
 <Button
 variant="outline" size="sm" onClick={() => onPageChange(pagination.currentPage - 1)}
 disabled={pagination.currentPage === 1}
 className="h-8 shadow-sm bg-card" >
 <ChevronLeft className="w-4 h-4 mr-1"/> Previous
 </Button>
 <Button
 variant="outline" size="sm" onClick={() => onPageChange(pagination.currentPage + 1)}
 disabled={pagination.currentPage === totalPages}
 className="h-8 shadow-sm bg-card" >
 Next <ChevronRight className="w-4 h-4 ml-1"/>
 </Button>
 </div>
 </div>
 )}
 </>
 );
}

const UserRow = React.memo(function UserRow({ user, onEditUser, onDeleteUser, onApproveUser, onResendInvite }) {
 const { statusKey, statusLabel } = getUserStatus(user);
 const isSystemAgent = user.firstName === 'System' && user.lastName === 'Agent';

 return (
 <TableRow className="hover:bg-muted/50 border-border transition-colors">
 <TableCell className="px-6 py-4">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold uppercase ring-2 ring-white dark:ring-border shadow-sm flex-shrink-0">
 {(user.firstName?.[0] || user.email?.[0] || '?')}
 </div>
 <div className="min-w-0 flex-1">
 <div className="font-medium text-foreground" title={user.firstName ? `${user.firstName} ${user.lastName || ''}` : user.email}>
 {user.firstName ? `${user.firstName} ${user.lastName || ''}` : user.email}
 </div>
 <div className="text-xs text-muted-foreground font-normal break-all" title={user.email}>{user.email}</div>
 </div>
 </div>
 </TableCell>
 <TableCell className="px-6 py-4">
 <Badge variant="outline" className="capitalize font-medium border-border text-foreground px-2.5 py-0.5 bg-muted">
 {user.role}
 </Badge>
 </TableCell>
 <TableCell className="px-6 py-4">
 <Badge variant="outline" className={`font-normal ${statusStyles[statusKey]}`}>
 {statusLabel}
 </Badge>
 </TableCell>
 <TableCell className="px-6 py-4 text-sm text-muted-foreground">
 {user.createdAt ? format(new Date(user.createdAt), 'MMM d, yyyy') : '-'}
 {user.createdAt && <div className="text-xs text-muted-foreground mt-0.5">{format(new Date(user.createdAt), 'h:mm a')}</div>}
 </TableCell>
 <TableCell className="px-6 py-4 text-right">
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-muted-foreground dark:hover:text-muted-foreground">
 <MoreHorizontal className="h-4 w-4"/>
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuLabel>Actions</DropdownMenuLabel>
 <DropdownMenuItem onClick={() => onEditUser(user)}>
 <Edit className="mr-2 h-4 w-4"/> Edit Details
 </DropdownMenuItem>
 {(user.approvalStatus === 'pending' || user.status === 'pending_approval') && (
 <DropdownMenuItem onClick={() => onApproveUser(user.id)} className="text-success focus:text-success dark:focus:text-success focus:bg-success/10">
 <CheckCircle className="mr-2 h-4 w-4"/> Approve User
 </DropdownMenuItem>
 )}
 {(!user.isActive && (user.invitationPending || user.invitationToken || user.status === 'pending_registration')) && (
 <DropdownMenuItem onClick={() => onResendInvite(user.email)}>
 <Mail className="mr-2 h-4 w-4"/> Resend Invite
 </DropdownMenuItem>
 )}
 <DropdownMenuSeparator />
 <DropdownMenuItem
 onClick={() => onDeleteUser(user.id)}
 className="text-destructive focus:text-destructive dark:focus:text-destructive focus:bg-destructive/10" disabled={isSystemAgent}
 >
 <Trash2 className="mr-2 h-4 w-4"/> Delete User
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </TableCell>
 </TableRow>
 );
});
