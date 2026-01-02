import { useState, useEffect } from "react";
import { User, Campaign } from "@/api/entities";
import { auth, agents as agentsAPI, apiClient } from "@/api/client";
import { LeadPackage } from "@/api/entities";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
import LeadPackageDialog from "../components/agents/LeadPackageDialog";

export default function AdminAgents() {
  const [user, setUser] = useState(null);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isPackageDialogOpen, setIsPackageDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState('all');
  const [campaignsDialogOpen, setCampaignsDialogOpen] = useState(false);
  const [campaignsForAgent, setCampaignsForAgent] = useState([]);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const [allCampaigns, setAllCampaigns] = useState([]);
  const [selectedCampaignIds, setSelectedCampaignIds] = useState(new Set());
  const [campaignSearch, setCampaignSearch] = useState("");

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
        const lastName = rest.join(' ').trim() || '-';
        const normalizedPhone = (formData.phone || '').replace(/\D/g, '');
        await User.update(selectedAgent.id, {
          firstName,
          lastName,
          email: formData.email,
          phone: normalizedPhone || undefined,
          dateOfBirth: formData.dateOfBirth || undefined,
          isActive,
          owed_leads_count: parseInt(formData.owed_leads_count) || 0
        });
      } else {
        const normalizedPhone = (formData.phone || '').replace(/\D/g, '');
        await agentsAPI.invite({
          email: formData.email,
          full_name: name,
          phone: normalizedPhone,
          owed_leads_count: parseInt(formData.owed_leads_count) || 0
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

  const openCampaignsDialog = async (agent) => {
    if (!agent) return;
    setSelectedAgent(agent);
    try {
      const resp = await agentsAPI.getCampaigns(agent.id);
      setCampaignsForAgent(resp?.campaigns || []);
      setCampaignsDialogOpen(true);
    } catch (e) {
      console.error('Failed to load agent campaigns', e);
    }
  };

  const openAssignDialog = async (agent) => {
    if (!agent) return;
    setSelectedAgent(agent);
    setAssignLoading(true);
    try {
      const listData = await Campaign.list({ limit: 500 });
      const campaigns = Array.isArray(listData) ? listData : (listData.campaigns || []);
      setAllCampaigns(campaigns);
      const preselected = new Set(
        campaigns
          .filter(c => Array.isArray(c.assigned_agents) && c.assigned_agents.map(String).includes(String(agent.id)))
          .map(c => c.id)
      );
      setSelectedCampaignIds(preselected);
      setAssignDialogOpen(true);
    } catch (e) {
      console.error('Failed to load campaigns for assignment', e);
      alert(e?.message || 'Failed to load campaigns');
    } finally {
      setAssignLoading(false);
    }
  };

  const toggleCampaignSelected = (campaignId) => {
    setSelectedCampaignIds(prev => {
      const next = new Set(prev);
      if (next.has(campaignId)) next.delete(campaignId); else next.add(campaignId);
      return next;
    });
  };

  const handleSaveAssignments = async () => {
    if (!selectedAgent) return;
    setAssignLoading(true);
    try {
      const agentIdStr = String(selectedAgent.id);
      const updates = [];
      for (const c of allCampaigns) {
        const current = Array.isArray(c.assigned_agents) ? c.assigned_agents.map(String) : [];
        const wantSelected = selectedCampaignIds.has(c.id);
        const hasNow = current.includes(agentIdStr);
        if (wantSelected && !hasNow) {
          const nextArr = Array.from(new Set([...current, agentIdStr]));
          updates.push(Campaign.update(c.id, { assigned_agents: nextArr }));
        } else if (!wantSelected && hasNow) {
          const nextArr = current.filter(id => id !== agentIdStr);
          updates.push(Campaign.update(c.id, { assigned_agents: nextArr }));
        }
      }
      if (updates.length > 0) {
        await Promise.all(updates);
      }
      await loadData();
      setAssignDialogOpen(false);
      if (campaignsDialogOpen && selectedAgent) {
        try {
          const resp = await agentsAPI.getCampaigns(selectedAgent.id);
          setCampaignsForAgent(resp?.campaigns || []);
        } catch (_) { }
      }
    } catch (e) {
      console.error('Failed to save assignments', e);
      alert(e?.message || 'Failed to save assignments');
    } finally {
      setAssignLoading(false);
    }
  };

  const handleDeleteAgent = async (agent) => {
    if (!agent) return;
    const isPending = agent?.status === 'pending_registration' || !!agent?.invitationToken || agent?.emailVerified === false;
    const message = isPending
      ? `Move ${agent.fullName || agent.email} to Inactive?`
      : `Permanently delete ${agent.fullName || agent.email}? This cannot be undone.`;
    const confirmed = window.confirm(message);
    if (!confirmed) return;
    try {
      if (isPending) {
        await User.delete(agent.id);
      } else if (!agent.isActive) {
        await apiClient.delete(`/users/${agent.id}/permanent`);
      } else {
        await User.delete(agent.id);
      }
      await loadData();
    } catch (error) {
      console.error('Error deleting agent:', error);
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
      await agentsAPI.invite({ email: agent.email, full_name: fullName, owed_leads_count: agent.owed_leads_count || 0 });
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

  const handlePackageSubmit = async (packageData) => {
    try {
      await LeadPackage.create(packageData);
      await loadData();
      setIsPackageDialogOpen(false);
      setSelectedAgent(null);
    } catch (error) {
      console.error('Error creating lead package:', error);
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

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50/50 hover:bg-gray-50/50 border-gray-100">
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
                      <TableCell colSpan={6} className="h-48 text-center text-gray-500">
                        No agents found matching your criteria.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAgents.map((agent) => (
                      <TableRow key={agent.id} className="hover:bg-gray-50/50 border-gray-100">
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

                        <TableCell className="px-6 py-4">
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center gap-1.5 text-gray-600">
                              <Mail className="w-3 h-3 text-gray-400" />
                              {agent.email}
                            </div>
                            {agent.phone && (
                              <div className="flex items-center gap-1.5 text-gray-500">
                                <Phone className="w-3 h-3 text-gray-400" />
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
                              <Plus className="w-3 h-3 mr-1" /> Add
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
                              <DropdownMenuItem onClick={() => openCampaignsDialog(agent)}>
                                <UserCheck className="mr-2 h-4 w-4" /> Manage Campaigns
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleOpenPackageDialog(agent)}>
                                <Package className="mr-2 h-4 w-4" /> Lead Package
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
                    ))
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

        <LeadPackageDialog
          open={isPackageDialogOpen}
          onOpenChange={setIsPackageDialogOpen}
          agent={selectedAgent}
          onSubmit={handlePackageSubmit}
        />

        {/* Campaigns dialog (consistent UI) */}
        <Dialog open={campaignsDialogOpen} onOpenChange={setCampaignsDialogOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <DialogTitle>Campaigns tied to {selectedAgent?.fullName || selectedAgent?.email}</DialogTitle>
                  <DialogDescription>Click a campaign to manage or view details.</DialogDescription>
                </div>
                <Button onClick={() => openAssignDialog(selectedAgent)} className="bg-blue-600 hover:bg-blue-700">
                  Assign campaigns
                </Button>
              </div>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto divide-y">
              {campaignsForAgent.length === 0 ? (
                <div className="text-sm text-gray-500 p-4 text-center">No campaigns found.</div>
              ) : campaignsForAgent.map(c => (
                <div key={c.id} className="py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{c.name}</p>
                      <p className="text-xs text-gray-500">Status: {c.status} • Leads: {c.stats?.totalProspects ?? 0} • Scans: {c.stats?.totalScans ?? 0}</p>
                    </div>
                    <Link
                      to={createPageUrl(`AdminCampaigns?highlight=${c.id}`)}
                      className="text-blue-600 hover:text-blue-800 text-sm whitespace-nowrap"
                      onClick={() => setCampaignsDialogOpen(false)}
                    >
                      View
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {/* Assign Campaigns Dialog */}
        <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Assign Campaigns</DialogTitle>
              <DialogDescription>
                Select campaigns to assign to {selectedAgent?.fullName || 'this agent'}.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  className="pl-9 bg-white"
                  placeholder="Filter campaigns..."
                  value={campaignSearch}
                  onChange={(e) => setCampaignSearch(e.target.value)}
                />
              </div>
              <div className="border rounded-md max-h-60 overflow-y-auto p-2 space-y-1 bg-gray-50">
                {allCampaigns
                  .filter(c => (c.name || '').toLowerCase().includes(campaignSearch.toLowerCase()))
                  .map(campaign => (
                    <div
                      key={campaign.id}
                      className="flex items-center space-x-3 p-2 hover:bg-white hover:shadow-sm rounded-md cursor-pointer transition-all"
                      onClick={() => toggleCampaignSelected(campaign.id)}
                    >
                      <Checkbox
                        id={`c-${campaign.id}`}
                        checked={selectedCampaignIds.has(campaign.id)}
                        onCheckedChange={() => toggleCampaignSelected(campaign.id)}
                        className="border-gray-300"
                      />
                      <label
                        htmlFor={`c-${campaign.id}`}
                        className="text-sm font-medium leading-none cursor-pointer flex-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {campaign.name}
                        {campaign.status !== 'active' && (
                          <span className="ml-2 text-xs text-gray-500 font-normal">({campaign.status})</span>
                        )}
                      </label>
                    </div>
                  ))}
                {allCampaigns.length === 0 && (
                  <div className="text-center text-sm text-gray-500 py-4">
                    No campaigns available.
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveAssignments} disabled={assignLoading} className="bg-blue-600 hover:bg-blue-700">
                {assignLoading ? 'Saving...' : 'Save Assignments'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
