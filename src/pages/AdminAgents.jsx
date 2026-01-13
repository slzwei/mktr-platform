import { useState, useEffect } from "react";
import { User, Campaign } from "@/api/entities";
import { auth, agents as agentsAPI, apiClient } from "@/api/client";
import { LeadPackage } from "@/api/entities";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";

import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue
} from "@/components/ui/select";


import {
  Plus,
  Edit,
  Eye,
  Search,
  Phone,
  Mail,
  Package,
  Trash2,
  MoreHorizontal,
  CheckCircle,
  XCircle,
  ShieldAlert,
  UserCheck
} from "lucide-react";
import { format } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import AgentFormDialog from "../components/agents/AgentFormDialog";
import AgentDetailsDialog from "../components/agents/AgentDetailsDialog";

import AssignPackageDialog from "../components/agents/AssignPackageDialog";

export default function AdminAgents() {
  const [user, setUser] = useState(null);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgentIds, setSelectedAgentIds] = useState([]); // [1] Add selection state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isPackageDialogOpen, setIsPackageDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState('all');
  const [managePackagesDialogOpen, setManagePackagesDialogOpen] = useState(false);
  const [packagesForAgent, setPackagesForAgent] = useState([]);

  const { toast } = useToast();
  const [editingAssignmentId, setEditingAssignmentId] = useState(null);
  const [editLeadCount, setEditLeadCount] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const userData = await auth.getCurrentUser(true);
      if (!userData || userData.role !== 'admin') {
        throw new Error('Insufficient permissions');
      }
      const agentsData = await agentsAPI.getAll();

      setUser(userData);
      setAgents(agentsData?.agents || []);
    } catch (error) {
      console.error('Error loading agents:', error);
    }
    setLoading(false);
  };

  const handleOpenForm = (agent = null) => {
    setSelectedAgent(agent);
    setIsFormOpen(true);
  };

  const handleFormSubmit = async (formData) => {
    try {
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
          isActive
        });
      } else {
        const normalizedPhone = (formData.phone || '').replace(/\D/g, '');
        await agentsAPI.invite({
          email: formData.email,
          full_name: name,
          phone: normalizedPhone
        });
      }

      await loadData();
      setIsFormOpen(false);
      setSelectedAgent(null);
    } catch (error) {
      console.error('Error saving agent:', error);
      throw error;
    }
  };

  const handleOpenDetails = (agent) => {
    setSelectedAgent(agent);
    setIsDetailsOpen(true);
  };

  const openManagePackagesDialog = async (agent) => {
    if (!agent) return;
    setSelectedAgent(agent);
    try {
      const assignments = await LeadPackage.getAssignments(agent.id);
      setPackagesForAgent(assignments || []);
      setManagePackagesDialogOpen(true);
    } catch (e) {
      console.error('Failed to load agent packages', e);
      toast({ variant: "destructive", title: "Error", description: "Failed to load assigned packages" });
    }
  };

  const handleDeleteAssignment = async (assignmentId) => {
    if (!confirm('Are you sure you want to remove this package assignment? This cannot be undone.')) return;

    try {
      await LeadPackage.deleteAssignment(assignmentId);
      toast({ title: "Success", description: "Package assignment removed" });
      // Refresh list
      const assignments = await LeadPackage.getAssignments(selectedAgent.id);
      setPackagesForAgent(assignments || []);
      // Also refresh main list to update owed leads count
      await loadData();
    } catch (e) {
      console.error('Failed to delete assignment', e);
      toast({ variant: "destructive", title: "Error", description: e.message || "Failed to delete assignment" });
    }
  };

  const handleStartEdit = (assignment) => {
    setEditingAssignmentId(assignment.id);
    setEditLeadCount(String(assignment.leadsRemaining));
  };

  const handleCancelEdit = () => {
    setEditingAssignmentId(null);
    setEditLeadCount("");
  };

  const handleUpdateAssignment = async (assignmentId) => {
    try {
      const newCount = parseInt(editLeadCount, 10);
      if (isNaN(newCount) || newCount < 0) {
        toast({ variant: "destructive", title: "Error", description: "Invalid lead count" });
        return;
      }

      await LeadPackage.updateAssignment(assignmentId, { leadsRemaining: newCount });

      toast({ title: "Success", description: "Lead count updated" });
      setEditingAssignmentId(null);
      // Refresh list
      const assignments = await LeadPackage.getAssignments(selectedAgent.id);
      setPackagesForAgent(assignments || []);
      // Also refresh main list to update owed leads count
      await loadData();
    } catch (e) {
      console.error('Failed to update assignment', e);
      toast({ variant: "destructive", title: "Error", description: e.message || "Failed to update assignment" });
    }
  };

  // Bulk Delete Handler
  const handleBulkDelete = async () => {
    if (selectedAgentIds.length === 0) return;

    if (!confirm(`Are you sure you want to permanently delete ${selectedAgentIds.length} agents? This cannot be undone.`)) return;

    try {
      await apiClient.post('/users/bulk-delete', { ids: selectedAgentIds });
      toast({ title: "Success", description: `${selectedAgentIds.length} agents deleted successfully` });
      setSelectedAgentIds([]); // Clear selection
      await loadData();
    } catch (error) {
      console.error('Error deleting agents:', error);
      toast({ variant: "destructive", title: "Error", description: error?.message || "Failed to delete agents" });
    }
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      const allIds = filteredAgents.map(a => a.id);
      setSelectedAgentIds(allIds);
    } else {
      setSelectedAgentIds([]);
    }
  };

  const handleSelectAgent = (agentId, checked) => {
    if (checked) {
      setSelectedAgentIds(prev => [...prev, agentId]);
    } else {
      setSelectedAgentIds(prev => prev.filter(id => id !== agentId));
    }
  };


  const handleDeleteAgent = async (agent) => {
    if (!agent) return;

    const message = `Permanently delete ${agent.fullName || agent.email}? This cannot be undone.`;

    if (!window.confirm(message)) return;

    try {
      await apiClient.delete(`/users/${agent.id}/permanent`);
      await loadData();
      toast({ title: "Success", description: "Agent deleted successfully" });
    } catch (error) {
      console.error('Error deleting agent:', error);
      toast({ variant: "destructive", title: "Error", description: error?.message || "Failed to delete agent" });
    }
  };

  const handleToggleStatus = async (agent) => {
    if (!agent) return;
    try {
      await User.update(agent.id, { isActive: !agent.isActive });
      await loadData();
    } catch (error) {
      console.error('Error toggling agent status:', error);
    }
  };

  const handleResendInvite = async (agent) => {
    if (!agent?.email) return;
    try {
      const fullName = agent.fullName || `${agent.firstName || ''} ${agent.lastName || ''}`.trim();
      await agentsAPI.invite({ email: agent.email, full_name: fullName });
      alert('Invitation email sent');
    } catch (error) {
      console.error('Error resending invite:', error);
      alert(error?.message || 'Failed to resend invitation');
    }
  };

  const handleOpenPackageDialog = (agent) => {
    setSelectedAgent(agent);
    setIsPackageDialogOpen(true);
  };

  const handlePackageSubmit = async () => {
    try {
      if (selectedAgent) {
        // Refresh the assignments list for the "Manage Packages" dialog if it's open or about to be viewed
        const assignments = await LeadPackage.getAssignments(selectedAgent.id);
        setPackagesForAgent(assignments || []);
      }

      await loadData();
      setIsPackageDialogOpen(false);
      // Do NOT clear selectedAgent here, as we might be in the Manage Packages flow which relies on it
      // if managePackagesDialogOpen is true, we keep it. Otherwise we can clear it? 
      // Actually, if we are in "Manage Packages", we want to stay there.
      // If we came from the main "Assign Package" button, we might want to clear it.
      // But clearing it breaks the "Manage Packages" dialog refetch if meaningful.
      // The safest bet to support the user request "Packages assigned... should update immediately"
      // implies the "Manage Packages" dialog is OPEN or we return to it.

      // If we are NOT in the manage packages dialog, we can clear selected agent?
      if (!managePackagesDialogOpen) {
        setSelectedAgent(null);
      }

      toast({ title: "Success", description: "Package assigned successfully" });
    } catch (error) {
      console.error('Error refreshing data:', error);
    }
  };

  const filteredAgents = agents.filter(agent => {
    const needle = (searchTerm || '').toLowerCase();
    const name = (agent.fullName || agent.full_name || '').toLowerCase();
    const matchesSearch = (
      name.includes(needle) ||
      agent.email?.toLowerCase().includes(needle) ||
      agent.phone?.includes(searchTerm)
    );

    let matchesStatus = true;
    if (statusFilter !== 'all') {
      const isPending = agent?.isActive === true && (
        agent?.status === 'pending_registration' ||
        !!agent?.invitationToken ||
        agent?.emailVerified === false
      );
      if (statusFilter === 'pending') matchesStatus = isPending;
      else if (statusFilter === 'active') matchesStatus = agent.isActive && !isPending;
      else if (statusFilter === 'inactive') matchesStatus = !agent.isActive;
    }
    return matchesSearch && matchesStatus;
  });

  const isPending = (agent) => (
    agent?.isActive === true && (
      agent?.status === 'pending_registration' ||
      !!agent?.invitationToken ||
      agent?.emailVerified === false
    )
  );

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

  if (user?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
        <p className="text-gray-500">You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50">
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Agents</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage your sales agents and their performance.
            </p>
          </div>
          <Button onClick={() => handleOpenForm()} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-5 h-5 mr-2" />
            Invite Agent
          </Button>
        </div>

        <Card className="border-gray-200/50 shadow-sm bg-white overflow-hidden">
          <CardHeader className="border-b border-gray-100 p-4 lg:p-6 bg-white">
            <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center">
              <div className="relative flex-1 w-full lg:max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search agents..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 h-9 bg-gray-50/50 border-gray-200 focus:bg-white"
                />
              </div>
              <div className="w-full lg:w-[180px]">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 bg-white">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="pending">Pending Registration</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>

          {/* Bulk Action Bar */}
          {selectedAgentIds.length > 0 && (
            <div className="bg-blue-50 border-b border-blue-100 p-3 flex items-center justify-between animate-in slide-in-from-top-2">
              <span className="text-sm text-blue-800 font-medium ml-2">
                {selectedAgentIds.length} agents selected
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
                className="bg-red-600 hover:bg-red-700 h-8"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Selected
              </Button>
            </div>
          )}

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50/50 hover:bg-gray-50/50 border-gray-100">
                    <TableHead className="w-12 h-12 px-4 text-center">
                      <Checkbox
                        checked={filteredAgents.length > 0 && selectedAgentIds.length === filteredAgents.length}
                        onCheckedChange={handleSelectAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead className="py-3 px-6 font-medium text-gray-500">Agent</TableHead>
                    <TableHead className="py-3 px-6 font-medium text-gray-500">Contact</TableHead>
                    <TableHead className="py-3 px-6 font-medium text-gray-500">Status</TableHead>
                    <TableHead className="py-3 px-6 font-medium text-gray-500">Leads Owed</TableHead>
                    <TableHead className="py-3 px-6 font-medium text-gray-500">Joined</TableHead>
                    <TableHead className="py-3 px-6 font-medium text-gray-500 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAgents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-48 text-center text-gray-500">
                        No agents found matching your criteria.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAgents.map((agent) => <TableRow key={agent.id} className={`hover:bg-gray-50/50 border-gray-100 ${selectedAgentIds.includes(agent.id) ? 'bg-blue-50/30' : ''}`}>
                      <TableCell className="px-4 text-center">
                        <Checkbox
                          checked={selectedAgentIds.includes(agent.id)}
                          onCheckedChange={(checked) => handleSelectAgent(agent.id, checked)}
                          aria-label={`Select ${agent.fullName}`}
                        />
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-medium uppercase text-xs">
                            {(agent.fullName?.[0] || agent.email?.[0] || '?')}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{agent.fullName || `${agent.firstName || ''} ${agent.lastName || ''}`.trim()}</p>
                            <p className="text-xs text-gray-500">ID: {agent.id.slice(-8)}</p>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell className="px-6 py-4 max-w-[250px]">
                        <div className="space-y-1 text-sm">
                          <div className="flex items-start gap-1.5 text-gray-600 break-all">
                            <Mail className="w-3 h-3 text-gray-400 shrink-0 mt-0.5" />
                            <span className="leading-tight">{agent.email}</span>
                          </div>
                          {agent.phone && (
                            <div className="flex items-center gap-1.5 text-gray-500">
                              <Phone className="w-3 h-3 text-gray-400 shrink-0" />
                              {agent.phone}
                            </div>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="px-6 py-4">
                        {(() => {
                          const pendingApproval = agent.approvalStatus === 'pending' || agent.status === 'pending_approval';
                          const pendingRegistration = isPending(agent);
                          const isActive = agent.isActive && !pendingApproval && !pendingRegistration;

                          if (pendingApproval) return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50">Pending Approval</Badge>;
                          if (pendingRegistration) return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50">Invited</Badge>;
                          if (isActive) return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50">Active</Badge>;
                          return <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100">Inactive</Badge>;
                        })()}
                      </TableCell>

                      <TableCell className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="font-mono bg-gray-100 text-gray-700 border-gray-200">{agent.owed_leads_count || 0}</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            onClick={() => handleOpenPackageDialog(agent)}
                          >
                            <Plus className="w-3 h-3 mr-1" /> Assign Package
                          </Button>
                        </div>
                      </TableCell>

                      <TableCell className="px-6 py-4 text-sm text-gray-500">
                        {agent.createdAt ? format(new Date(agent.createdAt), 'MMM d, yyyy') : (agent.created_date ? format(new Date(agent.created_date), 'MMM d, yyyy') : '-')}
                      </TableCell>

                      <TableCell className="px-6 py-4 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0 text-gray-500 hover:text-gray-900">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuLabel>Manage Agent</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => handleOpenDetails(agent)}>
                              <Eye className="mr-2 h-4 w-4" /> View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleOpenForm(agent)}>
                              <Edit className="mr-2 h-4 w-4" /> Edit Profile
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => openManagePackagesDialog(agent)}>
                              <Package className="mr-2 h-4 w-4" /> Manage Packages
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleOpenPackageDialog(agent)}>
                              <Package className="mr-2 h-4 w-4" /> Assign Lead Package
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {(agent.approvalStatus === 'pending' || agent.status === 'pending_approval') && (
                              <>
                                <DropdownMenuItem onClick={async () => { try { await User.setApprovalStatus(agent.id, 'approved'); await loadData(); } catch (e) { console.error(e); } }} className="text-emerald-600">
                                  <CheckCircle className="mr-2 h-4 w-4" /> Approve
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={async () => { try { await User.setApprovalStatus(agent.id, 'rejected'); await loadData(); } catch (e) { console.error(e); } }} className="text-red-600">
                                  <XCircle className="mr-2 h-4 w-4" /> Reject
                                </DropdownMenuItem>
                              </>
                            )}
                            {isPending(agent) ? (
                              <DropdownMenuItem onClick={() => handleResendInvite(agent)}>
                                <Mail className="mr-2 h-4 w-4" /> Resend Invite
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => handleToggleStatus(agent)}>
                                {agent.isActive ? (
                                  <><ShieldAlert className="mr-2 h-4 w-4" /> Deactivate</>
                                ) : (
                                  <><CheckCircle className="mr-2 h-4 w-4" /> Activate</>
                                )}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleDeleteAgent(agent)} className="text-red-600">
                              <Trash2 className="mr-2 h-4 w-4" /> Delete Agent
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    )
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <AgentFormDialog
          open={isFormOpen}
          onOpenChange={setIsFormOpen}
          agent={selectedAgent}
          onSubmit={handleFormSubmit}
        />

        <AgentDetailsDialog
          open={isDetailsOpen}
          onOpenChange={setIsDetailsOpen}
          agent={selectedAgent}
        />

        <AssignPackageDialog
          open={isPackageDialogOpen}
          onOpenChange={setIsPackageDialogOpen}
          agent={selectedAgent}
          onSubmitSuccess={handlePackageSubmit}
        />

        {/* Manage Packages Dialog */}
        <Dialog open={managePackagesDialogOpen} onOpenChange={setManagePackagesDialogOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <DialogTitle>Packages assigned to {selectedAgent?.fullName || selectedAgent?.email}</DialogTitle>
                  <DialogDescription>View active lead package assignments.</DialogDescription>
                </div>
                <Button onClick={() => handleOpenPackageDialog(selectedAgent)} className="bg-blue-600 hover:bg-blue-700">
                  <Plus className="w-4 h-4 mr-2" />
                  Assign Package
                </Button>
              </div>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto divide-y">
              {packagesForAgent.length === 0 ? (
                <div className="text-sm text-gray-500 p-8 text-center bg-gray-50 rounded-lg border border-dashed border-gray-200">
                  No packages assigned yet.
                </div>
              ) : packagesForAgent.map(assignment => (
                <div key={assignment.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900">{assignment.package?.name || 'Unknown Package'}</p>
                        <Badge variant="outline" className={`
                          ${assignment.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ''}
                          ${assignment.status === 'exhausted' ? 'bg-gray-100 text-gray-600 border-gray-200' : ''}
                          ${assignment.status === 'expired' ? 'bg-amber-50 text-amber-700 border-amber-200' : ''}
                        `}>
                          {assignment.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        Campaign: {assignment.package?.campaign?.name || 'N/A'}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        <span>Purchased: {assignment.purchaseDate ? format(new Date(assignment.purchaseDate), 'MMM d, yyyy') : '-'}</span>
                        <span>Price: ${assignment.priceSnapshot}</span>
                      </div>
                    </div>
                    {editingAssignmentId === assignment.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <Input
                          type="number"
                          className="h-8 w-20 text-right"
                          value={editLeadCount}
                          onChange={(e) => setEditLeadCount(e.target.value)}
                          min="0"
                        />
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                            onClick={() => handleUpdateAssignment(assignment.id)}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                            onClick={handleCancelEdit}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-right group relative">
                        <p className="text-sm font-medium text-gray-900 flex items-center justify-end gap-2">
                          {assignment.leadsRemaining} / {assignment.leadsTotal}
                          <Edit
                            className="w-3 h-3 text-gray-400 cursor-pointer opacity-0 group-hover:opacity-100 hover:text-blue-600 transition-opacity"
                            onClick={() => handleStartEdit(assignment)}
                          />
                        </p>
                        <p className="text-xs text-gray-500">leads remaining</p>
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-gray-400 hover:text-red-600 hover:bg-red-50"
                      onClick={() => handleDeleteAssignment(assignment.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {/* Assign Campaigns Dialog */}

      </div>
    </div >
  );
}
