import { useState, useEffect } from "react";
import { auth, apiClient } from "@/api/client";
import { User } from "@/api/entities";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Download,
  Trash2,
  Mail,
  UserPlus,
  Edit,
  CheckCircle,
  MoreHorizontal,
  LayoutGrid,
  List as ListIcon
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";

export default function AdminUsers() {
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [lifecycleTab, setLifecycleTab] = useState("all");
  const [viewMode, setViewMode] = useState("list"); // 'list' or 'grid'

  // Dialog states
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteData, setInviteData] = useState({ email: "", role: "user", fullName: "" });

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [editData, setEditData] = useState({ firstName: "", lastName: "", email: "", role: "", status: "" });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [userData, usersData] = await Promise.all([
        auth.getCurrentUser(),
        User.list()
      ]);

      if (userData.role !== 'admin') {
        throw new Error('Unauthorized');
      }

      setCurrentUser(userData);
      // Ensure usersData is an array
      setUsers(Array.isArray(usersData) ? usersData : (usersData.users || []));
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInviteUser = async (e) => {
    e.preventDefault();
    setInviteLoading(true);
    try {
      await auth.inviteUser(inviteData.email, inviteData.role, inviteData.fullName);
      setInviteDialogOpen(false);
      setInviteData({ email: "", role: "user", fullName: "" });
      await loadData();
    } catch (error) {
      console.error('Error inviting user:', error);
      alert('Failed to invite user: ' + (error.message || 'Unknown error'));
    } finally {
      setInviteLoading(false);
    }
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
      await loadData();
    } catch (error) {
      console.error('Error updating user:', error);
      alert('Failed to update user');
    } finally {
      setEditLoading(false);
    }
  };

  const openEditDialog = (user) => {
    setSelectedUser(user);
    setEditData({
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email || "",
      role: user.role || "user",
      status: user.isActive ? "active" : "inactive"
    });
    setEditDialogOpen(true);
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm("Are you sure you want to delete this user? This cannot be undone.")) return;
    try {
      await User.delete(userId);
      await loadData();
    } catch (error) {
      console.error('Error deleting user:', error);
      alert('Failed to delete user');
    }
  };

  const handleResendInvite = async (email) => {
    try {
      await auth.resendInvite(email);
      alert("Invitation resent successfully");
    } catch (error) {
      console.error('Error resending invite:', error);
      alert('Failed to resend invite');
    }
  };

  const handleApproveUser = async (userId) => {
    try {
      await User.setApprovalStatus(userId, 'approved');
      await loadData();
    } catch (error) {
      console.error('Error approving user:', error);
    }
  };

  const exportToCSV = () => {
    const headers = ['Name', 'Email', 'Role', 'Status', 'Joined Date'];
    const csvData = filteredUsers.map(u => [
      `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
      u.email,
      u.role,
      u.isActive ? 'Active' : 'Inactive',
      u.createdAt ? format(new Date(u.createdAt), 'dd/MM/yyyy') : ''
    ]);

    const csvContent = [headers, ...csvData]
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `users_${format(new Date(), 'ddMMyyyy')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtering Logic
  const filteredUsers = users.filter(user => {
    const matchesSearch = (
      (user.firstName?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
      (user.lastName?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
      (user.email?.toLowerCase() || "").includes(searchTerm.toLowerCase())
    );
    const matchesRole = roleFilter === "all" || user.role === roleFilter;

    // Status filter logic
    let matchesStatus = true;
    if (statusFilter !== "all") {
      if (statusFilter === "active") matchesStatus = user.isActive;
      else if (statusFilter === "inactive") matchesStatus = !user.isActive;
    }

    // Lifecycle tab logic
    let matchesLifecycle = true;
    if (lifecycleTab === "pending_approval") {
      matchesLifecycle = user.approvalStatus === 'pending' || user.status === 'pending_approval';
    } else if (lifecycleTab === "pending_registration") {
      matchesLifecycle =
        user.status === 'pending_registration' ||
        !!user.invitationToken ||
        (user.isActive && !user.passwordHash && !user.googleId);
    } else if (lifecycleTab === "active") {
      matchesLifecycle = user.isActive && user.approvalStatus !== 'pending';
    } else if (lifecycleTab === "inactive") {
      matchesLifecycle = !user.isActive;
    }

    return matchesSearch && matchesRole && matchesStatus && matchesLifecycle;
  });

  if (loading) {
    return (
      <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50">
        <div className="max-w-[1600px] mx-auto space-y-6">
          <div className="h-8 bg-gray-200 rounded w-48 animate-pulse"></div>
          <div className="h-96 bg-gray-200 rounded-xl animate-pulse"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50">
      <div className="max-w-[1600px] mx-auto space-y-6">

        {/* Page Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">User Management</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage system access and user roles.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="bg-white"
              onClick={exportToCSV}
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            <Button onClick={() => setInviteDialogOpen(true)} className="bg-blue-600 hover:bg-blue-700">
              <UserPlus className="w-4 h-4 mr-2" />
              Invite User
            </Button>
          </div>
        </div>

        {/* Filters & Tabs */}
        <div className="flex flex-col gap-4">
          {/* Lifecycle Tabs */}
          <Tabs value={lifecycleTab} onValueChange={setLifecycleTab} className="w-full">
            <TabsList className="bg-white border border-gray-200/50 p-1 h-auto flex-wrap">
              <TabsTrigger value="all" className="data-[state=active]:bg-gray-100 data-[state=active]:text-gray-900">All Users</TabsTrigger>
              <TabsTrigger value="pending_approval" className="data-[state=active]:bg-amber-50 data-[state=active]:text-amber-700">
                Pending Approval
                {users.filter(u => u.approvalStatus === 'pending' || u.status === 'pending_approval').length > 0 && (
                  <span className="ml-2 bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">
                    {users.filter(u => u.approvalStatus === 'pending' || u.status === 'pending_approval').length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="pending_registration" className="data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700">Pending Registration</TabsTrigger>
              <TabsTrigger value="active" className="data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-700">Active</TabsTrigger>
              <TabsTrigger value="inactive" className="data-[state=active]:bg-gray-100 data-[state=active]:text-gray-600">Inactive</TabsTrigger>
            </TabsList>
          </Tabs>

          <Card className="border-gray-200/50 shadow-sm bg-white overflow-hidden">
            <CardHeader className="border-b border-gray-100 p-4 lg:p-6 bg-white">
              <div className="flex flex-col lg:flex-row gap-4 justify-between">
                <div className="flex flex-col sm:flex-row gap-2 flex-1">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <Input
                      placeholder="Search users..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9 h-9 bg-gray-50/50 border-gray-200 focus:bg-white"
                    />
                  </div>
                  <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="w-[140px] h-9">
                      <SelectValue placeholder="All Roles" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="agent">Agent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* View Toggle */}
                <div className="flex items-center border rounded-md p-1 bg-gray-50/50">
                  <Button
                    variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => setViewMode('list')}
                  >
                    <ListIcon className="w-4 h-4" />
                  </Button>
                  <Button
                    variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => setViewMode('grid')}
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {viewMode === 'list' ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50/50 hover:bg-gray-50/50 border-gray-100">
                        <TableHead className="py-3 px-6 font-medium text-gray-500">User</TableHead>
                        <TableHead className="py-3 px-6 font-medium text-gray-500">Role</TableHead>
                        <TableHead className="py-3 px-6 font-medium text-gray-500">Status</TableHead>
                        <TableHead className="py-3 px-6 font-medium text-gray-500">Joined</TableHead>
                        <TableHead className="py-3 px-6 font-medium text-gray-500 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="h-48 text-center text-gray-500">
                            No users found matching your criteria.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredUsers.map(user => (
                          <TableRow key={user.id} className="hover:bg-gray-50/50 border-gray-100">
                            <TableCell className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-medium uppercase text-xs">
                                  {(user.firstName?.[0] || user.email?.[0] || '?')}
                                </div>
                                <div>
                                  <div className="font-medium text-gray-900">
                                    {user.firstName ? `${user.firstName} ${user.lastName || ''}` : user.email}
                                  </div>
                                  {user.firstName && <div className="text-xs text-gray-500">{user.email}</div>}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="px-6 py-4">
                              <Badge variant="outline" className="capitalize font-normal border-gray-200 text-gray-600 px-2 py-0.5">
                                {user.role}
                              </Badge>
                            </TableCell>
                            <TableCell className="px-6 py-4">
                              {user.approvalStatus === 'pending' || user.status === 'pending_approval' ? (
                                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Pending Approval</Badge>
                              ) : (
                                user.isActive ?
                                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Active</Badge> :
                                  <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-200">Inactive</Badge>
                              )}
                            </TableCell>
                            <TableCell className="px-6 py-4 text-gray-500 text-sm">
                              {user.createdAt ? format(new Date(user.createdAt), 'MMM d, yyyy') : '-'}
                            </TableCell>
                            <TableCell className="px-6 py-4 text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" className="h-8 w-8 p-0">
                                    <MoreHorizontal className="h-4 w-4 text-gray-500" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                  <DropdownMenuItem onClick={() => openEditDialog(user)}>
                                    <Edit className="mr-2 h-4 w-4" /> Edit Details
                                  </DropdownMenuItem>
                                  {(user.approvalStatus === 'pending' || user.status === 'pending_approval') && (
                                    <DropdownMenuItem onClick={() => handleApproveUser(user.id)} className="text-green-600">
                                      <CheckCircle className="mr-2 h-4 w-4" /> Approve User
                                    </DropdownMenuItem>
                                  )}
                                  {(!user.isActive && (user.invitationToken || user.status === 'pending_registration')) && (
                                    <DropdownMenuItem onClick={() => handleResendInvite(user.email)}>
                                      <Mail className="mr-2 h-4 w-4" /> Resend Invite
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => handleDeleteUser(user.id)} className="text-red-600">
                                    <Trash2 className="mr-2 h-4 w-4" /> Delete User
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
                  {filteredUsers.map(user => (
                    <Card key={user.id} className="shadow-sm hover:shadow-md transition-shadow border-gray-200/50">
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold uppercase text-sm">
                          {(user.firstName?.[0] || user.email?.[0] || '?')}
                        </div>
                        {(user.approvalStatus === 'pending' || user.status === 'pending_approval') ? (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Pending</Badge>
                        ) : (
                          <Badge variant="outline" className={user.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-gray-100 text-gray-600 border-gray-200"}>
                            {user.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        )}
                      </CardHeader>
                      <CardContent>
                        <div className="text-lg font-semibold truncate text-gray-900" title={user.email}>
                          {user.firstName ? `${user.firstName} ${user.lastName || ''}` : user.email}
                        </div>
                        <div className="text-sm text-gray-500 mb-4 truncate">{user.email}</div>

                        <div className="flex items-center justify-between text-sm">
                          <Badge variant="secondary" className="font-normal capitalize bg-gray-100 text-gray-600 hover:bg-gray-200">{user.role}</Badge>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEditDialog(user)} className="h-8 w-8 text-gray-500 hover:text-blue-600">
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDeleteUser(user.id)} className="h-8 w-8 text-gray-500 hover:text-red-600">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Invite User Dialog */}
        <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite New User</DialogTitle>
              <DialogDescription>
                Send an invitation to a new user to join the platform.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleInviteUser}>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="fullName" className="text-right">Name</Label>
                  <Input
                    id="fullName"
                    value={inviteData.fullName}
                    onChange={(e) => setInviteData({ ...inviteData, fullName: e.target.value })}
                    className="col-span-3"
                    placeholder="John Doe"
                    required
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="email" className="text-right">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={inviteData.email}
                    onChange={(e) => setInviteData({ ...inviteData, email: e.target.value })}
                    className="col-span-3"
                    placeholder="john@example.com"
                    required
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="role" className="text-right">Role</Label>
                  <Select
                    value={inviteData.role}
                    onValueChange={(val) => setInviteData({ ...inviteData, role: val })}
                  >
                    <SelectTrigger className="col-span-3">
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="agent">Agent</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setInviteDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={inviteLoading}>
                  {inviteLoading ? "Sending..." : "Send Invitation"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Edit User Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit User</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleEditUser}>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="edit-firstname">First Name</Label>
                    <Input
                      id="edit-firstname"
                      value={editData.firstName}
                      onChange={(e) => setEditData({ ...editData, firstName: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-lastname">Last Name</Label>
                    <Input
                      id="edit-lastname"
                      value={editData.lastName}
                      onChange={(e) => setEditData({ ...editData, lastName: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="edit-email">Email</Label>
                  <Input
                    id="edit-email"
                    value={editData.email}
                    disabled
                    className="bg-gray-50 text-gray-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="edit-role">Role</Label>
                    <Select
                      value={editData.role}
                      onValueChange={(val) => setEditData({ ...editData, role: val })}
                    >
                      <SelectTrigger id="edit-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="agent">Agent</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="edit-status">Status</Label>
                    <Select
                      value={editData.status}
                      onValueChange={(val) => setEditData({ ...editData, status: val })}
                    >
                      <SelectTrigger id="edit-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={editLoading}>
                  {editLoading ? 'Saving...' : 'Save Changes'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

      </div>
    </div>
  );
}
