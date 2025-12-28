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
  ChevronsRight
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

const statusColors = {
  new: "bg-blue-100 text-blue-800",
  contacted: "bg-yellow-100 text-yellow-800",
  meeting: "bg-purple-100 text-purple-800",
  close_won: "bg-green-100 text-green-800",
  close_lost: "bg-red-100 text-red-800",
  rejected: "bg-gray-100 text-gray-800"
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
  const updatedDate = p.updatedAt || p.updated_date || createdDate;
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
    updated_date: updatedDate,
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

  // Reload data when filters or pagination changes
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

      // Add search param
      if (filters.search) {
        params.search = filters.search;
      }

      // Add status filter
      if (filters.status !== "all") {
        params.leadStatus = filters.status;
      }

      // Add campaign filter
      if (filters.campaign !== "all") {
        params.campaignId = filters.campaign;
      }

      // Add source filter
      if (filters.source !== "all") {
        // Map UI source values back to backend values
        if (filters.source === "qr") {
          params.leadSource = "qr_code";
        } else if (filters.source === "form") {
          params.leadSource = "website";
        } else {
          params.leadSource = filters.source;
        }
      }

      const [userData, prospectsResponse, allCampaignsData] = await Promise.all([
        user || auth.getCurrentUser(),
        Prospect.list(params),
        campaigns.length > 0 ? Promise.resolve(campaigns) : Campaign.list()
      ]);

      if (!user) setUser(userData);

      // Filter out archived campaigns
      const campaignsResponse = Array.isArray(allCampaignsData) ? allCampaignsData : (allCampaignsData.campaigns || []);
      const campaignsData = campaignsResponse.filter(campaign => campaign.status !== 'archived');

      // Handle paginated response
      const prospectsData = prospectsResponse.prospects || prospectsResponse || [];
      const paginationData = prospectsResponse.pagination || {
        currentPage: pagination.currentPage,
        totalPages: 1,
        totalItems: prospectsData.length,
        itemsPerPage: pagination.itemsPerPage
      };

      // Normalize prospects
      const normalized = (prospectsData || []).map(normalizeProspect);
      setProspects(normalized);
      // Only update campaigns if we fetched them (or force update if needed)
      // Original logic was: if (!campaigns.length) setCampaigns...
      // But we should probably update them if we fetched them to be safe
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

  const loadData = async (page = pagination.currentPage, pageSize = pagination.itemsPerPage) => {
    try {
      const [userData, prospectsResponse, allCampaignsData] = await Promise.all([
        auth.getCurrentUser(),
        Prospect.list({ page, limit: pageSize }),
        Campaign.list()
      ]);
      setUser(userData);

      // Filter out archived campaigns for prospect assignment
      const campaignsList = Array.isArray(allCampaignsData) ? allCampaignsData : (allCampaignsData.campaigns || []);
      const campaignsData = campaignsList.filter(campaign => campaign.status !== 'archived');

      // Handle paginated response
      const prospectsData = prospectsResponse.prospects || prospectsResponse || [];
      const paginationData = prospectsResponse.pagination || {
        currentPage: 1,
        totalPages: 1,
        totalItems: prospectsData.length,
        itemsPerPage: pageSize
      };

      // Normalize prospects (they're already sorted by backend)
      const normalized = (prospectsData || []).map(normalizeProspect);
      setProspects(normalized);
      setCampaigns(campaignsData || []);
      setPagination(paginationData);
    } catch (error) {
      console.error('Error loading prospects:', error);
    }
    setLoading(false);
  };

  // Server-side filtering is now handled in loadDataWithFilters
  // prospects already contains the filtered and paginated results
  const filteredProspects = prospects;

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
      alert('Failed to delete prospect. Please try again.');
    }
  };

  const exportToCSV = () => {
    // Note: This exports only the current page. For full export, we'd need a separate API endpoint
    const filteredProspectsForExport = filteredProspects;
    const headers = [
      'Created Date',
      'Campaign',
      'Prospect ID',
      'Name',
      'Phone',
      'Status',
      'Assigned To',
      'Postal Code',
      'Email',
      'DOB',
      'Source'
    ];

    const csvData = filteredProspectsForExport.map(p => {
      const campaign = campaigns.find(c => (c.id === p.campaign_id));
      return [
        format(new Date(p.created_date), 'dd/MM/yyyy HH:mm'),
        campaign?.name || '',
        p.id,
        p.name,
        p.phone,
        statusLabels[p.status] || p.status,
        p.assigned_agent_id || '',
        p.postal_code || '',
        p.email || '',
        p.date_of_birth ? format(new Date(p.date_of_birth), 'ddMMyyyy') : '',
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
    link.setAttribute('download', `prospects_${format(new Date(), 'ddMMyyyy_HHmm')}_SGT.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

  return (
    <div className="p-6 lg:p-8 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Admin - Prospects</h1>
            <p className="text-gray-600 mt-1">
              Manage and track your sales prospects
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={exportToCSV}
              disabled={filteredProspects.length === 0}
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="border-b border-gray-100">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <Input
                    placeholder="Search prospects..."
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    className="pl-10"
                  />
                </div>
                <ProspectFilters
                  filters={filters}
                  onFilterChange={setFilters}
                  campaigns={campaigns}
                />
              </div>

              {/* Pagination info and page size selector */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <span>
                    Showing <span className="font-semibold text-gray-900">{pagination.totalItems > 0 ? Math.min((pagination.currentPage - 1) * pagination.itemsPerPage + 1, pagination.totalItems) : 0}</span> to{' '}
                    <span className="font-semibold text-gray-900">{Math.min(pagination.currentPage * pagination.itemsPerPage, pagination.totalItems)}</span> of{' '}
                    <span className="font-semibold text-gray-900">{pagination.totalItems.toLocaleString()}</span> prospects
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">Show:</span>
                  <Select value={String(pagination.itemsPerPage)} onValueChange={(value) => handlePageSizeChange(parseInt(value))}>
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-gray-600">per page</span>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {!isMobile ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="whitespace-nowrap">Prospect Name</TableHead>
                      <TableHead className="whitespace-nowrap">Campaign</TableHead>
                      <TableHead className="whitespace-nowrap">Created Date/Time</TableHead>
                      <TableHead className="whitespace-nowrap">Source</TableHead>
                      <TableHead className="whitespace-nowrap">Status</TableHead>
                      <TableHead className="whitespace-nowrap w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProspects.map((prospect) => {
                      const campaign = campaigns.find(c => c.id === prospect.campaign_id);
                      return (
                        <TableRow
                          key={prospect.id}
                          className="hover:bg-gray-50"
                        >
                          <TableCell>
                            <button
                              type="button"
                              onClick={() => setSelectedProspect(prospect)}
                              className="font-semibold text-blue-600 hover:underline truncate"
                            >
                              {prospect.name}
                            </button>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="bg-blue-50 text-blue-700">
                              {campaign?.name || 'Unknown'}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-gray-700">
                            {format(new Date(prospect.created_date), 'dd/MM/yyyy HH:mm')}
                          </TableCell>
                          <TableCell>
                            <span className="text-xs px-2 py-1 bg-gray-100 rounded text-gray-600">
                              {(prospect.source || '').toUpperCase()}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge className={statusColors[prospect.status] + " whitespace-nowrap"}>
                              {statusLabels[prospect.status] || prospect.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteConfirm(prospect)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {filteredProspects.length === 0 && (
                  <div className="text-center py-12">
                    <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                      <Search className="w-6 h-6 text-gray-400" />
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-2">No prospects found</h3>
                    <p className="text-gray-500">Try adjusting your search or filters</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {filteredProspects.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                      <Search className="w-6 h-6 text-gray-400" />
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-2">No prospects found</h3>
                    <p className="text-gray-500">Try adjusting your search or filters</p>
                  </div>
                ) : (
                  filteredProspects.map((prospect) => {
                    const campaign = campaigns.find(c => c.id === prospect.campaign_id);
                    return (
                      <div
                        key={prospect.id}
                        className="w-full text-left p-4 hover:bg-gray-50"
                      >
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => setSelectedProspect(prospect)}
                            className="font-semibold text-blue-600 hover:underline truncate"
                          >
                            {prospect.name}
                          </button>
                          <div className="flex items-center gap-2">
                            <Badge className={statusColors[prospect.status] + " ml-2"}>
                              {statusLabels[prospect.status] || prospect.status}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteConfirm(prospect)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50 p-1"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-gray-600">
                          <div>
                            <span className="block text-gray-500">Campaign</span>
                            <span className="inline-block mt-1 text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded">
                              {campaign?.name || 'Unknown'}
                            </span>
                          </div>
                          <div>
                            <span className="block text-gray-500">Created</span>
                            <span className="block mt-1">{format(new Date(prospect.created_date), 'dd/MM/yyyy HH:mm')}</span>
                          </div>
                          <div>
                            <span className="block text-gray-500">Source</span>
                            <span className="inline-block mt-1 text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded">
                              {(prospect.source || '').toUpperCase()}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </CardContent>

          {/* Pagination Controls */}
          {pagination.totalItems > 0 && (
            <div className="border-t border-gray-100 px-6 py-4 bg-gray-50">
              <div className="flex flex-col lg:flex-row justify-between items-center gap-4">
                {/* Results info */}
                <div className="text-sm text-gray-600 order-2 lg:order-1">
                  Showing {Math.min((pagination.currentPage - 1) * pagination.itemsPerPage + 1, pagination.totalItems)} to {Math.min(pagination.currentPage * pagination.itemsPerPage, pagination.totalItems)} of {pagination.totalItems.toLocaleString()} prospects
                </div>

                {/* Page size selector */}
                <div className="flex items-center gap-2 order-1 lg:order-2">
                  <span className="text-sm text-gray-600">Show</span>
                  <Select
                    value={String(pagination.itemsPerPage)}
                    onValueChange={(value) => handlePageSizeChange(parseInt(value))}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-gray-600">per page</span>
                </div>

                {/* Pagination buttons */}
                <div className="flex items-center gap-1 order-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(1)}
                    disabled={pagination.currentPage === 1}
                    className="hidden sm:flex"
                  >
                    <ChevronsLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(pagination.currentPage - 1)}
                    disabled={pagination.currentPage === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span className="hidden sm:inline ml-1">Previous</span>
                  </Button>

                  {/* Page numbers */}
                  <div className="hidden sm:flex items-center gap-1 mx-2">
                    {(() => {
                      const pages = [];
                      const maxVisible = 5;
                      let startPage = Math.max(1, pagination.currentPage - Math.floor(maxVisible / 2));
                      let endPage = Math.min(pagination.totalPages, startPage + maxVisible - 1);

                      if (endPage - startPage + 1 < maxVisible) {
                        startPage = Math.max(1, endPage - maxVisible + 1);
                      }

                      if (startPage > 1) {
                        pages.push(
                          <Button
                            key={1}
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(1)}
                            className="w-9"
                          >
                            1
                          </Button>
                        );
                        if (startPage > 2) {
                          pages.push(<span key="ellipsis1" className="px-2 text-gray-400">...</span>);
                        }
                      }

                      for (let i = startPage; i <= endPage; i++) {
                        pages.push(
                          <Button
                            key={i}
                            variant={i === pagination.currentPage ? "default" : "outline"}
                            size="sm"
                            onClick={() => handlePageChange(i)}
                            className="w-9"
                          >
                            {i}
                          </Button>
                        );
                      }

                      if (endPage < pagination.totalPages) {
                        if (endPage < pagination.totalPages - 1) {
                          pages.push(<span key="ellipsis2" className="px-2 text-gray-400">...</span>);
                        }
                        pages.push(
                          <Button
                            key={pagination.totalPages}
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(pagination.totalPages)}
                            className="w-9"
                          >
                            {pagination.totalPages}
                          </Button>
                        );
                      }

                      return pages;
                    })()}
                  </div>

                  {/* Mobile page indicator */}
                  <div className="sm:hidden px-3 py-1 text-sm text-gray-600">
                    Page {pagination.currentPage} of {pagination.totalPages}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(pagination.currentPage + 1)}
                    disabled={pagination.currentPage === pagination.totalPages}
                  >
                    <span className="hidden sm:inline mr-1">Next</span>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(pagination.totalPages)}
                    disabled={pagination.currentPage === pagination.totalPages}
                    className="hidden sm:flex"
                  >
                    <ChevronsRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Card>

        <Dialog open={!!selectedProspect} onOpenChange={() => setSelectedProspect(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>Prospect Details</DialogTitle>
            </DialogHeader>
            {selectedProspect && (
              <ScrollArea className="max-h-[70vh] pr-2">
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
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete Prospect</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <p className="text-gray-600">
                Are you sure you want to delete <strong>{deleteConfirm?.name}</strong>?
                This action cannot be undone.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleDeleteProspect(deleteConfirm.id)}
              >
                Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}