import { useState, useEffect } from "react";
import { Prospect } from "@/api/entities";
import { Campaign } from "@/api/entities";
import { Commission } from "@/api/entities";
import { Car } from "@/api/entities";
import { dashboard } from "@/api/client";
import { auth } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { 
  Users, 
  DollarSign, 
  TrendingUp,
  Car as CarIcon,
  ArrowRight
} from "lucide-react";
import { format } from "date-fns";

import StatsCard from "../components/dashboard/StatsCard";
import RecentActivity from "../components/dashboard/RecentActivity";
import CommissionSummary from "../components/dashboard/CommissionSummary";

export default function AdminDashboard() {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({
    prospects: [],
    campaigns: [],
    commissions: [],
    cars: [],
    totalScans: 0
  });
  const [loading, setLoading] = useState(true);
  
  // Debug logging for loading state
  console.log('🔍 ADMIN DASHBOARD: Loading state:', loading);
  console.log('🔍 ADMIN DASHBOARD: User state:', user);
  console.log('🔍 ADMIN DASHBOARD: Stats state:', stats);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const userData = await auth.getCurrentUser();
      if (!userData) {
        console.log('No user data, redirecting to login');
        return;
      }
      setUser(userData);

      // Ensure API client has authentication token
      const token = localStorage.getItem('mktr_auth_token');
      if (!token) {
        console.log('No authentication token found');
        return;
      }

      const [prospects, allCampaigns, commissions, overview] = await Promise.all([
        Prospect.list(),
        Campaign.list(),
        Commission.list(),
        dashboard.getOverview('30d')
      ]);
      
      // Filter out archived campaigns for dashboard stats
      const campaigns = allCampaigns.filter(campaign => campaign.status !== 'archived');
      
      // Load cars separately with error handling for fleet module
      let cars = [];
      try {
        cars = await Car.list();
      } catch (error) {
        console.log('Fleet module not accessible, skipping car data:', error.message);
      }

      const totalScans = overview?.data?.stats?.qrCodes?.totalScans || 0;
      setStats({ prospects, campaigns, commissions, cars, totalScans });
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    }
    setLoading(false);
  };

  const getFilteredData = (data, userRole, userId) => {
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

  const getDashboardMetrics = () => {
    if (!user) return {};

    const filteredProspects = getFilteredData(stats.prospects, user.role, user.id);
    const filteredCommissions = getFilteredData(stats.commissions, user.role, user.id);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayCommissions = filteredCommissions.filter(c => 
      new Date(c.created_date || c.created_at) >= today
    );

    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    const monthCommissions = filteredCommissions.filter(c => 
      new Date(c.created_date || c.created_at) >= thisMonth
    );

    return {
      totalProspects: filteredProspects.length,
      newProspects: filteredProspects.filter(p => p.status === 'new').length,
      todayEarnings: todayCommissions.reduce((sum, c) => {
        if (user.role === 'driver_partner') return sum + (c.amount_driver || 0);
        if (user.role === 'fleet_owner') return sum + (c.amount_fleet || 0);
        return sum + (c.amount_driver || 0) + (c.amount_fleet || 0);
      }, 0),
      monthlyEarnings: monthCommissions.reduce((sum, c) => {
        if (user.role === 'driver_partner') return sum + (c.amount_driver || 0);
        if (user.role === 'fleet_owner') return sum + (c.amount_fleet || 0);
        return sum + (c.amount_driver || 0) + (c.amount_fleet || 0);
      }, 0)
    };
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-64"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {Array(4).fill(0).map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const metrics = getDashboardMetrics();
  const roleLabels = {
    admin: "Administrator",
    agent: "Sales Agent",
    fleet_owner: "Fleet Owner", 
    driver_partner: "Driver Partner"
  };

  return (
    <div className="p-6 lg:p-8 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Admin Dashboard
          </h1>
          <div className="flex items-center gap-4 text-gray-600">
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
              {roleLabels[user?.role] || user?.role}
            </Badge>
            <span className="text-sm">
              {format(new Date(), 'EEEE, dd MMMM yyyy')}
            </span>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatsCard
            title="Total Prospects"
            value={stats.prospects.length}
            icon={Users}
            bgColor="bg-blue-500"
            trend="+12% this month"
            linkTo={createPageUrl("AdminProspects")}
          />
          <StatsCard
            title="Active Campaigns"
            value={stats.campaigns.filter(c => c.is_active || c.status === 'active').length}
            icon={TrendingUp}
            bgColor="bg-green-500"
            trend={`${stats.campaigns.length} total`}
            linkTo={createPageUrl("AdminCampaigns")}
          />
          <StatsCard
            title="Total Commissions"
            value={`$${stats.commissions.reduce((sum, c) => sum + (c.amount_driver || 0) + (c.amount_fleet || 0), 0).toFixed(2)}`}
            icon={DollarSign}
            bgColor="bg-purple-500"
            linkTo={createPageUrl("AdminCommissions")}
          />
          <StatsCard
            title="Fleet Size"
            value={stats.cars.length}
            icon={CarIcon}
            bgColor="bg-orange-500"
            trend="Active vehicles"
            linkTo={createPageUrl("AdminFleet")}
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <RecentActivity 
              prospects={getFilteredData(stats.prospects, user?.role, user?.id)}
              userRole={user?.role}
            />
          </div>
          
          <div className="space-y-6">
            <CommissionSummary 
              commissions={getFilteredData(stats.commissions, user?.role, user?.id)}
              userRole={user?.role}
              totalScans={stats.totalScans}
            />
            
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Link to={createPageUrl("AdminQRCodes")}>
                  <Button variant="outline" className="w-full justify-between">
                    Generate QR Codes
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <Link to={createPageUrl("AdminCampaigns")}>
                  <Button variant="outline" className="w-full justify-between">
                    Manage Campaigns
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}