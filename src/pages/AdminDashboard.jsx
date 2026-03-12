import { useState, useEffect } from "react";
import { Prospect, Campaign, Commission, Car } from "@/api/entities";
import { dashboard } from "@/api/client";
import { useDashboard } from "@/contexts/DashboardContext";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Plus, Download, Users, TrendingUp, DollarSign, Car as CarIcon, Eye } from "lucide-react";
import { subDays, isSameDay } from "date-fns";

import DashboardShell from "../components/dashboard/DashboardShell";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import ResponsiveStatsGrid from "../components/dashboard/ResponsiveStatsGrid";
import DashboardCharts from "../components/dashboard/DashboardCharts";
import RecentActivity from "../components/dashboard/RecentActivity";
import TopPerformers from "../components/dashboard/TopPerformers";
import AttentionNeeded from "../components/dashboard/AttentionNeeded";

function buildAdminCards(stats, period) {
  const { prospects, campaigns, commissions, cars, overview } = stats;

  const periodDaysMap = { today: 1, "1d": 1, "7d": 7, "30d": 30, "90d": 90 };
  const days = periodDaysMap[period] || 30;
  const now = new Date();
  const currentStart = subDays(now, days);
  const previousStart = subDays(now, days * 2);

  // Revenue comparison
  const currentRevenue = commissions
    .filter((c) => new Date(c.created_date || c.createdAt) >= currentStart)
    .reduce((sum, c) => sum + Number(c.amount_driver || 0) + Number(c.amount_fleet || 0), 0);
  const previousRevenue = commissions
    .filter((c) => {
      const d = new Date(c.created_date || c.createdAt);
      return d >= previousStart && d < currentStart;
    })
    .reduce((sum, c) => sum + Number(c.amount_driver || 0) + Number(c.amount_fleet || 0), 0);
  const revenueChange = previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue * 100).toFixed(1) : null;

  // Prospects comparison
  const currentProspects = prospects.filter((p) => new Date(p.created_date || p.createdAt || p.created_at) >= currentStart).length;
  const previousProspects = prospects.filter((p) => {
    const d = new Date(p.created_date || p.createdAt || p.created_at);
    return d >= previousStart && d < currentStart;
  }).length;
  const prospectsChange = previousProspects > 0 ? ((currentProspects - previousProspects) / previousProspects * 100).toFixed(1) : null;

  const activeCampaigns = overview.campaignsActive || campaigns.filter((c) => c.status === "active").length;
  const totalCampaigns = overview.campaignsTotal || campaigns.length;
  const campaignActivityRate = totalCampaigns > 0 ? Math.round((activeCampaigns / totalCampaigns) * 100) : 0;

  const totalRevenue = overview.commissionsTotal || commissions.reduce((sum, c) => sum + Number(c.amount_driver || 0) + Number(c.amount_fleet || 0), 0);
  const totalProspects = overview.prospectsTotal || prospects.length;

  // Sparklines
  const last7Days = Array.from({ length: 7 }, (_, i) => subDays(new Date(), 6 - i));
  const revenueSparkData = last7Days.map((day) =>
    commissions
      .filter((c) => isSameDay(new Date(c.created_date || c.createdAt), day))
      .reduce((sum, c) => sum + Number(c.amount_driver || 0) + Number(c.amount_fleet || 0), 0)
  );
  const prospectSparkData = last7Days.map((day) =>
    prospects.filter((p) => isSameDay(new Date(p.created_date || p.createdAt), day)).length
  );

  return [
    {
      title: "Total Revenue",
      value: `$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: DollarSign,
      trend: revenueChange !== null ? `${revenueChange > 0 ? "+" : ""}${revenueChange}%` : "N/A",
      trendUp: revenueChange !== null ? revenueChange > 0 : true,
      description: revenueChange !== null ? "vs previous period" : "no prior data",
      iconColor: "text-emerald-600",
      iconBg: "bg-emerald-50 dark:bg-emerald-950/30",
      linkTo: createPageUrl("AdminCommissions"),
      sparkData: revenueSparkData,
    },
    {
      title: "Active Campaigns",
      value: activeCampaigns,
      icon: TrendingUp,
      trend: `${campaignActivityRate}%`,
      trendUp: true,
      description: "active rate",
      iconColor: "text-blue-600",
      iconBg: "bg-blue-50 dark:bg-blue-950/30",
      linkTo: createPageUrl("AdminCampaigns"),
    },
    {
      title: "Total Prospects",
      value: totalProspects.toLocaleString(),
      icon: Users,
      trend: prospectsChange !== null ? `${prospectsChange > 0 ? "+" : ""}${prospectsChange}%` : `+${overview.newProspects || 0}`,
      trendUp: prospectsChange !== null ? prospectsChange > 0 : true,
      description: prospectsChange !== null ? "vs previous period" : "new this month",
      iconColor: "text-violet-600",
      iconBg: "bg-violet-50 dark:bg-violet-950/30",
      linkTo: createPageUrl("AdminProspects"),
      sparkData: prospectSparkData,
    },
    {
      title: "Fleet Size",
      value: cars.length,
      icon: CarIcon,
      trend: "Active",
      trendUp: true,
      description: "vehicles registered",
      iconColor: "text-orange-600",
      iconBg: "bg-orange-50 dark:bg-orange-950/30",
      linkTo: createPageUrl("AdminFleet"),
    },
    {
      title: "Ad Impressions",
      value: (overview.impressionsToday || 0).toLocaleString(),
      icon: Eye,
      trend: "Today",
      trendUp: true,
      description: "views delivered",
      iconColor: "text-pink-600",
      iconBg: "bg-pink-50 dark:bg-pink-950/30",
    },
  ];
}

export default function AdminDashboard() {
  const { user } = useDashboard();
  const [stats, setStats] = useState({
    prospects: [],
    campaigns: [],
    commissions: [],
    cars: [],
    totalScans: 0,
    overview: {
      prospectsTotal: 0,
      newProspects: 0,
      campaignsTotal: 0,
      campaignsActive: 0,
      commissionsTotal: 0,
    },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [period, setPeriod] = useState("30d");

  useEffect(() => {
    if (user) loadDashboardData();
  }, [user]);

  const loadDashboardData = async (selectedPeriod) => {
    const periodToUse = selectedPeriod || period;
    setError(null);
    try {
      const [prospectsData, campaignsData, commissionsData, overview] = await Promise.all([
        Prospect.list({ limit: 100 }),
        Campaign.list({ limit: 100 }),
        Commission.list({ limit: 100 }),
        dashboard.getOverview(periodToUse),
      ]);

      const prospects = Array.isArray(prospectsData) ? prospectsData : prospectsData.prospects || [];
      const allCampaigns = Array.isArray(campaignsData) ? campaignsData : campaignsData.campaigns || [];
      const commissions = Array.isArray(commissionsData) ? commissionsData : commissionsData.commissions || [];
      const campaigns = allCampaigns.filter((campaign) => campaign.status !== "archived");

      let cars = [];
      try {
        cars = await Car.list();
      } catch (e) {
        // Fleet module may not be available
      }

      const overviewStats = {
        prospectsTotal: overview?.stats?.prospects?.total || 0,
        newProspects: overview?.stats?.prospects?.new || 0,
        campaignsTotal: overview?.stats?.campaigns?.total || 0,
        campaignsActive: overview?.stats?.campaigns?.active || 0,
        commissionsTotal: Number(overview?.stats?.commissions?.total || 0),
        impressionsToday: overview?.stats?.impressions?.today || 0,
      };

      setStats({ prospects, campaigns, commissions, cars, overview: overviewStats });
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message || "Something went wrong while loading the dashboard.");
    }
    setLoading(false);
  };

  const handlePeriodChange = (value) => {
    setPeriod(value);
    setLoading(true);
    loadDashboardData(value);
  };

  const getFilteredData = (data) => {
    if (!data || !user) return data || [];
    if (user.role === "agent") return data.filter((item) => item.assigned_agent_id === user.id);
    if (user.role === "fleet_owner") return data.filter((item) => item.fleet_owner_id === user.id);
    if (user.role === "driver_partner") return data.filter((item) => item.driver_id === user.id);
    return data;
  };

  const filteredStats = {
    ...stats,
    prospects: getFilteredData(stats.prospects),
    campaigns: stats.campaigns,
    commissions: getFilteredData(stats.commissions),
    cars: user?.role === "fleet_owner" ? getFilteredData(stats.cars) : stats.cars,
  };

  const handleExport = () => {
    const rows = [
      ["Metric", "Value"],
      ["Total Prospects", filteredStats.overview.prospectsTotal],
      ["New Prospects", filteredStats.overview.newProspects],
      ["Active Campaigns", filteredStats.overview.campaignsActive],
      ["Total Campaigns", filteredStats.overview.campaignsTotal],
      ["Total Revenue", filteredStats.overview.commissionsTotal],
      ["", ""],
      ["Recent Prospects", ""],
      ["Name", "Status", "Date"],
      ...filteredStats.prospects.slice(0, 50).map((p) => [
        p.firstName + " " + (p.lastName || ""),
        p.leadStatus || p.status || "new",
        p.createdAt || p.created_date || "",
      ]),
    ];

    const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mktr-dashboard-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cards = !loading ? buildAdminCards(filteredStats, period) : [];

  return (
    <DashboardShell loading={loading} error={error} onRetry={loadDashboardData}>
      <DashboardHeader
        user={user}
        title="Dashboard"
        period={period}
        onPeriodChange={handlePeriodChange}
        lastUpdated={lastUpdated}
        onRefresh={loadDashboardData}
        refreshLoading={loading}
        actions={
          <>
            <Button variant="outline" className="bg-card" size="sm" onClick={handleExport}>
              <Download className="w-4 h-4 mr-2" />
              Export Report
            </Button>
            <Link to={createPageUrl("AdminCampaigns")}>
              <Button size="sm">
                <Plus className="w-4 h-4 mr-2" />
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
        variant="banner"
      />

      {/* Mobile sticky summary */}
      <div className="md:hidden sticky top-[57px] z-40 bg-background/95 backdrop-blur-sm border-b border-border -mx-6 px-6 py-2">
        <div className="flex items-center justify-between text-xs">
          <div className="text-center">
            <p className="font-semibold text-foreground">{filteredStats.overview.prospectsTotal}</p>
            <p className="text-muted-foreground">Prospects</p>
          </div>
          <div className="w-px h-6 bg-border" />
          <div className="text-center">
            <p className="font-semibold text-foreground">{filteredStats.overview.campaignsActive}</p>
            <p className="text-muted-foreground">Active</p>
          </div>
          <div className="w-px h-6 bg-border" />
          <div className="text-center">
            <p className="font-semibold text-emerald-600">${(filteredStats.overview.commissionsTotal || 0).toLocaleString()}</p>
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
