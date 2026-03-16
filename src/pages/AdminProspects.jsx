import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Prospect, Campaign } from "@/api/entities";
import { useCurrentUser } from "@/hooks/queries/useUsersQuery";
import { useUpdateProspect, useDeleteProspect } from "@/hooks/queries/useProspectsQuery";
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
  User
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
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
  new: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  contacted: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  meeting: "bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800",
  won: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  lost: "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800",
  rejected: "bg-slate-50 dark:bg-slate-950/30 text-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-800"
};

const statusLabels = {
  new: "New",
  contacted: "Contacted",
  meeting: "Meeting",
  won: "Won",
  lost: "Lost",
  rejected: "Rejected",
  negotiating: "Negotiating",
  qualified: "Qualified"
};

function normalizeProspect(p) {
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || p.name || "";
  const status = (p.leadStatus || p.status || "new").toLowerCase();
  const createdDate = p.createdAt || p.created_date || new Date().toISOString();
  const source = (p.leadSource || p.source || "other").toLowerCase();
  let simplifiedSource = "other";
  if (source === "qr_code") simplifiedSource = "qr";
  else if (source === "website") simplifiedSource = "form";
  else if (source === "call_bot") simplifiedSource = "call bot";

  const assignedAgentId = p.assignedAgentId || p.assigned_agent_id || "";
  const assignedAgentName = p.assignedAgent
    ? ([p.assignedAgent.firstName, p.assignedAgent.lastName].filter(Boolean).join(" ") || p.assignedAgent.email || "Agent")
    : (p.assigned_agent_name || "");

  return {
    id: p.id, name, phone: p.phone || "", email: p.email || "",
    postal_code: p.location?.zipCode || p.postal_code || "",
    date_of_birth: p.dateOfBirth || p.date_of_birth || null,
    status, created_date: createdDate, source: simplifiedSource,
    assigned_agent_id: assignedAgentId, assigned_agent_name: assignedAgentName,
    campaign_id: p.campaignId || p.campaign_id || ""
  };
}

export default function AdminProspects() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const updateProspectMutation = useUpdateProspect();
  const deleteProspectMutation = useDeleteProspect();

  const [selectedProspect, setSelectedProspect] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [filters, setFilters] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      search: "", status: "all",
      campaign: params.get('campaign') || "all",
      qrTagId: params.get('qrTagId') || "all",
      source: "all"
    };
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const isMobile = useIsMobile();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const campaignId = params.get('campaign') || "all";
    const qrTagId = params.get('qrTagId') || "all";
    setFilters(prev => {
      if (prev.campaign === campaignId && prev.qrTagId === qrTagId) return prev;
      return { ...prev, campaign: campaignId, qrTagId: qrTagId };
    });
  }, [location.search]);

  const queryParams = useMemo(() => {
    const params = { page: currentPage, limit: itemsPerPage };
    if (filters.search) params.search = filters.search;
    if (filters.status !== "all") params.leadStatus = filters.status;
    if (filters.campaign !== "all") params.campaignId = filters.campaign;
    if (filters.qrTagId !== "all") params.qrTagId = filters.qrTagId;
    if (filters.source !== "all") {
      if (filters.source === "qr") params.leadSource = "qr_code";
      else if (filters.source === "form") params.leadSource = "website";
      else params.leadSource = filters.source;
    }
    return params;
  }, [filters, currentPage, itemsPerPage]);

  const { data: prospectsResponse, isLoading: prospectsLoading } = useQuery({
    queryKey: ['prospects', 'list', queryParams],
    queryFn: () => Prospect.list(queryParams),
  });
  const { data: campaignsRaw } = useQuery({
    queryKey: ['campaigns', 'all-for-lookup'],
    queryFn: () => Campaign.list({ limit: 1000 }),
    staleTime: 60_000,
  });

  const campaigns = useMemo(() => {
    if (!campaignsRaw) return [];
    return Array.isArray(campaignsRaw) ? campaignsRaw : (campaignsRaw.campaigns || []);
  }, [campaignsRaw]);

  const prospects = useMemo(() => {
    const data = prospectsResponse?.prospects || prospectsResponse || [];
    return (Array.isArray(data) ? data : []).map(normalizeProspect);
  }, [prospectsResponse]);

  const pagination = prospectsResponse?.pagination || {
    currentPage, totalPages: 1, totalItems: prospects.length, itemsPerPage
  };

  const handleRefresh = () => queryClient.invalidateQueries({ queryKey: ['prospects'] });

  const handleStatusUpdate = async (prospectId, newStatus) => {
    try {
      await updateProspectMutation.mutateAsync({ id: prospectId, data: { leadStatus: newStatus } });
    } catch (error) { console.error('Error updating status:', error); }
  };

  const handleDeleteProspect = async (prospectId) => {
    try {
      await deleteProspectMutation.mutateAsync(prospectId);
      setDeleteConfirm(null);
      if (selectedProspect?.id === prospectId) setSelectedProspect(null);
    } catch (error) { console.error('Error deleting prospect:', error); }
  };

  const exportToCSV = () => {
    const headers = ['Created Date', 'Campaign', 'Name', 'Phone', 'Status', 'Assigned To', 'Source'];
    const csvData = prospects.map(p => {
      const campaign = campaigns.find(c => (c.id === p.campaign_id));
      return [
        format(new Date(p.created_date), 'dd/MM/yyyy HH:mm'),
        campaign?.name || '', p.name, p.phone,
        statusLabels[p.status] || p.status,
        p.assigned_agent_name || '', (p.source || '').toUpperCase()
      ];
    });
    const csvContent = [headers, ...csvData]
      .map(row => row.map(field => '"' + String(field).replace(/"/g, '"') + '"').join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', `prospects_${format(new Date(), 'ddMMyyyy_HHmm')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (prospectsLoading) {
    return (
      <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50 dark:bg-gray-900/50">
        <div className="max-w-[1400px] mx-auto space-y-6">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-48 animate-pulse" />
          <div className="h-96 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════
     DETAIL VIEW — full-width, replaces the table
     ═══════════════════════════════════════════════════════ */
  if (selectedProspect) {
    return (
      <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50 dark:bg-gray-900/50">
        <div className="max-w-[1200px] mx-auto">
          <ProspectDetails
            prospect={selectedProspect}
            campaigns={campaigns}
            onStatusUpdate={handleStatusUpdate}
            onClose={() => setSelectedProspect(null)}
            userRole={user?.role}
            onEdited={handleRefresh}
          />
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════
     LIST VIEW — table with filters
     ═══════════════════════════════════════════════════════ */
  return (
    <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50 dark:bg-gray-900/50">
      <div className="max-w-[1400px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Prospects</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Manage and track your sales prospects across all campaigns.
            </p>
          </div>
          <Button variant="outline" className="bg-white dark:bg-gray-900" onClick={exportToCSV} disabled={prospects.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>

        {/* Table Card */}
        <Card className="border-gray-200/50 dark:border-gray-700/50 shadow-sm bg-white dark:bg-gray-900 overflow-hidden">
          <CardHeader className="border-b border-gray-100 dark:border-gray-700 p-4 lg:p-6 bg-white dark:bg-gray-900">
            <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
              <div className="flex flex-1 flex-col sm:flex-row gap-3 w-full lg:max-w-4xl">
                <div className="relative flex-1 min-w-[240px]">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 w-4 h-4" />
                  <Input
                    placeholder="Search prospects..."
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    className="pl-9 h-10 bg-gray-50/50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 focus:bg-white dark:focus:bg-gray-900 transition-colors"
                  />
                </div>
                <ProspectFilters filters={filters} onFilterChange={setFilters} campaigns={campaigns} />
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <span className="hidden sm:inline">Rows per page:</span>
                <Select value={String(pagination.itemsPerPage)} onValueChange={(v) => { setCurrentPage(1); setItemsPerPage(parseInt(v)); }}>
                  <SelectTrigger className="w-[70px] h-9"><SelectValue /></SelectTrigger>
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
                    <TableRow className="bg-gray-50/50 dark:bg-gray-900/50 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 border-gray-100 dark:border-gray-700">
                      <TableHead className="py-3 px-6 font-medium text-gray-500 dark:text-gray-400">Prospect</TableHead>
                      <TableHead className="py-3 px-6 font-medium text-gray-500 dark:text-gray-400">Campaign</TableHead>
                      <TableHead className="py-3 px-6 font-medium text-gray-500 dark:text-gray-400">Status</TableHead>
                      <TableHead className="py-3 px-6 font-medium text-gray-500 dark:text-gray-400">Date Added</TableHead>
                      <TableHead className="py-3 px-6 font-medium text-gray-500 dark:text-gray-400">Source</TableHead>
                      <TableHead className="py-3 px-6 font-medium text-gray-500 dark:text-gray-400 w-[100px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {prospects.map((prospect) => {
                      const campaign = campaigns.find(c => c.id === prospect.campaign_id);
                      return (
                        <TableRow
                          key={prospect.id}
                          className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors border-gray-100 dark:border-gray-700 group cursor-pointer"
                          onClick={() => setSelectedProspect(prospect)}
                        >
                          <TableCell className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-semibold uppercase">
                                {prospect.name?.charAt(0) || <User className="w-4 h-4" />}
                              </div>
                              <div>
                                <span className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                  {prospect.name}
                                </span>
                                {prospect.assigned_agent_name ? (
                                  <span className="block text-xs text-gray-400 dark:text-gray-500 font-normal mt-0.5">
                                    Agent: {prospect.assigned_agent_name}
                                  </span>
                                ) : (
                                  <span className="block text-xs text-amber-500 dark:text-amber-400 font-normal mt-0.5">
                                    Unassigned
                                  </span>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="px-6 py-4">
                            {campaign ? (
                              <span className="text-sm text-gray-700 dark:text-gray-300">{campaign.name}</span>
                            ) : (
                              <span className="text-gray-400 dark:text-gray-500 text-sm italic">—</span>
                            )}
                          </TableCell>
                          <TableCell className="px-6 py-4">
                            <Badge variant="outline" className={`font-normal ${statusStyles[prospect.status] || "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700"}`}>
                              {statusLabels[prospect.status] || prospect.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                            {format(new Date(prospect.created_date), 'MMM d, yyyy')}
                            <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                              {format(new Date(prospect.created_date), 'h:mm a')}
                            </span>
                          </TableCell>
                          <TableCell className="px-6 py-4">
                            <code className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 uppercase">
                              {prospect.source}
                            </code>
                          </TableCell>
                          <TableCell className="px-6 py-4 text-right">
                            <Button
                              variant="ghost" size="sm"
                              onClick={(e) => { e.stopPropagation(); setDeleteConfirm(prospect); }}
                              className="text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 h-8 w-8 p-0"
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
                          <div className="flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
                            <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mb-3">
                              <Search className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                            </div>
                            <p className="font-medium text-gray-900 dark:text-gray-100">No prospects found</p>
                            <p className="text-sm mt-1">Try adjusting your filters or search terms</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {prospects.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 dark:text-gray-400">No prospects found.</div>
                ) : prospects.map((prospect) => (
                  <div key={prospect.id} className="p-4 active:bg-gray-50 dark:active:bg-gray-800" onClick={() => setSelectedProspect(prospect)}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold">
                          {prospect.name?.charAt(0)}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 dark:text-gray-100">{prospect.name}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{format(new Date(prospect.created_date), 'MMM d, h:mm a')}</div>
                        </div>
                      </div>
                      <Badge variant="outline" className={statusStyles[prospect.status] || "bg-gray-100 dark:bg-gray-700"}>
                        {statusLabels[prospect.status] || prospect.status}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center text-sm text-gray-500 dark:text-gray-400 mt-3 pl-13">
                      <span>{campaigns.find(c => c.id === prospect.campaign_id)?.name || 'Unknown Campaign'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {pagination.totalPages > 1 && (
              <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50 p-4 flex items-center justify-between">
                <span className="text-sm text-gray-500 dark:text-gray-400 hidden sm:inline">
                  Page {pagination.currentPage} of {pagination.totalPages}
                </span>
                <div className="flex items-center gap-2 w-full sm:w-auto justify-center">
                  <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => p - 1)} disabled={pagination.currentPage === 1} className="h-8">
                    <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => p + 1)} disabled={pagination.currentPage === pagination.totalPages} className="h-8">
                    Next <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Delete Confirmation */}
        <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Delete Prospect</DialogTitle></DialogHeader>
            <div className="py-4 text-sm text-gray-600 dark:text-gray-400">
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
