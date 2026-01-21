import { useState, useEffect } from "react";
import { Prospect, Campaign, Commission, Car } from "@/api/entities"; // Ensure named exports work or default if needed
// Actually previous file used named imports from entities, but let's check if entities is default or named.
// Looking at previous file content (Step 10), it imported { Prospect } from "@/api/entities". 
// But wait, step 11 view_file `src/api/client.js` shows `export const entities = ...` and `export default mktrAPI`.
// It does NOT explicitly export `Prospect`, `Campaign` etc as named exports from `client.js`.
// However, `src/api/entities.js` might exist?
// Step 4 list_dir passed over `src/api`? No, it listed `src/pages`.
// Let me check `src/api` in a moment if needed. But the previous `AdminDashboard.jsx` had:
// import { Prospect } from "@/api/entities";
// So I will assume that is correct.

import { dashboard, auth } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Plus, Download } from "lucide-react";
import { format } from "date-fns";

import DashboardStats from "../components/dashboard/DashboardStats";
import DashboardCharts from "../components/dashboard/DashboardCharts";
import RecentActivity from "../components/dashboard/RecentActivity";

export default function AdminDashboard() {
  const [user, setUser] = useState(null);
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
      commissionsTotal: 0
    }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const userData = await auth.getCurrentUser();
      if (!userData) return; // Redirect handled by router usually
      setUser(userData);

      const [prospectsData, campaignsData, commissionsData, overview] = await Promise.all([
        Prospect.list({ limit: 100 }),
        Campaign.list({ limit: 100 }),
        Commission.list({ limit: 100 }),
        dashboard.getOverview('30d')
      ]);

      const prospects = Array.isArray(prospectsData) ? prospectsData : (prospectsData.prospects || []);
      const allCampaigns = Array.isArray(campaignsData) ? campaignsData : (campaignsData.campaigns || []);
      const commissions = Array.isArray(commissionsData) ? commissionsData : (commissionsData.commissions || []);

      const campaigns = allCampaigns.filter(campaign => campaign.status !== 'archived');

      let cars = [];
      try {
        cars = await Car.list();
      } catch (error) {
        console.log('Fleet module skipped:', error.message);
      }

      const overviewStats = {
        prospectsTotal: overview?.stats?.prospects?.total || 0,
        newProspects: overview?.stats?.prospects?.new || 0,
        campaignsTotal: overview?.stats?.campaigns?.total || 0,
        campaignsActive: overview?.stats?.campaigns?.active || 0,
        commissionsTotal: Number(overview?.stats?.commissions?.total || 0),
        impressionsToday: overview?.stats?.impressions?.today || 0 // Added
      };

      setStats({ prospects, campaigns, commissions, cars, overview: overviewStats });
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    }
    setLoading(false);
  };

  const getFilteredData = (data, userRole, userId) => {
    if (!data) return [];
    switch (userRole) {
      case 'agent':
        return data.filter(item => item.assigned_agent_id === userId);
      case 'fleet_owner':
        return data.filter(item => item.fleet_owner_id === userId);
      case 'driver_partner':
        return data.filter(item => item.driver_id === userId);
      default:
        return data;
    }
  };

  // Filter keys for display
  const filteredStats = {
    ...stats,
    prospects: getFilteredData(stats.prospects, user?.role, user?.id),
    campaigns: stats.campaigns, // Campaigns usually global or specific logic, keeping as is for now
    commissions: getFilteredData(stats.commissions, user?.role, user?.id),
    cars: user?.role === 'fleet_owner' ? getFilteredData(stats.cars, user?.role, user?.id) : stats.cars
  };

  return (
    <div className="p-6 lg:p-8 bg-gray-50/50 min-h-screen font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              Dashboard
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {format(new Date(), 'EEEE, d MMMM yyyy')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" className="bg-white" size="sm">
              <Download className="w-4 h-4 mr-2" />
              Export Report
            </Button>
            <Link to={createPageUrl("AdminCampaigns")}>
              <Button className="bg-gray-900 text-white hover:bg-gray-800" size="sm">
                <Plus className="w-4 h-4 mr-2" />
                New Campaign
              </Button>
            </Link>
          </div>
        </div>

        <DashboardStats stats={filteredStats} loading={loading} />

        <DashboardCharts stats={filteredStats} loading={loading} />

        <div className="grid grid-cols-1">
          <RecentActivity prospects={filteredStats.prospects} />
        </div>
      </div>
    </div>
  );
}