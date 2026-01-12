
import { useState, useEffect } from "react";
import { Prospect } from "@/api/entities";
import { auth } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Users,
  Calendar,
  ArrowRight,
  Target,
  Clock
} from "lucide-react";
import { format } from "date-fns";

import StatsCard from "../components/dashboard/StatsCard";
import RecentActivity from "../components/dashboard/RecentActivity";
// CommissionSummary import removed
import MyLeadPackages from "../components/agents/MyLeadPackages";

export default function AgentDashboard() {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({
    prospects: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const userData = await auth.getCurrentUser();
      setUser(userData);

      // For agents, only load their assigned prospects
      if (userData.role === 'agent') {
        const prospects = await Prospect.filter({ assigned_agent_id: userData.id });
        setStats({ prospects });
      } else {
        // Handle cases where the user is not an agent or a different type of user
        // For now, clear stats if not an agent to prevent displaying irrelevant data
        setStats({ prospects: [] });
        console.warn('User is not an agent or user type not recognized for this dashboard.');
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    }
    setLoading(false);
  };

  const getDashboardMetrics = () => {
    if (!user) return {};

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const thisWeek = new Date();
    thisWeek.setDate(today.getDate() - 7);

    const thisMonth = new Date(); // This variable is not used after removing monthlyEarnings, can be removed
    thisMonth.setDate(1);        // This variable is not used after removing monthlyEarnings, can be removed
    thisMonth.setHours(0, 0, 0, 0); // This variable is not used after removing monthlyEarnings, can be removed

    const normalizedProspects = stats.prospects.map(p => ({
      ...p,
      status: (p.leadStatus || p.status || 'new').toLowerCase()
    }));

    const newProspects = normalizedProspects.filter(p => p.status === 'new').length;
    const weeklyProspects = normalizedProspects.filter(p =>
      new Date(p.created_date || p.createdAt) >= thisWeek
    ).length;

    // Check for both 'won' and 'close_won' as backend/frontend conventions might vary
    const closedWon = normalizedProspects.filter(p =>
      p.status === 'won' || p.status === 'close_won'
    ).length;

    return {
      totalProspects: stats.prospects.length,
      newProspects,
      weeklyProspects,
      closedWon
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

  // If user is not an agent, or user data failed to load
  if (!user || user.role !== 'agent') {
    return (
      <div className="p-6 lg:p-8 flex items-center justify-center min-h-[calc(100vh-64px)]">
        <Card className="max-w-md w-full text-center p-8">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">
              You do not have permission to view this dashboard.
            </p>
            <Link to="/">
              <Button>Go to Home</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const metrics = getDashboardMetrics();

  return (
    <div className="p-6 lg:p-8 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome back, {user?.full_name}!
          </h1>
          <div className="flex items-center gap-4 text-gray-600">
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
              Sales Agent
            </Badge>
            <span className="text-sm">
              {format(new Date(), 'EEEE, dd MMMM yyyy')}
            </span>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatsCard
            title="My Prospects"
            value={metrics.totalProspects}
            icon={Users}
            bgColor="bg-blue-500"
            trend={`${metrics.newProspects} new`}
            linkTo={createPageUrl("MyProspects")}
          />
          <StatsCard
            title="This Week"
            value={metrics.weeklyProspects}
            icon={Calendar}
            bgColor="bg-green-500"
            trend="New prospects"
          />
          <StatsCard
            title="Closed Won"
            value={metrics.closedWon}
            icon={Target}
            bgColor="bg-purple-500"
            trend={`${Math.round((metrics.closedWon / Math.max(metrics.totalProspects, 1)) * 100)}% conversion`}
          />
          <StatsCard
            title="Active Prospects"
            value={stats.prospects.filter(p => {
              const s = (p.leadStatus || p.status || 'new').toLowerCase();
              return !['close_won', 'won', 'close_lost', 'lost', 'rejected'].includes(s);
            }).length}
            icon={Clock}
            bgColor="bg-orange-500"
            trend="In pipeline"
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <RecentActivity
              prospects={stats.prospects}
              userRole="agent"
            />
          </div>

          <div className="space-y-6">
            <MyLeadPackages userId={user?.id} />

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Link to={createPageUrl("MyProspects")}>
                  <Button variant="outline" className="w-full justify-between">
                    View My Prospects
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                {/* View My Commissions link removed */}
              </CardContent>
            </Card>

            {/* Performance Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Conversion Rate</span>
                    <span className="font-semibold">
                      {Math.round((metrics.closedWon / Math.max(metrics.totalProspects, 1)) * 100)}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Active Prospects</span>
                    <span className="font-semibold">
                      {stats.prospects.filter(p => {
                        const s = (p.leadStatus || p.status || 'new').toLowerCase();
                        return !['close_won', 'won', 'close_lost', 'lost', 'rejected'].includes(s);
                      }).length}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">This Week</span>
                    <Badge variant="outline" className="bg-green-50 text-green-700">
                      {metrics.weeklyProspects} new leads
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
