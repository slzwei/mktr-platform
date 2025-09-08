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
  Download
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

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
  const [filters, setFilters] = useState({
    search: "",
    status: "all",
    campaign: "all",
    source: "all"
  });
  const isMobile = useIsMobile();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const campaignId = params.get('campaign');
    if (campaignId) {
      setFilters(prevFilters => ({...prevFilters, campaign: campaignId}));
    }
    loadData();
  }, [location.search]);

  const loadData = async () => {
    try {
      const [userData, prospectsData, allCampaignsData] = await Promise.all([
        auth.getCurrentUser(),
        Prospect.list(),
        Campaign.list()
      ]);
      setUser(userData);
      
      // Filter out archived campaigns for prospect assignment
      const campaignsData = allCampaignsData.filter(campaign => campaign.status !== 'archived');
      
      // Normalize and sort by created_date desc
      const normalized = (prospectsData || []).map(normalizeProspect).sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
      setProspects(normalized);
      setCampaigns(campaignsData || []);
    } catch (error) {
      console.error('Error loading prospects:', error);
    }
    setLoading(false);
  };

  const getFilteredProspects = () => {
    let filtered = prospects.slice();

    if (user?.role === 'agent') {
      filtered = filtered.filter(p => p.assigned_agent_id === user.id);
    }

    if (filters.search) {
      const search = filters.search.toLowerCase();
      filtered = filtered.filter(p => 
        p.name?.toLowerCase().includes(search) ||
        p.phone?.includes(search) ||
        p.email?.toLowerCase().includes(search)
      );
    }

    if (filters.status !== "all") {
      filtered = filtered.filter(p => p.status === filters.status);
    }

    if (filters.campaign !== "all") {
      filtered = filtered.filter(p => String(p.campaign_id) === String(filters.campaign));
    }

    if (filters.source !== "all") {
      filtered = filtered.filter(p => p.source === filters.source);
    }

    return filtered;
  };

  const handleStatusUpdate = async (prospectId, newStatus) => {
    try {
      await Prospect.update(prospectId, { leadStatus: newStatus });
      await loadData();
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const exportToCSV = () => {
    const filteredProspects = getFilteredProspects();
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

    const csvData = filteredProspects.map(p => {
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

  const filteredProspects = getFilteredProspects();

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
            <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <Input
                  placeholder="Search prospects..."
                  value={filters.search}
                  onChange={(e) => setFilters({...filters, search: e.target.value})}
                  className="pl-10"
                />
              </div>
              <ProspectFilters 
                filters={filters} 
                onFilterChange={setFilters}
                campaigns={campaigns}
              />
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProspects.map((prospect) => {
                      const campaign = campaigns.find(c => c.id === prospect.campaign_id);
                      return (
                        <TableRow
                          key={prospect.id}
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => setSelectedProspect(prospect)}
                        >
                          <TableCell>
                            <p className="font-semibold text-gray-900 truncate">{prospect.name}</p>
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
                      <button
                        key={prospect.id}
                        onClick={() => setSelectedProspect(prospect)}
                        className="w-full text-left p-4 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-gray-900 truncate">{prospect.name}</p>
                          <Badge className={statusColors[prospect.status] + " ml-2"}>
                            {statusLabels[prospect.status] || prospect.status}
                          </Badge>
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
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!selectedProspect} onOpenChange={() => setSelectedProspect(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Prospect Details</DialogTitle>
            </DialogHeader>
            {selectedProspect && (
              <ProspectDetails
                prospect={selectedProspect}
                campaigns={campaigns}
                onStatusUpdate={handleStatusUpdate}
                onClose={() => setSelectedProspect(null)}
                userRole={user?.role}
                onEdited={loadData}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}