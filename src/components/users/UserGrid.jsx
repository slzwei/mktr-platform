import React from"react";
import { Button } from"@/components/ui/button";
import { Badge } from"@/components/ui/badge";
import { Card, CardContent, CardHeader } from"@/components/ui/card";
import {
 Search,
 Trash2,
 Edit,
 ChevronLeft,
 ChevronRight,
} from"lucide-react";
import { getUserStatus, statusStyles } from"./userHelpers";

export default function UserGrid({
 users,
 pagination,
 totalPages,
 onPageChange,
 onEditUser,
 onDeleteUser,
}) {
 return (
 <>
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
 {users.length === 0 ? (
 <div className="col-span-full h-64 flex flex-col items-center justify-center text-muted-foreground">
 <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-3">
 <Search className="w-6 h-6 text-muted-foreground"/>
 </div>
 <p className="font-medium text-foreground">No users found</p>
 </div>
 ) : (
 users.map(user => (
 <UserCard
 key={user.id}
 user={user}
 onEditUser={onEditUser}
 onDeleteUser={onDeleteUser}
 />
 ))
 )}
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

const UserCard = React.memo(function UserCard({ user, onEditUser, onDeleteUser }) {
 const { statusKey, statusLabel } = getUserStatus(user, true);
 const isSystemAgent = user.firstName === 'System' && user.lastName === 'Agent';

 return (
 <Card className="shadow-sm hover:shadow-md transition-shadow border-border overflow-hidden group">
 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 bg-muted/30">
 <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold uppercase text-sm ring-1 ring-ring dark:ring-ring">
 {(user.firstName?.[0] || user.email?.[0] || '?')}
 </div>
 <Badge variant="outline" className={`${statusStyles[statusKey]} font-normal`}>
 {statusLabel}
 </Badge>
 </CardHeader>
 <CardContent className="pt-4">
 <div className="text-lg font-semibold truncate text-foreground" title={user.email}>
 {user.firstName ? `${user.firstName} ${user.lastName || ''}` : user.email}
 </div>
 <div className="text-xs text-muted-foreground mb-4 truncate">{user.email}</div>

 <div className="flex items-center justify-between text-sm mt-4 pt-4 border-t border-border">
 <Badge variant="secondary" className="font-medium capitalize bg-muted text-muted-foreground">
 {user.role}
 </Badge>
 <div className="flex gap-1">
 <Button variant="ghost" size="icon" aria-label={`Edit ${user.firstName || user.email}`} onClick={() => onEditUser(user)} className="h-8 w-8 text-muted-foreground hover:text-primary">
 <Edit className="h-4 w-4" aria-hidden="true" />
 </Button>
 <Button
 variant="ghost" size="icon" aria-label={`Delete ${user.firstName || user.email}`} onClick={() => onDeleteUser(user.id)}
 className="h-8 w-8 text-muted-foreground hover:text-destructive dark:hover:text-destructive" disabled={isSystemAgent}
 >
 <Trash2 className="h-4 w-4" aria-hidden="true" />
 </Button>
 </div>
 </div>
 </CardContent>
 </Card>
 );
});
