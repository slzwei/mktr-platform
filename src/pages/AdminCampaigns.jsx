import { useState, useCallback } from"react";
import { useCampaignsList, useArchiveCampaign, useRestoreCampaign, useDeleteCampaign } from"@/hooks/queries/useCampaignsQuery";
import { ConfirmDialog } from"@/components/ConfirmDialog";
import { useCurrentUser } from"@/hooks/queries/useUsersQuery";
import { Card, CardContent, CardHeader, CardTitle } from"@/components/ui/card";
import { Button } from"@/components/ui/button";
import { Badge } from"@/components/ui/badge";
import { Input } from"@/components/ui/input";
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue
} from"@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from"@/components/ui/tabs";
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuTrigger
} from"@/components/ui/dropdown-menu";
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow
} from"@/components/ui/table";
import { Link } from"react-router-dom";
import { customerLeadCaptureUrl, resolveCustomerHost } from"@/lib/brand";
import { format, parseISO } from"date-fns";
import {
 Plus,
 Edit,
 Copy,
 Link as LinkIcon,
 Palette,
 Archive,
 RotateCcw,
 Trash2,
 MoreVertical,
 Grid as GridIcon,
 List as ListIcon,
 Search,
 Car,
 QrCode,
 Sparkles,
 ClipboardCheck
} from"lucide-react";

import CampaignTypeSelectionDialog from"../components/campaigns/CampaignTypeSelectionDialog";
import PageHeader from"@/components/common/PageHeader";
import EmptyState from"@/components/common/EmptyState";


import { useNavigate } from"react-router-dom";


export default function AdminCampaigns() {
 const navigate = useNavigate();
 const { data: user } = useCurrentUser();
 const { data: campaignData, isLoading: loading } = useCampaignsList({ sort: '-created_date', limit: 100 });
 const archiveMutation = useArchiveCampaign();
 const restoreMutation = useRestoreCampaign();
 const deleteMutation = useDeleteCampaign();

 const campaigns = campaignData?.active ?? [];
 const archivedCampaigns = campaignData?.archived ?? [];

 const [selectedCampaign, setSelectedCampaign] = useState(null);
 const [copiedId, setCopiedId] = useState(null);
 const [activeTab, setActiveTab] = useState("active");
 const [viewMode, setViewMode] = useState("list"); // list | grid
 const [searchTerm, setSearchTerm] = useState("");
 const [statusFilter, setStatusFilter] = useState("all"); // all | active | inactive
 const [isTypeSelectionOpen, setIsTypeSelectionOpen] = useState(false);
 const [confirmDialog, setConfirmDialog] = useState({ open: false, title:"", description:"", onConfirm: null, destructive: false });

 const openConfirm = useCallback(({ title, description, onConfirm, destructive = true }) => {
 setConfirmDialog({ open: true, title, description, onConfirm, destructive });
 }, []);

 const closeConfirm = useCallback(() => {
 setConfirmDialog(prev => ({ ...prev, open: false }));
 }, []);




 const handleCreateCampaign = (type) => {
 setIsTypeSelectionOpen(false);
 // Flag-gated: route new campaigns into the unified workspace when enabled,
 // else the classic create form. Ships dark (flag off) until set on the
 // mktr-platform static site.
 const workspace = import.meta.env.VITE_CAMPAIGN_WORKSPACE_ENABLED === 'true';
 // lucky_draw only exists as a workspace create flow (the classic form cannot
 // arm design_config.luckyDraw) — route it there regardless of the flag.
 navigate(workspace || type === 'lucky_draw' ? `/admin/campaigns/workspace?type=${type}` : `/admin/campaigns/new?type=${type}`);
 };

 const handleCopyLink = (campaign) => {
 // Copy the campaign's customer-facing URL on its chosen host (redeem.sg by
 // default, mktr.sg when design_config.customerHost === 'mktr') so recipients
 // open directly on the right brand with no redirect hop.
 const host = resolveCustomerHost(campaign?.design_config?.customerHost);
 const campaignUrl = customerLeadCaptureUrl(campaign.id, {}, host);

 navigator.clipboard.writeText(campaignUrl).then(() => {
 setCopiedId(campaign.id);
 setTimeout(() => setCopiedId(null), 2000);
 });
 };

 const handleArchiveCampaign = (campaignId) => {
 openConfirm({
 title:"Archive Campaign",
 description:"Are you sure you want to archive this campaign? It will be moved to the archived campaigns section.",
 destructive: false,
 onConfirm: async () => {
 try {
 await archiveMutation.mutateAsync(campaignId);
 } catch (error) {
 console.error("Failed to archive campaign:", error);
 }
 closeConfirm();
 },
 });
 };

 const handleRestoreCampaign = async (campaignId) => {
 try {
 await restoreMutation.mutateAsync(campaignId);
 } catch (error) {
 console.error("Failed to restore campaign:", error);
 }
 };

 const handlePermanentDelete = (campaignId) => {
 openConfirm({
 title:"Permanently Delete Campaign",
 description:"Are you sure you want to PERMANENTLY DELETE this campaign? This action cannot be undone and will delete all associated data.",
 onConfirm: async () => {
 try {
 await deleteMutation.mutateAsync(campaignId);
 } catch (error) {
 console.error("Failed to delete campaign:", error);
 }
 closeConfirm();
 },
 });
 };

 if (loading) {
 return (
 <div className="p-6 lg:p-8">
 <div className="animate-pulse space-y-6">
 <div className="h-8 bg-muted rounded w-64"></div>
 <div className="h-96 bg-muted rounded-xl"></div>
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
 if (statusFilter !=="all") {
 const wantActive = statusFilter ==="active";
 result = result.filter((c) => Boolean(c.is_active) === wantActive);
 }
 return result;
 };

 const visibleActive = applyFilters(campaigns);
 const visibleArchived = applyFilters(archivedCampaigns);

 const renderActionsMenu = (c) => (
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" aria-label={`Actions for ${c.name || 'campaign'}`}>
 <MoreVertical className="w-4 h-4" aria-hidden="true" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end">
 <DropdownMenuItem onClick={() => handleCopyLink(c)}>
 {copiedId === c.id ? <Copy className="w-4 h-4 text-success"/> : <LinkIcon className="w-4 h-4"/>}
 <span className="ml-2">{copiedId === c.id ? 'Copied!' : 'Copy Link'}</span>
 </DropdownMenuItem>
 <DropdownMenuItem asChild>
 <Link to={`/admin/campaigns/${c.id}/workspace?tab=design`} className="flex items-center">
 <Palette className="w-4 h-4"/>
 <span className="ml-2">Design</span>
 </Link>
 </DropdownMenuItem>

 <DropdownMenuItem asChild>
 <Link to={import.meta.env.VITE_CAMPAIGN_WORKSPACE_ENABLED === 'true' ? `/admin/campaigns/${c.id}/workspace?tab=details` : `/admin/campaigns/${c.id}/edit`}>
 <Edit className="w-4 h-4"/>
 <span className="ml-2">Edit</span>
 </Link>
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => handleArchiveCampaign(c.id)} className="text-warning">
 <Archive className="w-4 h-4"/>
 <span className="ml-2">Archive</span>
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 );

 // helper for type icon
 const getTypeIcon = (type) => {
 if (type === 'brand_awareness') return <Car className="w-4 h-4 text-primary"/>;
 if (type === 'quiz') return <Sparkles className="w-4 h-4 text-warning"/>;
 if (type === 'guided_review') return <ClipboardCheck className="w-4 h-4 text-primary"/>;
 return <QrCode className="w-4 h-4 text-success"/>;
 };

 const getTypeLabel = (type) => {
 if (type === 'brand_awareness') return 'PHV';
 if (type === 'quiz') return 'Quiz';
 if (type === 'guided_review') return 'Guided Review';
 return 'Regular';
 };

 const renderListTable = (list, archived = false) => (

 <div className="overflow-x-auto">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted">
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
 <TableRow key={campaign.id} className="hover:bg-muted">
 <TableCell className="font-semibold">
 {archived ? (
 <span className="text-foreground">{campaign.name}</span>
 ) : (
 <Link
 to={`/AdminProspects?campaign=${campaign.id}`}
 className="text-primary hover:underline hover:text-info" >
 {campaign.name}
 </Link>
 )}
 </TableCell>
 {!archived && (
 <TableCell>
 <Badge
 variant={campaign.is_active ?"default":"outline"}
 className={
 campaign.is_active
 ?"bg-success/15 text-success" :"bg-destructive/15 text-destructive" }
 >
 {campaign.is_active ?"Active":"Inactive"}
 </Badge>
 </TableCell>
 )}
 <TableCell>
 <div className="flex items-center gap-2" title={`${getTypeLabel(campaign.type)} Campaign`}>
 {getTypeIcon(campaign.type)}
 <span className="text-sm text-muted-foreground capitalize">
 {getTypeLabel(campaign.type)}
 </span>
 </div>
 </TableCell>
 <TableCell>
 {campaign.start_date && campaign.end_date ? (
 <>
 {format(parseISO(campaign.start_date),"dd MMM yyyy")} - {format(parseISO(campaign.end_date),"dd MMM yyyy")}
 </>
 ) : (
 <span className="text-muted-foreground">Not set</span>
 )}
 </TableCell>
 <TableCell>
 {campaign.min_age} - {campaign.max_age || 'Any'}
 </TableCell>

 <TableCell className="flex items-center gap-2">
 {archived ? (
 <div className="flex items-center gap-2">
 <Button
 variant="outline" size="sm" onClick={() => handleRestoreCampaign(campaign.id)}
 className="text-success hover:text-success" >
 <RotateCcw className="w-4 h-4 mr-2"/>
 Restore
 </Button>
 <Button
 variant="outline" size="sm" onClick={() => handlePermanentDelete(campaign.id)}
 className="text-destructive hover:text-destructive" >
 <Trash2 className="w-4 h-4 mr-2"/>
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
 <Badge variant="outline" className="bg-muted text-foreground">Archived</Badge>
 ) : (
 <Badge className={c.is_active ?"bg-success/15 text-success":"bg-destructive/15 text-destructive"} variant={c.is_active ?"default":"outline"}>
 {c.is_active ?"Active":"Inactive"}
 </Badge>
 )}
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="text-sm text-muted-foreground">
 <div>
 <span className="text-muted-foreground">Duration:</span>{""}
 {c.start_date && c.end_date ? (
 `${format(parseISO(c.start_date), 'dd MMM')} – ${format(parseISO(c.end_date), 'dd MMM yyyy')}`
 ) : (
 <span className="text-muted-foreground">Not set</span>
 )}
 </div>
 <div>
 <span className="text-muted-foreground">Age:</span> {c.min_age} – {c.max_age || 'Any'}
 </div>

 </div>
 <div className="flex items-center gap-2 text-sm text-muted-foreground">
 {getTypeIcon(c.type)}
 <span>{getTypeLabel(c.type)} Campaign</span>
 </div>
 <div className="flex items-center justify-between pt-1">
 {archived ? (
 <div className="flex gap-2">
 <Button size="sm" variant="outline" onClick={() => handleRestoreCampaign(c.id)}>
 <RotateCcw className="w-4 h-4 mr-2"/>
 Restore
 </Button>
 <Button size="sm" variant="outline" className="text-destructive" onClick={() => handlePermanentDelete(c.id)}>
 <Trash2 className="w-4 h-4 mr-2"/>
 Delete
 </Button>
 </div>
 ) : (
 <div className="flex items-center gap-2">
 <Button size="sm" variant="outline" onClick={() => handleCopyLink(c)}>
 {copiedId === c.id ? <Copy className="w-4 h-4 mr-2 text-success"/> : <LinkIcon className="w-4 h-4 mr-2"/>}
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
 <div className="col-span-full">
 <EmptyState
 icon={Search}
 title="No campaigns found" description="Adjust filters, or create a new campaign to get started." />
 </div>
 )}
 </div>
 );

 return (
 <div className="p-6 lg:p-8 min-h-screen bg-background">
 <div className="max-w-7xl mx-auto">
 <PageHeader
 className="mb-6" title="Campaign Management" description="Create and manage your marketing campaigns." actions={
 <Button onClick={() => setIsTypeSelectionOpen(true)} className="bg-primary hover:bg-primary/90">
 <Plus className="w-5 h-5 mr-2"/>
 Create Campaign
 </Button>
 }
 />

 {/* quick stats */}
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
 <Card className="border border-border shadow-none">
 <CardContent className="py-4">
 <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Active</div>
 <div className="text-2xl font-semibold text-foreground tabular-nums mt-1">{campaigns.filter(c => c.is_active).length}</div>
 </CardContent>
 </Card>
 <Card className="border border-border shadow-none">
 <CardContent className="py-4">
 <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Inactive</div>
 <div className="text-2xl font-semibold text-foreground tabular-nums mt-1">{campaigns.filter(c => !c.is_active).length}</div>
 </CardContent>
 </Card>
 <Card className="border border-border shadow-none">
 <CardContent className="py-4">
 <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Archived</div>
 <div className="text-2xl font-semibold text-foreground tabular-nums mt-1">{archivedCampaigns.length}</div>
 </CardContent>
 </Card>
 </div>

 {/* controls */}
 <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
 <div className="flex items-center gap-2 w-full lg:w-auto">
 <div className="relative w-full lg:w-80">
 <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
 <Input
 placeholder="Search campaigns..." className="pl-9" value={searchTerm}
 onChange={(e) => setSearchTerm(e.target.value)}
 />
 </div>
 <Select value={statusFilter} onValueChange={setStatusFilter}>
 <SelectTrigger className="w-36">
 <SelectValue placeholder="Status"/>
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
 <ListIcon className="w-4 h-4 mr-2"/>
 List
 </Button>
 <Button
 variant={viewMode === 'grid' ? 'default' : 'outline'}
 onClick={() => setViewMode('grid')}
 >
 <GridIcon className="w-4 h-4 mr-2"/>
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
 <Card className="border border-border shadow-none">
 <CardContent className="p-4">
 {visibleActive.length === 0 ? (
 <EmptyState
 icon={Search}
 title="No campaigns found" description="Adjust filters, or create a new campaign to get started." />
 ) : viewMode === 'list' ? (
 renderListTable(visibleActive)
 ) : (
 renderGrid(visibleActive)
 )}
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="archived" className="mt-4">
 <Card className="border border-border shadow-none">
 <CardContent className="p-4">
 {visibleArchived.length === 0 ? (
 <EmptyState
 icon={Search}
 title="No archived campaigns" description="Archived campaigns will show up here." />
 ) : viewMode === 'list' ? (
 renderListTable(visibleArchived, true)
 ) : (
 renderGrid(visibleArchived, true)
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

 <ConfirmDialog
 open={confirmDialog.open}
 onOpenChange={(open) => { if (!open) closeConfirm(); }}
 title={confirmDialog.title}
 description={confirmDialog.description}
 onConfirm={confirmDialog.onConfirm}
 confirmText={confirmDialog.destructive ?"Delete":"Continue"}
 destructive={confirmDialog.destructive}
 />


 </div>
 </div>
 );
}
