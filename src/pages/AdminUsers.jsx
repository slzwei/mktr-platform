import { useState, useMemo } from "react";
import { User } from "@/api/entities";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, UserPlus } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

import UserFilters from "@/components/users/UserFilters";
import UserTable from "@/components/users/UserTable";
import UserGrid from "@/components/users/UserGrid";
import InviteUserDialog from "@/components/users/InviteUserDialog";
import EditUserDialog from "@/components/users/EditUserDialog";
import useUserActions from "@/components/users/useUserActions";
import { filterUsers, exportUsersToCSV } from "@/components/users/userHelpers";

export default function AdminUsers() {
  const { data: usersRaw, isLoading: loading } = useQuery({
    queryKey: ['users', 'list'],
    queryFn: () => User.list()
  });
  const users = Array.isArray(usersRaw) ? usersRaw : (usersRaw?.users || []);

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [lifecycleTab, setLifecycleTab] = useState("all");
  const [viewMode, setViewMode] = useState("list");
  const [pagination, setPagination] = useState({ currentPage: 1, itemsPerPage: 10 });

  const { invite, edit, handleDeleteUser, handleResendInvite, handleApproveUser, confirmDialog: userConfirmDialog, closeConfirm: userCloseConfirm } = useUserActions(users);

  const filteredUsers = useMemo(
    () => filterUsers(users, { searchTerm, roleFilter, statusFilter, lifecycleTab }),
    [users, searchTerm, roleFilter, statusFilter, lifecycleTab]
  );

  const totalPages = Math.ceil(filteredUsers.length / pagination.itemsPerPage);
  const startIndex = (pagination.currentPage - 1) * pagination.itemsPerPage;
  const paginatedUsers = filteredUsers.slice(startIndex, startIndex + pagination.itemsPerPage);

  const handlePageChange = (p) => {
    if (p >= 1 && p <= totalPages) setPagination(prev => ({ ...prev, currentPage: p }));
  };
  const handlePageSizeChange = (val) => setPagination({ itemsPerPage: val, currentPage: 1 });

  const pendingApprovalCount = users.filter(u => u.approvalStatus === 'pending' || u.status === 'pending_approval').length;

  if (loading) {
    return (
      <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50 dark:bg-gray-900/50">
        <div className="max-w-[1600px] mx-auto space-y-6">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-48 animate-pulse" />
          <div className="h-96 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50 dark:bg-gray-900/50">
      <div className="max-w-[1600px] mx-auto space-y-6">

        {/* Page Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">User Management</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Manage system access, approve new users, and update roles.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="bg-white dark:bg-gray-900" onClick={() => exportUsersToCSV(filteredUsers)} disabled={filteredUsers.length === 0}>
              <Download className="w-4 h-4 mr-2" />Export
            </Button>
            <Button onClick={() => invite.setOpen(true)} className="bg-blue-600 hover:bg-blue-700">
              <UserPlus className="w-4 h-4 mr-2" />Invite User
            </Button>
          </div>
        </div>

        {/* Main Content Card */}
        <Card className="border-gray-200/50 dark:border-gray-700/50 shadow-sm bg-white dark:bg-gray-900 overflow-hidden">
          <CardHeader className="border-b border-gray-100 dark:border-gray-700 p-4 lg:p-6 bg-white dark:bg-gray-900 space-y-4">
            <UserFilters
              searchTerm={searchTerm} onSearchChange={setSearchTerm}
              roleFilter={roleFilter} onRoleFilterChange={setRoleFilter}
              lifecycleTab={lifecycleTab} onLifecycleTabChange={setLifecycleTab}
              viewMode={viewMode} onViewModeChange={setViewMode}
              pagination={pagination} onPageSizeChange={handlePageSizeChange}
              pendingApprovalCount={pendingApprovalCount}
            />
          </CardHeader>
          <CardContent className="p-0">
            {viewMode === 'list' ? (
              <UserTable
                users={paginatedUsers} pagination={pagination} totalPages={totalPages}
                onPageChange={handlePageChange} onEditUser={edit.openFor}
                onDeleteUser={handleDeleteUser} onApproveUser={handleApproveUser}
                onResendInvite={handleResendInvite}
              />
            ) : (
              <UserGrid
                users={paginatedUsers} pagination={pagination} totalPages={totalPages}
                onPageChange={handlePageChange} onEditUser={edit.openFor}
                onDeleteUser={handleDeleteUser}
              />
            )}
          </CardContent>
        </Card>

        <InviteUserDialog
          open={invite.open} onOpenChange={invite.setOpen}
          inviteData={invite.data} onInviteDataChange={invite.setData}
          onSubmit={invite.onSubmit} loading={invite.loading}
        />
        <EditUserDialog
          open={edit.open} onOpenChange={edit.setOpen}
          editData={edit.data} onEditDataChange={edit.setData}
          onSubmit={edit.onSubmit} loading={edit.loading}
        />

        <ConfirmDialog
          open={userConfirmDialog.open}
          onOpenChange={(open) => { if (!open) userCloseConfirm(); }}
          title={userConfirmDialog.title}
          description={userConfirmDialog.description}
          onConfirm={userConfirmDialog.onConfirm}
          confirmText={userConfirmDialog.destructive ? "Delete" : "OK"}
          destructive={userConfirmDialog.destructive}
        />
      </div>
    </div>
  );
}
