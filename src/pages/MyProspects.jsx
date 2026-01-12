import { useState, useEffect } from "react";
import { Prospect } from "@/api/entities";
import { auth } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Search,
    Filter,
    Download,
    MoreHorizontal,
    Phone,
    Mail,
    Calendar,
    User,
    RefreshCw,
    Loader2
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

export default function MyProspects() {
    const [prospects, setProspects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [currentUser, setCurrentUser] = useState(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const user = await auth.getCurrentUser();
            setCurrentUser(user);

            // Fetch prospects using the entity method which calls /api/prospects
            // The backend automatically filters by assignedAgentId for agents
            const data = await Prospect.list({ limit: 100 });
            // Note: Prospect.list usually returns { data: { prospects: [] } } or similar based on implementation
            // Let's assume standard response structure or handle if it returns array directly

            if (data && Array.isArray(data.prospects)) {
                setProspects(data.prospects);
            } else if (data && data.data && Array.isArray(data.data.prospects)) {
                setProspects(data.data.prospects);
            } else if (Array.isArray(data)) {
                setProspects(data);
            } else {
                setProspects([]);
            }
        } catch (error) {
            console.error("Error loading prospects:", error);
        } finally {
            setLoading(false);
        }
    };

    const filteredProspects = prospects.filter(p => {
        const searchLower = searchQuery.toLowerCase();
        return (
            p.firstName?.toLowerCase().includes(searchLower) ||
            p.lastName?.toLowerCase().includes(searchLower) ||
            p.email?.toLowerCase().includes(searchLower) ||
            p.phone?.includes(searchQuery)
        );
    });

    const getStatusColor = (status) => {
        switch (status) {
            case 'new': return 'bg-blue-100 text-blue-700 border-blue-200';
            case 'contacted': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
            case 'qualified': return 'bg-indigo-100 text-indigo-700 border-indigo-200';
            case 'proposal': return 'bg-purple-100 text-purple-700 border-purple-200';
            case 'negotiation': return 'bg-pink-100 text-pink-700 border-pink-200';
            case 'won': return 'bg-green-100 text-green-700 border-green-200'; // Renamed from close_won for consistency if needed, but display usually maps
            case 'close_won': return 'bg-green-100 text-green-700 border-green-200';
            case 'lost': return 'bg-red-100 text-red-700 border-red-200';
            case 'close_lost': return 'bg-red-100 text-red-700 border-red-200';
            default: return 'bg-gray-100 text-gray-700 border-gray-200';
        }
    };

    const formatStatus = (status) => {
        return status ? status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Unknown';
    };

    return (
        <div className="p-6 lg:p-8 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900">My Prospects</h1>
                    <p className="text-gray-500">Manage and track your assigned leads</p>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" className="h-9" onClick={loadData}>
                        <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button size="sm" className="h-9 bg-blue-600 hover:bg-blue-700">
                        <Download className="w-4 h-4 mr-2" />
                        Export
                    </Button>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-500">Total Assigned</p>
                            <h3 className="text-2xl font-bold text-gray-900 mt-1">{prospects.length}</h3>
                        </div>
                        <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center">
                            <User className="w-5 h-5 text-blue-600" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-500">Active Leads</p>
                            <h3 className="text-2xl font-bold text-gray-900 mt-1">
                                {prospects.filter(p => !['close_won', 'close_lost', 'rejected'].includes(p.status || p.leadStatus)).length}
                            </h3>
                        </div>
                        <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center">
                            <RefreshCw className="w-5 h-5 text-green-600" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-500">Conversion Rate</p>
                            <h3 className="text-2xl font-bold text-gray-900 mt-1">
                                {prospects.length > 0
                                    ? Math.round((prospects.filter(p => (p.status || p.leadStatus) === 'close_won').length / prospects.length) * 100)
                                    : 0}%
                            </h3>
                        </div>
                        <div className="w-10 h-10 bg-purple-50 rounded-full flex items-center justify-center">
                            <Download className="w-5 h-5 text-purple-600" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="border-gray-200 shadow-sm">
                <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-4 justify-between items-center">
                    <div className="relative w-full sm:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                            placeholder="Search prospects..."
                            className="pl-9 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <Button variant="outline" size="sm" className="w-full sm:w-auto text-gray-600">
                        <Filter className="w-4 h-4 mr-2" />
                        Filter
                    </Button>
                </div>

                <div className="relative overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                                <TableHead className="w-[250px]">Prospect Name</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Contact Info</TableHead>
                                <TableHead>Campaign</TableHead>
                                <TableHead>Assigned Date</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-32 text-center">
                                        <div className="flex flex-col items-center justify-center text-gray-500">
                                            <Loader2 className="w-6 h-6 animate-spin mb-2" />
                                            <p>Loading prospects...</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : filteredProspects.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-64 text-center">
                                        <div className="flex flex-col items-center justify-center text-gray-500">
                                            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                                                <User className="w-6 h-6 text-gray-400" />
                                            </div>
                                            <p className="text-lg font-medium text-gray-900">No prospects found</p>
                                            <p className="text-sm text-gray-500 max-w-xs mx-auto mt-1">
                                                {searchQuery
                                                    ? `No results matching "${searchQuery}"`
                                                    : "You haven't been assigned any prospects yet."}
                                            </p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredProspects.map((prospect) => (
                                    <TableRow key={prospect.id} className="group hover:bg-blue-50/30 transition-colors">
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-medium shadow-sm">
                                                    {prospect.firstName?.[0]}{prospect.lastName?.[0]}
                                                </div>
                                                <div>
                                                    <p className="font-medium text-gray-900">{prospect.firstName} {prospect.lastName}</p>
                                                    <p className="text-xs text-gray-500">{prospect.company || 'Individual'}</p>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={getStatusColor(prospect.status || prospect.leadStatus)}>
                                                {formatStatus(prospect.status || prospect.leadStatus)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="space-y-1">
                                                {prospect.email && (
                                                    <div className="flex items-center text-sm text-gray-600">
                                                        <Mail className="w-3.5 h-3.5 mr-2 text-gray-400" />
                                                        {prospect.email}
                                                    </div>
                                                )}
                                                {prospect.phone && (
                                                    <div className="flex items-center text-sm text-gray-600">
                                                        <Phone className="w-3.5 h-3.5 mr-2 text-gray-400" />
                                                        {prospect.phone}
                                                    </div>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="text-sm">
                                                <p className="font-medium text-gray-700">{prospect.campaign?.name || 'Unknown Campaign'}</p>
                                                <p className="text-xs text-gray-500">{prospect.leadSource}</p>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center text-sm text-gray-500">
                                                <Calendar className="w-3.5 h-3.5 mr-2 text-gray-400" />
                                                {format(new Date(prospect.createdAt), 'MMM d, yyyy')}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-gray-900">
                                                        <MoreHorizontal className="w-4 h-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                    <DropdownMenuItem onClick={() => { }}>View Details</DropdownMenuItem>
                                                    <DropdownMenuItem>Log Activity</DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem className="text-blue-600">Call Now</DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </Card>
        </div>
    );
}
