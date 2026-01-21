import { useState, useEffect } from "react";
import { User } from "@/api/entities";
import { Campaign } from "@/api/entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format, parseISO } from "date-fns";
import {
  Plus,
  Edit,
  Copy,
  Link as LinkIcon,
  Users,
  Palette,
  Archive,
  RotateCcw,
  Trash2,
  MoreVertical,
  Grid as GridIcon,
  List as ListIcon,
  Search,
  Car,
  QrCode
} from "lucide-react";

import CampaignTypeSelectionDialog from "../components/campaigns/CampaignTypeSelectionDialog";


import { useNavigate } from "react-router-dom";


export default function AdminCampaigns() {
  const [user, setUser] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [archivedCampaigns, setArchivedCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [activeTab, setActiveTab] = useState("active");
  const [viewMode, setViewMode] = useState("list"); // list | grid
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | active | inactive
  const [isTypeSelectionOpen, setIsTypeSelectionOpen] = useState(false);


  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [userData, campaignsData] = await Promise.all([
        User.me(),
        Campaign.list({ sort: '-created_date', limit: 100 })
      ]);

      setUser(userData);

      // Handle both array (legacy) and paginated object responses
      const campaignsList = Array.isArray(campaignsData) ? campaignsData : (campaignsData.campaigns || []);

      // Separate active and archived campaigns
      const activeCampaigns = campaignsList.filter(campaign => campaign.status !== 'archived');
      const archived = campaignsList.filter(campaign => campaign.status === 'archived');

      setCampaigns(activeCampaigns);
      setArchivedCampaigns(archived);
    } catch (error) {
      console.error('Error loading campaigns:', error);
    }
    setLoading(false);
  };







  const handleCreateCampaign = (type) => {
    setIsTypeSelectionOpen(false);
    navigate(`/admin/campaigns/new?type=${type}`);
  };

  const handleCopyLink = (campaignId) => {
    const baseUrl = window.location.origin;
    const campaignUrl = `${baseUrl}${createPageUrl(`LeadCapture?campaign_id=${campaignId}`)}`;

    navigator.clipboard.writeText(campaignUrl).then(() => {
      setCopiedId(campaignId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleArchiveCampaign = async (campaignId) => {
    if (window.confirm("Are you sure you want to archive this campaign? It will be moved to the archived campaigns section.")) {
      try {
        await Campaign.archive(campaignId);
        await loadData();
      } catch (error) {
        console.error("Failed to archive campaign:", error);
        alert("Failed to archive campaign. Please try again.");
      }
    }
  };

  const handleRestoreCampaign = async (campaignId) => {
    try {
      await Campaign.restore(campaignId);
      await loadData();
    } catch (error) {
      console.error("Failed to restore campaign:", error);
      alert("Failed to restore campaign. Please try again.");
    }
  };

  const handlePermanentDelete = async (campaignId) => {
    if (window.confirm("Are you sure you want to PERMANENTLY DELETE this campaign? This action cannot be undone and will delete all associated data.")) {
      try {
        await Campaign.permanentDelete(campaignId);
        await loadData();
      } catch (error) {
        console.error("Failed to delete campaign:", error);
        alert("Failed to delete campaign. Please try again.");
      }
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

  // Role gating handled by ProtectedRoute; avoid double-deny here to prevent false negatives

  // filters
  const applyFilters = (list) => {
    let result = list;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter((c) => c.name?.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") {
      const wantActive = statusFilter === "active";
      result = result.filter((c) => Boolean(c.is_active) === wantActive);
    }
    return result;
  };

  const visibleActive = applyFilters(campaigns);
  const visibleArchived = applyFilters(archivedCampaigns);

  const renderActionsMenu = (c) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <MoreVertical className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleCopyLink(c.id)}>
          {copiedId === c.id ? <Copy className="w-4 h-4 text-green-500" /> : <LinkIcon className="w-4 h-4" />}
          <span className="ml-2">{copiedId === c.id ? 'Copied!' : 'Copy Link'}</span>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={createPageUrl(`AdminCampaignDesigner?campaign_id=${c.id}`)} className="flex items-center">
            <Palette className="w-4 h-4" />
            <span className="ml-2">Design</span>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link to={`/admin/campaigns/${c.id}/edit`}>
            <Edit className="w-4 h-4" />
            <span className="ml-2">Edit</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleArchiveCampaign(c.id)} className="text-orange-600">
          <Archive className="w-4 h-4" />
          <span className="ml-2">Archive</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // helper for type icon
  const getTypeIcon = (type) => {
    if (type === 'brand_awareness') return <Car className="w-4 h-4 text-blue-600" />;
    return <QrCode className="w-4 h-4 text-green-600" />;
  };

  const renderListTable = (list, archived = false) => (

    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead>Campaign Name</TableHead>
            {!archived && <TableHead>Status</TableHead>}
            <TableHead>Type</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Age Range</TableHead>

            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((campaign) => (
            <TableRow key={campaign.id} className="hover:bg-gray-50">
              <TableCell className="font-semibold">
                {archived ? (
                  <span className="text-gray-700">{campaign.name}</span>
                ) : (
                  <Link
                    to={createPageUrl(`AdminProspects?campaign=${campaign.id}`)}
                    className="text-blue-600 hover:underline hover:text-blue-800"
                  >
                    {campaign.name}
                  </Link>
                )}
              </TableCell>
              {!archived && (
                <TableCell>
                  <Badge
                    variant={campaign.is_active ? "default" : "outline"}
                    className={
                      campaign.is_active
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }
                  >
                    {campaign.is_active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
              )}
              <TableCell>
                <div className="flex items-center gap-2" title={campaign.type === 'brand_awareness' ? 'PHV Campaign' : 'Regular Campaign'}>
                  {getTypeIcon(campaign.type)}
                  <span className="text-sm text-gray-600 capitalize">
                    {campaign.type === 'brand_awareness' ? 'PHV' : 'Regular'}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                {campaign.start_date && campaign.end_date ? (
                  <>
                    {format(parseISO(campaign.start_date), "dd MMM yyyy")} - {format(parseISO(campaign.end_date), "dd MMM yyyy")}
                  </>
                ) : (
                  <span className="text-gray-400">Not set</span>
                )}
              </TableCell>
              <TableCell>
                {campaign.min_age} - {campaign.max_age || 'Any'}
              </TableCell>

              <TableCell className="flex items-center gap-2">
                {archived ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRestoreCampaign(campaign.id)}
                      className="text-green-600 hover:text-green-800"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Restore
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePermanentDelete(campaign.id)}
                      className="text-red-600 hover:text-red-800"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </Button>
                  </div>
                ) : (
                  renderActionsMenu(campaign)
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  const renderGrid = (list, archived = false) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {list.map((c) => (
        <Card key={c.id} className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-semibold truncate">{c.name}</CardTitle>
            {archived ? (
              <Badge variant="outline" className="bg-gray-100 text-gray-700">Archived</Badge>
            ) : (
              <Badge className={c.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"} variant={c.is_active ? "default" : "outline"}>
                {c.is_active ? "Active" : "Inactive"}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-gray-600">
              <div>
                <span className="text-gray-500">Duration:</span>{" "}
                {c.start_date && c.end_date ? (
                  `${format(parseISO(c.start_date), 'dd MMM')} – ${format(parseISO(c.end_date), 'dd MMM yyyy')}`
                ) : (
                  <span className="text-gray-400">Not set</span>
                )}
              </div>
              <div>
                <span className="text-gray-500">Age:</span> {c.min_age} – {c.max_age || 'Any'}
              </div>

            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              {getTypeIcon(c.type)}
              <span>{c.type === 'brand_awareness' ? 'PHV Campaign' : 'Regular Campaign'}</span>
            </div>
            <div className="flex items-center justify-between pt-1">
              {archived ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleRestoreCampaign(c.id)}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Restore
                  </Button>
                  <Button size="sm" variant="outline" className="text-red-600" onClick={() => handlePermanentDelete(c.id)}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleCopyLink(c.id)}>
                    {copiedId === c.id ? <Copy className="w-4 h-4 mr-2 text-green-500" /> : <LinkIcon className="w-4 h-4 mr-2" />}
                    {copiedId === c.id ? 'Copied' : 'Copy Link'}
                  </Button>
                  {renderActionsMenu(c)}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
      {list.length === 0 && (
        <div className="col-span-full text-center py-12 text-gray-500">
          <h3 className="font-semibold">No campaigns found.</h3>
        </div>
      )}
    </div>
  );

  return (
    <div className="p-6 lg:p-8 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Admin - Campaign Management</h1>
            <p className="text-gray-600 mt-1">Create and manage your marketing campaigns.</p>
          </div>
          <Button onClick={() => setIsTypeSelectionOpen(true)} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-5 h-5 mr-2" />
            Create Campaign
          </Button>
        </div>

        {/* quick stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <Card>
            <CardContent className="py-3">
              <div className="text-sm text-gray-500">Active</div>
              <div className="text-2xl font-semibold">{campaigns.filter(c => c.is_active).length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <div className="text-sm text-gray-500">Inactive</div>
              <div className="text-2xl font-semibold">{campaigns.filter(c => !c.is_active).length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <div className="text-sm text-gray-500">Archived</div>
              <div className="text-2xl font-semibold">{archivedCampaigns.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* controls */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 w-full lg:w-auto">
            <div className="relative w-full lg:w-80">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search campaigns..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === 'list' ? 'default' : 'outline'}
              onClick={() => setViewMode('list')}
            >
              <ListIcon className="w-4 h-4 mr-2" />
              List
            </Button>
            <Button
              variant={viewMode === 'grid' ? 'default' : 'outline'}
              onClick={() => setViewMode('grid')}
            >
              <GridIcon className="w-4 h-4 mr-2" />
              Grid
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-4">
            <Card className="shadow-lg">
              <CardContent className="p-4">
                {viewMode === 'list' ? (
                  renderListTable(visibleActive)
                ) : (
                  renderGrid(visibleActive)
                )}
                {visibleActive.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <h3 className="font-semibold">No campaigns found.</h3>
                    <p>Adjust filters or create a new campaign.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="archived" className="mt-4">
            <Card className="shadow-lg">
              <CardContent className="p-4">
                {viewMode === 'list' ? (
                  renderListTable(visibleArchived, true)
                ) : (
                  renderGrid(visibleArchived, true)
                )}
                {visibleArchived.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <h3 className="font-semibold">No archived campaigns.</h3>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <CampaignTypeSelectionDialog
          open={isTypeSelectionOpen}
          onOpenChange={setIsTypeSelectionOpen}
          onSelect={handleCreateCampaign}
        />





      </div>
    </div>
  );
}