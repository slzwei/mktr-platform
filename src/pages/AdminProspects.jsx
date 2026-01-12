import { useState, useEffect } from "react";
import { auth } from "@/api/client";
import { Prospect, Campaign } from "@/api/entities";
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
} from "@/components/ui/dialog";
import { useLocation } from "react-router-dom";
import { format } from "date-fns";
import {
  Search,
  Download,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  User
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import ProspectFilters from "@/components/prospects/ProspectFilters";
import ProspectDetails from "@/components/prospects/ProspectDetails";

const statusStyles = {
  new: "bg-blue-50 text-blue-700 border-blue-200",
  contacted: "bg-amber-50 text-amber-700 border-amber-200",
  meeting: "bg-violet-50 text-violet-700 border-violet-200",
  close_won: "bg-emerald-50 text-emerald-700 border-emerald-200",
  close_lost: "bg-rose-50 text-rose-700 border-rose-200",
  rejected: "bg-slate-50 text-slate-700 border-slate-200"
};

const statusLabels = {
  new: "New",
  contacted: "Contacted",
  meeting: "Meeting",
  close_won: "Won",
  close_lost: "Lost",
  rejected: "Rejected"
};

// Normalize backend prospect to UI shape expected by this page
function normalizeProspect(p) {
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || p.name || "";
  const status = (p.leadStatus || p.status || "new").toLowerCase();
  const createdDate = p.createdAt || p.created_date || new Date().toISOString();
  // Map leadSource to simplified UI values used in filters
  const source = (p.leadSource || p.source || "other").toLowerCase();
  let simplifiedSource = "other";
  if (source === "qr_code") simplifiedSource = "qr";
  else if (source === "website") simplifiedSource = "form";

  const assignedAgentId = p.assignedAgentId || p.assigned_agent_id || "";
  const assignedAgentName = p.assignedAgent
    ? ([p.assignedAgent.firstName, p.assignedAgent.lastName].filter(Boolean).join(" ") || p.assignedAgent.email || "Agent")
    : (p.assigned_agent_name || "");

  return {
    id: p.id,
    name,
    phone: p.phone || "",
    email: p.email || "",
    postal_code: p.location?.zipCode || p.postal_code || "",
    date_of_birth: p.dateOfBirth || p.date_of_birth || null,
    status,
    created_date: createdDate,
    source: simplifiedSource,
    assigned_agent_id: assignedAgentId,
    assigned_agent_name: assignedAgentName,
    campaign_id: p.campaignId || p.campaign_id || ""
  };
}

export default function AdminProspects() {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [prospects, setProspects] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProspect, setSelectedProspect] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [filters, setFilters] = useState({
    search: "",
    status: "all",
    campaign: "all",
    source: "all"
  });
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage: 25
  });
  const isMobile = useIsMobile();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const campaignId = params.get('campaign');
    if (campaignId) {
      setFilters(prevFilters => ({ ...prevFilters, campaign: campaignId }));
    }
  }, [location.search]);

  useEffect(() => {
    loadDataWithFilters();
  }, [filters, pagination.currentPage, pagination.itemsPerPage]);

  const loadDataWithFilters = async () => {
    setLoading(true);
    try {
      const params = {
        page: pagination.currentPage,
        limit: pagination.itemsPerPage
      };

      if (filters.search) params.search = filters.search;
      if (filters.status !== "all") params.leadStatus = filters.status;
      if (filters.campaign !== "all") params.campaignId = filters.campaign;
      if (filters.source !== "all") {
        if (filters.source === "qr") params.leadSource = "qr_code";
        else if (filters.source === "form") params.leadSource = "website";
        else params.leadSource = filters.source;
      }

      const [userData, prospectsResponse, allCampaignsData] = await Promise.all([
        user || auth.getCurrentUser(),
        Prospect.list(params),
        campaigns.length > 0 ? Promise.resolve(campaigns) : Campaign.list({ limit: 1000 })
      ]);

      if (!user) setUser(userData);

      const campaignsResponse = Array.isArray(allCampaignsData) ? allCampaignsData : (allCampaignsData.campaigns || []);
      // Keep all campaigns including archived ones for lookups - prospects may reference them
      const campaignsData = campaignsResponse;

      const prospectsData = prospectsResponse.prospects || prospectsResponse || [];
      const paginationData = prospectsResponse.pagination || {
        currentPage: pagination.currentPage,
        totalPages: 1,
        totalItems: prospectsData.length,
        itemsPerPage: pagination.itemsPerPage
      };

      const normalized = (prospectsData || []).map(normalizeProspect);
      setProspects(normalized);
      if (campaignsData.length > 0) setCampaigns(campaignsData);

      setPagination(paginationData);
    } catch (error) {
      console.error('Error loading prospects:', error);
    }
    setLoading(false);
  };

  const handlePageChange = (newPage) => {
    setPagination(prev => ({ ...prev, currentPage: newPage }));
  };

  const handlePageSizeChange = (newSize) => {
    setPagination(prev => ({ ...prev, currentPage: 1, itemsPerPage: newSize }));
  };

  const loadData = async () => loadDataWithFilters();

  const handleStatusUpdate = async (prospectId, newStatus) => {
    try {
      await Prospect.update(prospectId, { leadStatus: newStatus });
      await loadData();
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const handleDeleteProspect = async (prospectId) => {
    try {
      await Prospect.delete(prospectId);
      await loadData();
      setDeleteConfirm(null);
    } catch (error) {
      console.error('Error deleting prospect:', error);
    }
  };

  const exportToCSV = () => {
    const headers = [
      'Created Date',
      'Campaign',
      'Name',
      'Phone',
      'Status',
      'Assigned To',
      'Source'
    ];

    const csvData = prospects.map(p => {
      const campaign = campaigns.find(c => (c.id === p.campaign_id));
      return [
        format(new Date(p.created_date), 'dd/MM/yyyy HH:mm'),
        campaign?.name || '',
        p.name,
        p.phone,
        statusLabels[p.status] || p.status,
        p.assigned_agent_name || '',
        (p.source || '').toUpperCase()
      ];
    });

    const csvContent = [headers, ...csvData]
      .map(row => row.map(field => '"' + String(field).replace(/"/g, '"') + '"').join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `prospects_${format(new Date(), 'ddMMyyyy_HHmm')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
        {/* Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Prospects</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage and track your sales prospects across all campaigns.
            </p>
          </div>
          <Button
            variant="outline"
            className="bg-white"
            onClick={exportToCSV}
            disabled={prospects.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>

        {/* Main Content Card */}
        <Card className="border-gray-200/50 shadow-sm bg-white overflow-hidden">
          <CardHeader className="border-b border-gray-100 p-4 lg:p-6 bg-white">
            <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
              {/* Search & Filters */}
              <div className="flex flex-1 flex-col sm:flex-row gap-3 w-full lg:max-w-4xl">
                <div className="relative flex-1 min-w-[240px]">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search prospects..."
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    className="pl-9 h-10 bg-gray-50/50 border-gray-200 focus:bg-white transition-colors"
                  />
                </div>
                <ProspectFilters
                  filters={filters}
                  onFilterChange={setFilters}
                  campaigns={campaigns}
                />
              </div>

              {/* Pagination Page Size */}
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span className="hidden sm:inline">Rows per page:</span>
                <Select value={String(pagination.itemsPerPage)} onValueChange={(value) => handlePageSizeChange(parseInt(value))}>
                  <SelectTrigger className="w-[70px] h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {!isMobile ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50/50 hover:bg-gray-50/50 border-gray-100">
                      <TableHead className="py-3 px-6 font-medium text-gray-500">Prospect</TableHead>
                      <TableHead className="py-3 px-6 font-medium text-gray-500">Campaign</TableHead>
                      <TableHead className="py-3 px-6 font-medium text-gray-500">Status</TableHead>
                      <TableHead className="py-3 px-6 font-medium text-gray-500">Date Added</TableHead>
                      <TableHead className="py-3 px-6 font-medium text-gray-500">Source</TableHead>
                      <TableHead className="py-3 px-6 font-medium text-gray-500 w-[100px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {prospects.map((prospect) => {
                      const campaign = campaigns.find(c => c.id === prospect.campaign_id);
                      return (
                        <TableRow
                          key={prospect.id}
                          className="hover:bg-gray-50/50 transition-colors border-gray-100 group"
                        >
                          <TableCell className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-semibold uppercase">
                                {prospect.name?.charAt(0) || <User className="w-4 h-4" />}
                              </div>
                              <button
                                onClick={() => setSelectedProspect(prospect)}
                                className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors text-left"
                              >
                                {prospect.name}
                                {prospect.assigned_agent_name && (
                                  <span className="block text-xs text-gray-400 font-normal mt-0.5">
                                    Agent: {prospect.assigned_agent_name}
                                  </span>
                                )}
                              </button>
                            </div>
                          </TableCell>
                          <TableCell className="px-6 py-4">
                            {campaign ? (
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-700">{campaign.name}</span>
                              </div>
                            ) : (
                              <span className="text-gray-400 text-sm italic">Unassigned</span>
                            )}
                          </TableCell>
                          <TableCell className="px-6 py-4">
                            <Badge
                              variant="outline"
                              className={`font-normal ${statusStyles[prospect.status] || "bg-gray-50 text-gray-600 border-gray-200"}`}
                            >
                              {statusLabels[prospect.status] || prospect.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-6 py-4 text-sm text-gray-500">
                            {format(new Date(prospect.created_date), 'MMM d, yyyy')}
                            <span className="block text-xs text-gray-400 mt-0.5">
                              {format(new Date(prospect.created_date), 'h:mm a')}
                            </span>
                          </TableCell>
                          <TableCell className="px-6 py-4">
                            <code className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200 uppercase">
                              {prospect.source}
                            </code>
                          </TableCell>
                          <TableCell className="px-6 py-4 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteConfirm(prospect)}
                              className="text-gray-400 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {prospects.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="h-64 text-center">
                          <div className="flex flex-col items-center justify-center text-gray-500">
                            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                              <Search className="w-6 h-6 text-gray-400" />
                            </div>
                            <p className="font-medium text-gray-900">No prospects found</p>
                            <p className="text-sm mt-1">Try adjusting your filters or search terms</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            ) : (
              // Mobile View
              <div className="divide-y divide-gray-100">
                {prospects.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">No prospects found.</div>
                ) : (
                  prospects.map((prospect) => (
                    <div key={prospect.id} className="p-4 active:bg-gray-50" onClick={() => setSelectedProspect(prospect)}>
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-sm font-bold">
                            {prospect.name?.charAt(0)}
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">{prospect.name}</div>
                            <div className="text-xs text-gray-500">
                              {format(new Date(prospect.created_date), 'MMM d, h:mm a')}
                            </div>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={statusStyles[prospect.status] || "bg-gray-100"}
                        >
                          {statusLabels[prospect.status] || prospect.status}
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center text-sm text-gray-500 mt-3 pl-13">
                        <span>{campaigns.find(c => c.id === prospect.campaign_id)?.name || 'Unknown Campaign'}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Pagination Footer */}
            {pagination.totalPages > 1 && (
              <div className="border-t border-gray-100 bg-gray-50/50 p-4 flex items-center justify-between">
                <span className="text-sm text-gray-500 hidden sm:inline">
                  Page {pagination.currentPage} of {pagination.totalPages}
                </span>
                <div className="flex items-center gap-2 w-full sm:w-auto justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(pagination.currentPage - 1)}
                    disabled={pagination.currentPage === 1}
                    className="h-8"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(pagination.currentPage + 1)}
                    disabled={pagination.currentPage === pagination.totalPages}
                    className="h-8"
                  >
                    Next <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Dialogs */}
        <Dialog open={!!selectedProspect} onOpenChange={() => setSelectedProspect(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0">
            <DialogHeader className="px-6 py-4 border-b border-gray-100">
              <DialogTitle>Prospect Details</DialogTitle>
            </DialogHeader>
            {selectedProspect && (
              <ScrollArea className="flex-1 p-6">
                <ProspectDetails
                  prospect={selectedProspect}
                  campaigns={campaigns}
                  onStatusUpdate={handleStatusUpdate}
                  onClose={() => setSelectedProspect(null)}
                  userRole={user?.role}
                  onEdited={loadData}
                />
              </ScrollArea>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete Prospect</DialogTitle>
            </DialogHeader>
            <div className="py-4 text-sm text-gray-600">
              Are you sure you want to delete <strong>{deleteConfirm?.name}</strong>? This action cannot be undone.
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => handleDeleteProspect(deleteConfirm.id)}>Delete</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}