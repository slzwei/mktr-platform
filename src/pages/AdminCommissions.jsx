import { useMemo, useState } from"react";
import { useQuery } from"@tanstack/react-query";
import { Commission } from"@/api/entities";
import { useCurrentUser } from"@/hooks/queries/useUsersQuery";
import { Card, CardContent, CardHeader, CardTitle } from"@/components/ui/card";
import { Badge } from"@/components/ui/badge";
import { Input } from"@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from"@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from"@/components/ui/tabs";
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from"@/components/ui/table";
import {
 DollarSign,
 Users,
 Search,
 Filter,
 TrendingUp
} from"lucide-react";
import EmptyState from"@/components/common/EmptyState";

const statusColors = {
 pending:"bg-info/15 text-info border-info/30",
 approved:"bg-success/15 text-success border-success/30",
 paid:"bg-muted text-foreground border-border"};

export default function AdminCommissions() {
 const { data: user } = useCurrentUser();
 const { data: commissionsRaw, isLoading: loading } = useQuery({
 queryKey: ['commissions', 'list', { limit: 100 }],
 queryFn: () => Commission.list({ limit: 100 })
 });
 const commissions = Array.isArray(commissionsRaw) ? commissionsRaw : (commissionsRaw?.commissions || []);
 const [searchTerm, setSearchTerm] = useState("");
 const [statusFilter, setStatusFilter] = useState("all");

 const filteredCommissions = useMemo(() => {
 let items = commissions.slice();
 if (user?.role ==="agent") {
 items = items.filter(c => String(c.agentId) === String(user.id));
 }
 if (statusFilter !=="all") {
 items = items.filter(c => c.status === statusFilter);
 }
 if (searchTerm) {
 const q = searchTerm.toLowerCase();
 items = items.filter(c => {
 const agentName = [c.agent?.firstName, c.agent?.lastName].filter(Boolean).join("").toLowerCase();
 const agentEmail = (c.agent?.email ||"").toLowerCase();
 const fleetOwnerName = (c.fleetOwner?.full_name || c.fleet_owner_name ||"").toLowerCase();
 const fleetOwnerEmail = (c.fleetOwner?.email || c.fleet_owner_email ||"").toLowerCase();
 return agentName.includes(q) || agentEmail.includes(q) || fleetOwnerName.includes(q) || fleetOwnerEmail.includes(q);
 });
 }
 return items;
 }, [commissions, user, statusFilter, searchTerm]);

 const stats = useMemo(() => {
 const totalAmount = filteredCommissions.reduce((sum, c) => sum + Number(c.amount || 0), 0);
 const pendingAmount = filteredCommissions
 .filter(c => c.status !=="paid")
 .reduce((sum, c) => sum + Number(c.amount || 0), 0);
 return {
 totalAmount,
 totalCount: filteredCommissions.length,
 pendingAmount
 };
 }, [filteredCommissions]);

 const agentAggregates = useMemo(() => {
 const map = new Map();
 for (const c of filteredCommissions) {
 const agentId = c.agent?.id || c.agentId ||"unknown";
 const key = String(agentId);
 if (!map.has(key)) {
 map.set(key, {
 agent: c.agent || { id: key, firstName:"Unknown", lastName:"", email:""},
 total: 0,
 count: 0,
 byStatus: { pending: 0, approved: 0, paid: 0 }
 });
 }
 const agg = map.get(key);
 const amt = Number(c.amount || 0);
 agg.total += amt;
 agg.count += 1;
 if (c.status && agg.byStatus[c.status] !== undefined) agg.byStatus[c.status] += amt;
 }
 const arr = Array.from(map.values());
 return arr;
 }, [filteredCommissions]);

 const fleetOwnerAggregates = useMemo(() => {
 const map = new Map();
 for (const c of filteredCommissions) {
 const ownerId = c.fleet_owner_id || c.fleetOwner?.id || c.fleetOwnerId || c.car?.fleet_owner_id ||"unknown";
 const key = String(ownerId);
 if (!map.has(key)) {
 map.set(key, {
 owner: c.fleetOwner || { id: key, full_name: c.fleet_owner_name ||"Unknown", email: c.fleet_owner_email ||""},
 total: 0,
 count: 0,
 byStatus: { pending: 0, approved: 0, paid: 0 }
 });
 }
 const agg = map.get(key);
 const amt = Number(c.amount_fleet || 0);
 agg.total += amt;
 agg.count += 1;
 if (c.status && agg.byStatus[c.status] !== undefined) agg.byStatus[c.status] += amt;
 }
 return Array.from(map.values());
 }, [filteredCommissions]);

 if (loading) {
 return (
 <div className="p-6 lg:p-8">
 <div className="animate-pulse space-y-6">
 <div className="h-8 bg-muted rounded w-64"></div>
 <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
 {Array(4).fill(0).map((_, i) => (
 <div key={i} className="h-32 bg-muted rounded-xl"></div>
 ))}
 </div>
 <div className="h-96 bg-muted rounded-xl"></div>
 </div>
 </div>
 );
 }

 // Role gating handled by ProtectedRoute; avoid double-deny here

 return (
 <div className="p-6 lg:p-8 min-h-screen bg-background">
 <div className="max-w-7xl mx-auto">
 <div className="flex justify-between items-center mb-8">
 <div>
 <h1 className="text-3xl font-bold text-foreground">Commission Management</h1>
 <p className="text-muted-foreground mt-1">Track and manage agent and fleet owner commissions</p>
 </div>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
 <Card>
 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
 <CardTitle className="text-sm font-medium">Total Amount</CardTitle>
 <DollarSign className="h-4 w-4 text-muted-foreground"/>
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-bold">${stats.totalAmount.toFixed(2)}</div>
 </CardContent>
 </Card>
 <Card>
 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
 <CardTitle className="text-sm font-medium">Total Records</CardTitle>
 <TrendingUp className="h-4 w-4 text-muted-foreground"/>
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-bold">{stats.totalCount}</div>
 </CardContent>
 </Card>
 <Card>
 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
 <CardTitle className="text-sm font-medium">Pending Payouts</CardTitle>
 <Users className="h-4 w-4 text-muted-foreground"/>
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-bold">${stats.pendingAmount.toFixed(2)}</div>
 </CardContent>
 </Card>
 </div>

 <Card className="mb-6">
 <CardHeader>
 <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center">
 <div className="relative flex-1 max-w-md">
 <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5"/>
 <Input
 placeholder="Search agents or fleet owners..." value={searchTerm}
 onChange={(e) => setSearchTerm(e.target.value)}
 className="pl-10" />
 </div>
 <div className="flex items-center gap-2">
 <Filter className="w-4 h-4 text-muted-foreground"/>
 <Select value={statusFilter} onValueChange={setStatusFilter}>
 <SelectTrigger className="w-40">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All Status</SelectItem>
 <SelectItem value="pending">Pending</SelectItem>
 <SelectItem value="approved">Approved</SelectItem>
 <SelectItem value="paid">Paid</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>
 </CardHeader>
 </Card>

 <Tabs defaultValue="agents" className="space-y-6">
 <TabsList>
 <TabsTrigger value="agents">Agent Commissions</TabsTrigger>
 <TabsTrigger value="fleet_owners">Fleet Owner Commissions</TabsTrigger>
 </TabsList>

 <TabsContent value="agents">
 <Card className="shadow-lg">
 <CardHeader>
 <CardTitle className="flex items-center gap-2">
 <Users className="w-6 h-6"/>
 Agent Commission Summary ({agentAggregates.length})
 </CardTitle>
 </CardHeader>
 <CardContent className="p-0">
 <div className="overflow-x-auto">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted">
 <TableHead>Agent</TableHead>
 <TableHead>Contact</TableHead>
 <TableHead>Total Earned</TableHead>
 <TableHead>Commissions</TableHead>
 <TableHead>Status Breakdown</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {agentAggregates.map((item) => {
 const fullName = [item.agent.firstName, item.agent.lastName].filter(Boolean).join("") ||"N/A";
 return (
 <TableRow key={item.agent.id} className="hover:bg-muted">
 <TableCell>
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 bg-info/15 text-primary rounded-full flex items-center justify-center font-semibold">
 {(fullName ||"A").charAt(0).toUpperCase()}
 </div>
 <div>
 <p className="font-semibold text-foreground">{fullName}</p>
 <p className="text-sm text-muted-foreground">ID: {String(item.agent.id).slice(-8)}</p>
 </div>
 </div>
 </TableCell>
 <TableCell>
 <div className="text-sm">
 <p className="text-foreground">{item.agent.email}</p>
 </div>
 </TableCell>
 <TableCell>
 <span className="text-lg font-bold text-success">${item.total.toFixed(2)}</span>
 </TableCell>
 <TableCell>
 <span className="font-semibold">{item.count}</span>
 </TableCell>
 <TableCell>
 <div className="flex gap-1">
 {item.byStatus.pending > 0 && (
 <Badge variant="outline" className={statusColors.pending}>
 ${item.byStatus.pending.toFixed(2)}
 </Badge>
 )}
 {item.byStatus.approved > 0 && (
 <Badge variant="outline" className={statusColors.approved}>
 ${item.byStatus.approved.toFixed(2)}
 </Badge>
 )}
 {item.byStatus.paid > 0 && (
 <Badge variant="outline" className={statusColors.paid}>
 ${item.byStatus.paid.toFixed(2)}
 </Badge>
 )}
 </div>
 </TableCell>
 </TableRow>
 );
 })}
 </TableBody>
 </Table>

 {agentAggregates.length === 0 && (
 <EmptyState
 icon={Users}
 title="No agent commissions found"
 description={searchTerm ? 'Try adjusting your search criteria.' : 'No commissions have been generated yet.'}
 />
 )}
 </div>
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="fleet_owners">
 <Card className="shadow-lg">
 <CardHeader>
 <CardTitle className="flex items-center gap-2">
 <Users className="w-6 h-6"/>
 Fleet Owner Commission Summary ({fleetOwnerAggregates.length})
 </CardTitle>
 </CardHeader>
 <CardContent className="p-0">
 <div className="overflow-x-auto">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted">
 <TableHead>Fleet Owner</TableHead>
 <TableHead>Contact</TableHead>
 <TableHead>Total Earned</TableHead>
 <TableHead>Commissions</TableHead>
 <TableHead>Status Breakdown</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {fleetOwnerAggregates.map((item) => {
 const fullName = item.owner.full_name || 'N/A';
 return (
 <TableRow key={item.owner.id} className="hover:bg-muted">
 <TableCell>
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 bg-success/15 text-success rounded-full flex items-center justify-center font-semibold">
 {(fullName || 'F').charAt(0).toUpperCase()}
 </div>
 <div>
 <p className="font-semibold text-foreground">{fullName}</p>
 <p className="text-sm text-muted-foreground">ID: {String(item.owner.id).slice(-8)}</p>
 </div>
 </div>
 </TableCell>
 <TableCell>
 <div className="text-sm">
 <p className="text-foreground">{item.owner.email}</p>
 </div>
 </TableCell>
 <TableCell>
 <span className="text-lg font-bold text-success">${item.total.toFixed(2)}</span>
 </TableCell>
 <TableCell>
 <span className="font-semibold">{item.count}</span>
 </TableCell>
 <TableCell>
 <div className="flex gap-1">
 {item.byStatus.pending > 0 && (
 <Badge variant="outline" className={statusColors.pending}>
 ${item.byStatus.pending.toFixed(2)}
 </Badge>
 )}
 {item.byStatus.approved > 0 && (
 <Badge variant="outline" className={statusColors.approved}>
 ${item.byStatus.approved.toFixed(2)}
 </Badge>
 )}
 {item.byStatus.paid > 0 && (
 <Badge variant="outline" className={statusColors.paid}>
 ${item.byStatus.paid.toFixed(2)}
 </Badge>
 )}
 </div>
 </TableCell>
 </TableRow>
 );
 })}
 </TableBody>
 </Table>

 {fleetOwnerAggregates.length === 0 && (
 <EmptyState
 icon={Users}
 title="No fleet owner commissions found"
 description={searchTerm ? 'Try adjusting your search criteria.' : 'No commissions have been generated yet.'}
 />
 )}
 </div>
 </CardContent>
 </Card>
 </TabsContent>
 </Tabs>
 </div>
 </div>
 );
}