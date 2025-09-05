import { useEffect, useMemo, useState } from "react";
import { User } from "@/api/entities";
import { apiClient, auth, agents as agentsAPI } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import {
  Plus,
  Eye,
  Edit,
  Search,
  Mail,
  Phone,
  UserRound,
  ChevronUp,
  ChevronDown
} from "lucide-react";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue
} from "@/components/ui/select";
import { format } from "date-fns";

export default function AdminUsers() {
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [sortBy, setSortBy] = useState("createdAt");
  const [order, setOrder] = useState("DESC");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  // Invite form state
  const [invite, setInvite] = useState({ email: "", full_name: "", role: "agent" });

  useEffect(() => {
    load();
  }, []);

  // Auto-load when role/status/sort/order change
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, status, sortBy, order]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => { load(); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const load = async () => {
    setLoading(true);
    try {
      const current = await auth.getCurrentUser(true);
      if (!current || current.role !== 'admin') throw new Error('Insufficient permissions');
      setMe(current);

      const resp = await apiClient.get('/users', normalizeQuery({ 
        role: role === 'all' ? undefined : role, 
        status: status === 'all' ? undefined : status, 
        search: search || undefined,
        sortBy,
        order,
        page: 1,
        limit: 100
      }));
      setUsers(resp?.data?.users || []);
    } catch (e) {
      console.error('Failed to load users', e);
    }
    setLoading(false);
  };

  const normalizeQuery = (obj) => Object.fromEntries(Object.entries(obj).filter(([,v]) => v !== undefined && v !== null && v !== ''));

  const handleToggleSort = (field) => {
    if (sortBy === field) {
      setOrder(order === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(field);
      setOrder('ASC');
    }
  };

  const sortedUsers = useMemo(() => {
    // Server already sorts; this is a fallback if needed
    const copy = [...users];
    const dir = order === 'ASC' ? 1 : -1;
    copy.sort((a,b) => {
      const av = (a?.[sortBy] ?? '').toString().toLowerCase();
      const bv = (b?.[sortBy] ?? '').toString().toLowerCase();
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return copy;
  }, [users, sortBy, order]);

  const statusBadge = (u) => {
    const pendingApproval = u.approvalStatus === 'pending' || u.status === 'pending_approval';
    const pendingRegistration = (u?.isActive === true) && (
      u?.status === 'pending_registration' || !!u?.invitationToken || u?.emailVerified === false
    );
    const isActive = u.isActive && !pendingApproval && !pendingRegistration;
    const cls = pendingApproval
      ? 'bg-yellow-100 text-yellow-800'
      : (isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800');
    const label = pendingApproval
      ? 'Pending Approval'
      : (pendingRegistration ? 'Pending Registration' : (isActive ? 'Active' : 'Inactive'));
    return <Badge className={cls}>{label}</Badge>;
  };

  const openDetails = (u) => { setSelectedUser(u); setDetailsOpen(true); };

  const approve = async (u, decision) => {
    try { await User.setApprovalStatus(u.id, decision); await load(); } catch(e) { console.error(e); }
  };

  const resendInvite = async (u) => {
    try {
      const fullName = u.fullName || `${u.firstName || ''} ${u.lastName || ''}`.trim();
      if (u.role === 'agent') {
        await agentsAPI.invite({ email: u.email, full_name: fullName, owed_leads_count: u.owed_leads_count || 0 });
      } else {
        await User.invite({ email: u.email, full_name: fullName, role: u.role, owed_leads_count: u.owed_leads_count || 0 });
      }
      alert('Invitation email sent');
    } catch (e) {
      alert(e?.message || 'Failed to resend invitation');
    }
  };

  const handleInvite = async (e) => {
    e?.preventDefault?.();
    try {
      if (!invite.email || !invite.full_name) throw new Error('Email and full name are required');
      if (invite.role === 'agent') {
        await agentsAPI.invite({ email: invite.email, full_name: invite.full_name, owed_leads_count: 0 });
      } else {
        await User.invite(invite);
      }
      setInviteOpen(false);
      setInvite({ email: '', full_name: '', role: 'agent' });
      await load();
    } catch (err) {
      alert(err?.message || 'Failed to send invitation');
    }
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-64"></div>
          <div className="h-96 bg-gray-200 rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (!me || me.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-gray-50">
        <UserRound className="w-16 h-16 text-yellow-500 mb-4" />
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Access Denied</h2>
        <p className="text-gray-600">You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Admin - Users</h1>
            <p className="text-gray-600 mt-1">View, filter, and manage all users.</p>
          </div>
          <Button onClick={() => setInviteOpen(true)} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-5 h-5 mr-2" />
            Invite User
          </Button>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="border-b border-gray-100">
            <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <Input
                  placeholder="Search users..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="w-full lg:w-48">
                <Select value={role} onValueChange={(v) => { setRole(v); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="fleet_owner">Fleet Owner</SelectItem>
                    <SelectItem value="driver_partner">Driver</SelectItem>
                    <SelectItem value="customer">Customer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full lg:w-48">
                <Select value={status} onValueChange={(v) => { setStatus(v); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="cursor-pointer" onClick={() => handleToggleSort('fullName')}>
                      User {sortBy === 'fullName' ? (order === 'ASC' ? <ChevronUp className="inline w-4 h-4"/> : <ChevronDown className="inline w-4 h-4"/>) : null}
                    </TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleToggleSort('role')}>
                      Role {sortBy === 'role' ? (order === 'ASC' ? <ChevronUp className="inline w-4 h-4"/> : <ChevronDown className="inline w-4 h-4"/>) : null}
                    </TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleToggleSort('approvalStatus')}>
                      Status {sortBy === 'approvalStatus' ? (order === 'ASC' ? <ChevronUp className="inline w-4 h-4"/> : <ChevronDown className="inline w-4 h-4"/>) : null}
                    </TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleToggleSort('createdAt')}>
                      Joined {sortBy === 'createdAt' ? (order === 'ASC' ? <ChevronUp className="inline w-4 h-4"/> : <ChevronDown className="inline w-4 h-4"/>) : null}
                    </TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedUsers.map((u) => (
                    <TableRow key={u.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openDetails(u)}>
                      <TableCell>
                        <div>
                          <p className="font-semibold text-gray-900">{u.fullName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email}</p>
                          <p className="text-xs text-gray-500">ID: {u.id.slice(-8)}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">{u.role?.replace('_',' ') || '-'}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1 text-sm">
                          <div className="flex items-center gap-1 text-gray-600">
                            <Mail className="w-3 h-3" />
                            {u.email}
                          </div>
                          {u.phone && (
                            <div className="flex items-center gap-1 text-gray-500">
                              <Phone className="w-3 h-3" />
                              {u.phone}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{statusBadge(u)}</TableCell>
                      <TableCell>
                        <span className="text-sm text-gray-600">{u.createdAt ? format(new Date(u.createdAt), 'dd/MM/yyyy') : '-'}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {(u.approvalStatus === 'pending' || u.status === 'pending_approval') && (
                            <>
                              <Button variant="ghost" size="sm" className="text-green-700 hover:text-green-900" onClick={(e) => { e.stopPropagation(); approve(u, 'approved'); }}>Approve</Button>
                              <Button variant="ghost" size="sm" className="text-red-700 hover:text-red-900" onClick={(e) => { e.stopPropagation(); approve(u, 'rejected'); }}>Reject</Button>
                            </>
                          )}
                          {(u.status === 'pending_registration' || !!u.invitationToken || u.emailVerified === false) && (
                            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); resendInvite(u); }}>Resend Invite</Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openDetails(u); }}><Eye className="w-4 h-4"/></Button>
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedUser(u); }}><Edit className="w-4 h-4"/></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {sortedUsers.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                    <Search className="w-6 h-6 text-gray-400" />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">No users found</h3>
                  <p className="text-gray-500">Try adjusting filters or invite a new user</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Invite dialog */}
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Invite User</DialogTitle>
              <DialogDescription>Send an invitation email to let the user complete registration.</DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={handleInvite}>
              <div>
                <label className="text-sm text-gray-600">Full name</label>
                <Input value={invite.full_name} onChange={(e) => setInvite({ ...invite, full_name: e.target.value })} placeholder="Jane Doe" />
              </div>
              <div>
                <label className="text-sm text-gray-600">Email</label>
                <Input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="jane@example.com" />
              </div>
              <div>
                <label className="text-sm text-gray-600">Role</label>
                <Select value={invite.role} onValueChange={(v) => setInvite({ ...invite, role: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="fleet_owner">Fleet Owner</SelectItem>
                    <SelectItem value="driver_partner">Driver</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700">Send Invite</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Details dialog */}
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>User Details</DialogTitle>
            </DialogHeader>
            {selectedUser ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-semibold">
                    {(selectedUser.fullName || selectedUser.email)?.charAt(0)?.toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">{selectedUser.fullName || `${selectedUser.firstName || ''} ${selectedUser.lastName || ''}`.trim() || selectedUser.email}</div>
                    <div className="text-xs text-gray-500">{selectedUser.role}</div>
                  </div>
                </div>
                <div className="text-sm text-gray-700">
                  <div className="flex items-center gap-2"><Mail className="w-4 h-4" /> {selectedUser.email}</div>
                  {selectedUser.phone && <div className="flex items-center gap-2"><Phone className="w-4 h-4" /> {selectedUser.phone}</div>}
                </div>
                <div className="pt-2">
                  {statusBadge(selectedUser)}
                </div>
                <div className="pt-2 text-sm text-gray-600">
                  <div>Joined: {selectedUser.createdAt ? format(new Date(selectedUser.createdAt), 'dd/MM/yyyy') : '-'}</div>
                  <div>Approval: {selectedUser.approvalStatus || 'approved'}</div>
                  {selectedUser.owed_leads_count !== undefined && (
                    <div>Leads owed: {selectedUser.owed_leads_count}</div>
                  )}
                </div>
                <div className="flex gap-2 pt-2">
                  {(selectedUser.approvalStatus === 'pending' || selectedUser.status === 'pending_approval') && (
                    <>
                      <Button variant="ghost" size="sm" className="text-green-700 hover:text-green-900" onClick={() => approve(selectedUser, 'approved')}>Approve</Button>
                      <Button variant="ghost" size="sm" className="text-red-700 hover:text-red-900" onClick={() => approve(selectedUser, 'rejected')}>Reject</Button>
                    </>
                  )}
                  {(selectedUser.status === 'pending_registration' || !!selectedUser.invitationToken || selectedUser.emailVerified === false) && (
                    <Button variant="ghost" size="sm" onClick={() => resendInvite(selectedUser)}>Resend Invite</Button>
                  )}
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

