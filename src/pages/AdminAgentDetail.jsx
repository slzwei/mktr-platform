import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { User, Prospect, Campaign } from "@/api/entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
    ChevronLeft,
    ChevronRight,
    Search,
    ArrowLeft,
    User as UserIcon,
    Phone,
    Mail,
    Calendar,
    Loader2
} from "lucide-react";
import { format } from "date-fns";
import ProspectDetails from "@/components/prospects/ProspectDetails";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

const statusStyles = {
    new: "bg-blue-50 text-blue-700 border-blue-200",
    contacted: "bg-amber-50 text-amber-700 border-amber-200",
    meeting: "bg-violet-50 text-violet-700 border-violet-200",
    close_won: "bg-emerald-50 text-emerald-700 border-emerald-200",
    won: "bg-emerald-50 text-emerald-700 border-emerald-200",
    close_lost: "bg-rose-50 text-rose-700 border-rose-200",
    lost: "bg-rose-50 text-rose-700 border-rose-200",
    rejected: "bg-slate-50 text-slate-700 border-slate-200",
    negotiating: "bg-pink-100 text-pink-700 border-pink-200",
    qualified: "bg-indigo-100 text-indigo-700 border-indigo-200"
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

    return {
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        name,
        phone: p.phone || "",
        email: p.email || "",
        company: p.company || "",
        status,
        leadStatus: status,
        created_date: createdDate,
        createdAt: createdDate,
        leadSource: source,
        campaign_id: p.campaignId || p.campaign_id,
        campaign: p.campaign,
        notes: p.notes,
        assignedAgentId: p.assignedAgentId
    };
}

export default function AdminAgentDetail() {
    const { agentId } = useParams();
    const [agent, setAgent] = useState(null);
    const [prospects, setProspects] = useState([]);
    const [totalProspects, setTotalProspects] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadingAgent, setLoadingAgent] = useState(true);
    const [campaigns, setCampaigns] = useState([]);
    const [selectedProspect, setSelectedProspect] = useState(null);
    const { toast } = useToast();

    const [pagination, setPagination] = useState({
        page: 1,
        limit: 25,
        totalPages: 1
    });

    const [filters, setFilters] = useState({
        search: "",
        status: "all"
    });

    useEffect(() => {
        async function fetchAgent() {
            if (!agentId) return;
            try {
                setLoadingAgent(true);
                const agentData = await User.get(agentId);
                setAgent(agentData);
            } catch (error) {
                console.error("Error fetching agent:", error);
                toast({
                    title: "Error",
                    description: "Failed to load agent details",
                    variant: "destructive"
                });
            } finally {
                setLoadingAgent(false);
            }
        }
        fetchAgent();
        // Load campaigns for details dialog
        Campaign.list({ limit: 1000 }).then(data => {
            const list = Array.isArray(data) ? data : (data.campaigns || []);
            setCampaigns(list);
        });
    }, [agentId]);

    useEffect(() => {
        fetchProspects();
    }, [agentId, pagination.page, pagination.limit, filters]);


    async function fetchProspects() {
        if (!agentId) return;
        try {
            setLoading(true);
            const params = {
                assignedAgentId: agentId,
                page: pagination.page,
                limit: pagination.limit
            };

            if (filters.search) params.search = filters.search;
            if (filters.status !== "all") params.leadStatus = filters.status;

            const response = await Prospect.list(params);

            let list = [];
            let count = 0;
            let totalPages = 1;

            if (response && response.prospects) {
                list = response.prospects;
                count = response.pagination?.totalItems || list.length;
                totalPages = response.pagination?.totalPages || 1;
            } else if (response && response.data) {
                list = response.data.prospects || [];
                count = response.data.pagination?.totalItems || list.length;
                totalPages = response.data.pagination?.totalPages || 1;
            } else if (Array.isArray(response)) {
                list = response;
                count = list.length;
            }

            setProspects(list.map(normalizeProspect));
            setTotalProspects(count);
            setPagination(prev => ({ ...prev, totalPages }));

        } catch (error) {
            console.error("Error fetching prospects:", error);
            toast({
                title: "Error",
                description: "Failed to load prospects",
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    }

    const handlePageChange = (newPage) => {
        setPagination(prev => ({ ...prev, page: newPage }));
    };

    const handleStatusUpdate = async (prospectId, newStatus) => {
        try {
            await Prospect.update(prospectId, { leadStatus: newStatus });
            if (selectedProspect?.id === prospectId) {
                setSelectedProspect(prev => ({ ...prev, leadStatus: newStatus, status: newStatus }));
            }
            fetchProspects(); // Refresh list
        } catch (error) {
            console.error("Error updating status:", error);
            toast({
                title: "Error",
                description: "Failed to update status",
                variant: "destructive"
            });
        }
    };

    if (loadingAgent) {
        return (
            <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    if (!agent) {
        return (
            <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50">
                <div className="max-w-[1600px] mx-auto text-center py-12">
                    <h2 className="text-xl font-semibold text-gray-900">Agent not found</h2>
                    <Link to="/AdminAgents">
                        <Button variant="outline" className="mt-4">Back to Agents</Button>
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 lg:p-8 min-h-screen bg-gray-50/50">
            <div className="max-w-[1600px] mx-auto space-y-6">

                {/* Header */}
                <div>
                    <Link to="/AdminAgents" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-900 mb-4 transition-colors">
                        <ArrowLeft className="w-4 h-4 mr-1" />
                        Back to Agents
                    </Link>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-3">
                                {agent.firstName} {agent.lastName}
                                <Badge variant="outline" className="font-normal text-sm bg-gray-100 text-gray-600">
                                    ID: {agent.id.slice(-8)}
                                </Badge>
                            </h1>
                            <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
                                <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> {agent.email}</span>
                                {agent.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {agent.phone}</span>}
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {/* Can add agent specific actions here later */}
                        </div>
                    </div>
                </div>

                {/* Filters */}
                <Card className="border-gray-200/50 shadow-sm bg-white">
                    <CardHeader className="border-b border-gray-100 p-4">
                        <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
                            <div className="relative w-full sm:w-72">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <Input
                                    placeholder="Search leads..."
                                    className="pl-9"
                                    value={filters.search}
                                    onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value, page: 1 }))} // Reset to page 1 on search
                                />
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <Select
                                    value={filters.status}
                                    onValueChange={(val) => setFilters(prev => ({ ...prev, status: val, page: 1 }))}
                                >
                                    <SelectTrigger className="w-[180px]">
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Statuses</SelectItem>
                                        {Object.entries(statusLabels).map(([key, label]) => (
                                            <SelectItem key={key} value={key}>{label}</SelectItem>
                                        ))}
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
                                        <TableHead className="py-3 px-6">Prospect</TableHead>
                                        <TableHead className="py-3 px-6">Campaign</TableHead>
                                        <TableHead className="py-3 px-6">Status</TableHead>
                                        <TableHead className="py-3 px-6">Source</TableHead>
                                        <TableHead className="py-3 px-6">Date Assigned</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-24 text-center">
                                                <div className="flex justify-center items-center gap-2 text-gray-500">
                                                    <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : prospects.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-32 text-center text-gray-500">
                                                No prospects found for this agent.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        prospects.map(prospect => (
                                            <TableRow
                                                key={prospect.id}
                                                className="hover:bg-gray-50/50 cursor-pointer group"
                                                onClick={() => setSelectedProspect(prospect)}
                                            >
                                                <TableCell className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-bold uppercase">
                                                            {prospect.firstName?.[0] || <UserIcon className="w-4 h-4" />}
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                                                                {prospect.name}
                                                            </p>
                                                            <p className="text-xs text-gray-500">{prospect.company}</p>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="px-6 py-4">
                                                    <span className="text-sm text-gray-700">{prospect.campaign?.name || 'Unknown'}</span>
                                                </TableCell>
                                                <TableCell className="px-6 py-4">
                                                    <Badge variant="outline" className={statusStyles[prospect.leadStatus] || "bg-gray-100"}>
                                                        {statusLabels[prospect.leadStatus] || prospect.leadStatus}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="px-6 py-4">
                                                    <code className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200 uppercase">
                                                        {prospect.leadSource}
                                                    </code>
                                                </TableCell>
                                                <TableCell className="px-6 py-4 text-sm text-gray-500">
                                                    <div className="flex items-center gap-1.5">
                                                        <Calendar className="w-3.5 h-3.5 text-gray-400" />
                                                        {format(new Date(prospect.createdAt), 'MMM d, yyyy')}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Pagination */}
                        {pagination.totalPages > 1 && (
                            <div className="border-t border-gray-100 p-4 flex items-center justify-between bg-gray-50/30">
                                <span className="text-sm text-gray-500">
                                    Page {pagination.page} of {pagination.totalPages} ({totalProspects} records)
                                </span>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handlePageChange(pagination.page - 1)}
                                        disabled={pagination.page <= 1}
                                    >
                                        <ChevronLeft className="w-4 h-4" /> Previous
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handlePageChange(pagination.page + 1)}
                                        disabled={pagination.page >= pagination.totalPages}
                                    >
                                        Next <ChevronRight className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Detail Dialog */}
                <Dialog open={!!selectedProspect} onOpenChange={() => setSelectedProspect(null)}>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0">
                        <DialogHeader className="px-6 py-4 border-b border-gray-100">
                            <DialogTitle>Prospect Details</DialogTitle>
                        </DialogHeader>
                        {selectedProspect && (
                            <div className="flex-1 overflow-y-auto p-6">
                                <ProspectDetails
                                    prospect={selectedProspect}
                                    campaigns={campaigns}
                                    onStatusUpdate={handleStatusUpdate}
                                    onClose={() => setSelectedProspect(null)}
                                    userRole="admin"
                                    onEdited={fetchProspects}
                                />
                            </div>
                        )}
                    </DialogContent>
                </Dialog>

            </div>
        </div>
    );
}
