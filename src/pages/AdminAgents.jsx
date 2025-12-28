
import { useState, useEffect } from "react";
import { User, Campaign } from "@/api/entities";
import { auth, agents as agentsAPI, apiClient } from "@/api/client";
import { LeadPackage } from "@/api/entities"; // Assuming LeadPackage entity exists
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
  AlertTriangle,
  Phone,
  Mail,
  Package, // Import Package icon
  Trash2
} from "lucide-react";
import { format } from "date-fns";

import AgentFormDialog from "../components/agents/AgentFormDialog";
import AgentDetailsDialog from "../components/agents/AgentDetailsDialog";
import LeadPackageDialog from "../components/agents/LeadPackageDialog";

export default function AdminAgents() {
  const [user, setUser] = useState(null);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isPackageDialogOpen, setIsPackageDialogOpen] = useState(false); // New state for package dialog
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
      // Always force-refresh from backend to avoid stale cached roles
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
        // Invite new agent via backend invite flow
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
      // Re-throw so the dialog can display the specific backend error message
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
      // Refresh campaigns dialog if it is open
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
        // Soft delete → move to inactive
        await User.delete(agent.id);
      } else if (!agent.isActive) {
        // Already inactive → permanent delete
        await apiClient.delete(`/users/${agent.id}/permanent`);
      } else {
        // Active non-pending → soft delete first
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

  // New function to open lead package dialog
  const handleOpenPackageDialog = (agent) => {
    setSelectedAgent(agent);
    setIsPackageDialogOpen(true);
  };

  // New function to handle lead package submission
  const handlePackageSubmit = async (packageData) => {
    try {
      // Assuming LeadPackage.create exists and is correctly implemented
      await LeadPackage.create(packageData);
      await loadData(); // Refresh agent data after package creation
      setIsPackageDialogOpen(false);
      setSelectedAgent(null);
    } catch (error) {
      console.error('Error creating lead package:', error);
    }
  };

  const filteredAgents = agents.filter(agent => {
    const needle = (searchTerm || '').toLowerCase();
    const name = (agent.fullName || agent.full_name || '').toLowerCase();
    return (
      name.includes(needle) ||
      agent.email?.toLowerCase().includes(needle) ||
      agent.phone?.includes(searchTerm)
    );
  });

  const isPending = (agent) => (
    agent?.isActive === true && (
      agent?.status === 'pending_registration' ||
      !!agent?.invitationToken ||
      agent?.emailVerified === false
    )
  );

  const pendingAgents = filteredAgents.filter(isPending);
  const activeAgents = filteredAgents.filter(a => !isPending(a) && a.isActive);
  const inactiveAgents = filteredAgents.filter(a => !isPending(a) && !a.isActive);

  const sectionMatchesFilter = (section) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'pending') return section === 'pending';
    if (statusFilter === 'active') return section === 'active';
    if (statusFilter === 'inactive') return section === 'inactive';
    return true;
  };

  const renderAgentsTable = (items) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead>Agent</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Leads Owed</TableHead>
            <TableHead>Campaigns</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((agent) => (
            <TableRow key={agent.id} className="hover:bg-gray-50">
              <TableCell>
                <div>
                  <p className="font-semibold text-gray-900">{agent.fullName || `${agent.firstName || ''} ${agent.lastName || ''}`.trim()}</p>
                  <p className="text-sm text-gray-500">Agent ID: {agent.id.slice(-8)}</p>
                </div>
              </TableCell>

              <TableCell>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-1 text-gray-600">
                    <Mail className="w-3 h-3" />
                    {agent.email}
                  </div>
                  {agent.phone && (
                    <div className="flex items-center gap-1 text-gray-500">
                      <Phone className="w-3 h-3" />
                      {agent.phone}
                    </div>
                  )}
                </div>
              </TableCell>

              <TableCell>
                {(() => {
                  const pendingApproval = agent.approvalStatus === 'pending' || agent.status === 'pending_approval';
                  const pendingRegistration = isPending(agent);
                  const isActive = agent.isActive && !pendingApproval && !pendingRegistration;
                  const badgeCls = pendingApproval
                    ? 'bg-yellow-100 text-yellow-800'
                    : (isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800');
                  const label = pendingApproval
                    ? 'Pending Approval'
                    : (pendingRegistration ? 'Pending Registration' : (isActive ? 'Active' : 'Inactive'));
                  return <Badge className={badgeCls}>{label}</Badge>;
                })()}
              </TableCell>

              <TableCell>
                <span className="font-semibold">{agent.owed_leads_count || 0}</span>
              </TableCell>

              <TableCell>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openCampaignsDialog(agent)}
                  >
                    Manage
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openAssignDialog(agent)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    Assign
                  </Button>
                </div>
              </TableCell>

              <TableCell>
                <span className="text-sm text-gray-600">
                  {agent.createdAt ? format(new Date(agent.createdAt), 'dd/MM/yyyy') : (agent.created_date ? format(new Date(agent.created_date), 'dd/MM/yyyy') : '-')}
                </span>
              </TableCell>

              <TableCell>
                <div className="flex items-center gap-2">
                  {(agent.approvalStatus === 'pending' || agent.status === 'pending_approval') && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-green-700 hover:text-green-900"
                        onClick={async () => { try { await User.setApprovalStatus(agent.id, 'approved'); await loadData(); } catch (e) { console.error(e); } }}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-700 hover:text-red-900"
                        onClick={async () => { try { await User.setApprovalStatus(agent.id, 'rejected'); await loadData(); } catch (e) { console.error(e); } }}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenDetails(agent)}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenForm(agent)}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenPackageDialog(agent)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    <Package className="w-4 h-4" />
                  </Button>
                  {isPending(agent) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleResendInvite(agent)}
                      className="text-yellow-700 hover:text-yellow-900"
                    >
                      <Mail className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleStatus(agent)}
                      className={agent.isActive ? 'text-gray-600 hover:text-gray-800' : 'text-green-600 hover:text-green-800'}
                    >
                      {agent.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteAgent(agent)}
                    className="text-red-600 hover:text-red-800"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {items.length === 0 && (
        <div className="text-center py-12">
          <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
            <Search className="w-6 h-6 text-gray-400" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-2">No agents found</h3>
          <p className="text-gray-500">Try adjusting your search or add new agents</p>
        </div>
      )}
    </div>
  );

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

  if (user?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-gray-50">
        <AlertTriangle className="w-16 h-16 text-yellow-500 mb-4" />
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
            <h1 className="text-3xl font-bold text-gray-900">Admin - Agent Management</h1>
            <p className="text-gray-600 mt-1">
              Manage your sales agents and their information.
            </p>
          </div>
          <Button onClick={() => handleOpenForm()} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-5 h-5 mr-2" />
            Invite Agent
          </Button>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="border-b border-gray-100">
            <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <Input
                  placeholder="Search agents..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="w-full lg:w-60">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="pending">Pending registration</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0"></CardContent>
        </Card>

        <div className="space-y-6 mt-6">
          {sectionMatchesFilter('pending') && (
            <Card className="shadow-lg border-l-4 border-yellow-400">
              <CardHeader className="bg-yellow-50">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-yellow-900">Pending Registration</h2>
                  <Badge className="bg-yellow-100 text-yellow-800">{pendingAgents.length} pending</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {renderAgentsTable(pendingAgents)}
              </CardContent>
            </Card>
          )}

          {sectionMatchesFilter('active') && (
            <Card className="shadow-lg border-l-4 border-green-500">
              <CardHeader className="bg-green-50">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-green-900">Active Agents</h2>
                  <Badge className="bg-green-100 text-green-800">{activeAgents.length} active</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {renderAgentsTable(activeAgents)}
              </CardContent>
            </Card>
          )}

          {sectionMatchesFilter('inactive') && (
            <Card className="shadow-lg border-l-4 border-gray-400">
              <CardHeader className="bg-gray-50">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">Inactive Agents</h2>
                  <Badge className="bg-gray-200 text-gray-800">{inactiveAgents.length} inactive</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {renderAgentsTable(inactiveAgents)}
              </CardContent>
            </Card>
          )}
        </div>

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

        {/* New LeadPackageDialog component */}
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
                <div className="text-sm text-gray-600 p-4">No campaigns found.</div>
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
      </div>
    </div>
  );
}
