import { useState } from"react";
import { useQueryClient } from"@tanstack/react-query";
import { useAuthStore } from"@/stores/authStore";
import { useDashboardData } from"@/hooks/queries/useDashboardQuery";
import { Button } from"@/components/ui/button";
import { Link } from"react-router-dom";
import { Plus, Download, Users, TrendingUp, DollarSign, Car as CarIcon, Eye } from"lucide-react";

import DashboardShell from"../components/dashboard/DashboardShell";
import DashboardHeader from"../components/dashboard/DashboardHeader";
import ResponsiveStatsGrid from"../components/dashboard/ResponsiveStatsGrid";
import DashboardCharts from"../components/dashboard/DashboardCharts";
import RecentActivity from"../components/dashboard/RecentActivity";
import TopPerformers from"../components/dashboard/TopPerformers";
import AttentionNeeded from"../components/dashboard/AttentionNeeded";

function buildAdminCards(stats) {
 const { cars, overview } = stats;

 const activeCampaigns = overview.campaignsActive;
 const totalCampaigns = overview.campaignsTotal;
 const campaignActivityRate = totalCampaigns > 0 ? Math.round((activeCampaigns / totalCampaigns) * 100) : 0;

 const totalRevenue = overview.commissionsTotal;
 const totalProspects = overview.prospectsTotal;

 return [
 {
 title:"Total Revenue",
 value: `$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
 icon: DollarSign,
 trend:"N/A",
 trendUp: true,
 description:"all time",
 iconColor:"text-success",
 iconBg:"bg-success/10",
 linkTo:"/AdminCommissions",
 },
 {
 title:"Active Campaigns",
 value: activeCampaigns,
 icon: TrendingUp,
 trend: `${campaignActivityRate}%`,
 trendUp: true,
 description:"active rate",
 iconColor:"text-primary",
 iconBg:"bg-primary/10",
 linkTo:"/AdminCampaigns",
 },
 {
 title:"Total Prospects",
 value: totalProspects.toLocaleString(),
 icon: Users,
 trend: `+${overview.newProspects || 0}`,
 trendUp: true,
 description:"new this period",
 iconColor:"text-plum",
 iconBg:"bg-plum/10",
 linkTo:"/AdminProspects",
 },
 {
 title:"Fleet Size",
 value: overview.fleetTotalCars ?? cars.length,
 icon: CarIcon,
 trend:"Active",
 trendUp: true,
 description:"vehicles registered",
 iconColor:"text-warning",
 iconBg:"bg-warning/10",
 linkTo:"/AdminFleet",
 },
 {
 title:"Ad Impressions",
 value: (overview.impressionsToday || 0).toLocaleString(),
 icon: Eye,
 trend:"Today",
 trendUp: true,
 description:"views delivered",
 iconColor:"text-plum",
 iconBg:"bg-plum/10",
 },
 ];
}

export default function AdminDashboard() {
 const user = useAuthStore((s) => s.user);
 const queryClient = useQueryClient();
 const [period, setPeriod] = useState("30d");

 const {
 prospects,
 campaigns,
 commissions,
 cars,
 overview: rawOverview,
 isLoading: loading,
 error: queryError,
 } = useDashboardData(period, !!user);

 const error = queryError?.message || null;

 // The overview endpoint returns stats keyed by category.
 // Accept both { stats: { ... } } and flat { prospects, campaigns, ... } shapes.
 const ov = rawOverview?.stats || rawOverview || {};
 const overview = {
 prospectsTotal: ov.prospects?.total || 0,
 newProspects: ov.prospects?.new || 0,
 campaignsTotal: ov.campaigns?.total || 0,
 campaignsActive: ov.campaigns?.active || 0,
 commissionsTotal: Number(ov.commissions?.total || 0),
 impressionsToday: ov.impressions?.today || 0,
 fleetTotalCars: ov.fleet?.totalCars ?? null,
 };

 const stats = { prospects, campaigns, commissions, cars, overview };

 const handlePeriodChange = (value) => {
 setPeriod(value);
 };

 const handleRefresh = () => {
 queryClient.invalidateQueries({ queryKey: ['dashboard'] });
 queryClient.invalidateQueries({ queryKey: ['prospects'] });
 queryClient.invalidateQueries({ queryKey: ['campaigns'] });
 queryClient.invalidateQueries({ queryKey: ['cars'] });
 };

 const getFilteredData = (data) => {
 if (!data || !user) return data || [];
 if (user.role ==="agent") return data.filter((item) => item.assigned_agent_id === user.id);
 if (user.role ==="fleet_owner") return data.filter((item) => item.fleet_owner_id === user.id);
 if (user.role ==="driver_partner") return data.filter((item) => item.driver_id === user.id);
 return data;
 };

 const filteredStats = {
 ...stats,
 prospects: getFilteredData(stats.prospects),
 campaigns: stats.campaigns,
 commissions: getFilteredData(stats.commissions),
 cars: user?.role ==="fleet_owner"? getFilteredData(stats.cars) : stats.cars,
 };

 const handleExport = () => {
 const rows = [
 ["Metric","Value"],
 ["Total Prospects", filteredStats.overview.prospectsTotal],
 ["New Prospects", filteredStats.overview.newProspects],
 ["Active Campaigns", filteredStats.overview.campaignsActive],
 ["Total Campaigns", filteredStats.overview.campaignsTotal],
 ["Total Revenue", filteredStats.overview.commissionsTotal],
 ["",""],
 ["Recent Prospects",""],
 ["Name","Status","Date"],
 ...filteredStats.prospects.slice(0, 50).map((p) => [
 p.firstName +""+ (p.lastName ||""),
 p.leadStatus || p.status ||"new",
 p.createdAt || p.created_date ||"",
 ]),
 ];

 const csv = rows.map((r) => r.map((v) => `"${String(v ??"").replace(/"/g, '""')}"`).join(",")).join("\n");
 const blob = new Blob([csv], { type:"text/csv"});
 const url = URL.createObjectURL(blob);
 const a = document.createElement("a");
 a.href = url;
 a.download = `mktr-dashboard-${new Date().toISOString().split("T")[0]}.csv`;
 a.click();
 URL.revokeObjectURL(url);
 };

 const cards = !loading ? buildAdminCards(filteredStats) : [];

 return (
 <DashboardShell loading={loading} error={error} onRetry={handleRefresh}>
 <DashboardHeader
 user={user}
 title="Dashboard" period={period}
 onPeriodChange={handlePeriodChange}
 lastUpdated={null}
 onRefresh={handleRefresh}
 refreshLoading={loading}
 actions={
 <>
 <Button variant="outline" className="bg-card" size="sm" onClick={handleExport}>
 <Download className="w-4 h-4 mr-2"/>
 Export Report
 </Button>
 <Link to={"/AdminCampaigns"}>
 <Button size="sm" className="w-full sm:w-auto">
 <Plus className="w-4 h-4 mr-2"/>
 New Campaign
 </Button>
 </Link>
 </>
 }
 />

 {/* Attention banner — promoted from sidebar */}
 <AttentionNeeded
 prospects={filteredStats.prospects}
 campaigns={filteredStats.campaigns}
 variant="banner" />

 {/* Mobile sticky summary */}
 <div className="md:hidden sticky top-[57px] z-40 bg-background border-b border-border -mx-6 px-6 py-2">
 <div className="flex items-center justify-between text-xs">
 <div className="text-center">
 <p className="font-semibold text-foreground">{filteredStats.overview.prospectsTotal}</p>
 <p className="text-muted-foreground">Prospects</p>
 </div>
 <div className="w-px h-6 bg-border"/>
 <div className="text-center">
 <p className="font-semibold text-foreground">{filteredStats.overview.campaignsActive}</p>
 <p className="text-muted-foreground">Active</p>
 </div>
 <div className="w-px h-6 bg-border"/>
 <div className="text-center">
 <p className="font-semibold text-success">${(filteredStats.overview.commissionsTotal || 0).toLocaleString()}</p>
 <p className="text-muted-foreground">Revenue</p>
 </div>
 </div>
 </div>

 <ResponsiveStatsGrid cards={cards} loading={loading} columns={5} />

 <DashboardCharts stats={filteredStats} loading={loading} />

 <div className="grid lg:grid-cols-3 gap-6">
 <div className="lg:col-span-2">
 <RecentActivity prospects={filteredStats.prospects} />
 </div>
 <div className="space-y-6">
 <AttentionNeeded
 prospects={filteredStats.prospects}
 campaigns={filteredStats.campaigns}
 />
 <TopPerformers prospects={filteredStats.prospects} />
 </div>
 </div>
 </DashboardShell>
 );
}
