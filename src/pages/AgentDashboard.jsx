
import { useState, useEffect, useMemo } from "react";
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
  Clock,
  AlertCircle,
  CheckCircle,
  RefreshCw
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import StatsCard from "../components/dashboard/StatsCard";
import RecentActivity from "../components/dashboard/RecentActivity";
import ProspectKanban from "../components/dashboard/ProspectKanban";
// CommissionSummary import removed
import MyLeadPackages from "../components/agents/MyLeadPackages";
import LastUpdated from "../components/dashboard/LastUpdated";

export default function AgentDashboard() {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({
    prospects: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [period, setPeriod] = useState('30d');
  const [pipelineView, setPipelineView] = useState('pipeline');

  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const periodLabel = period === '7d' ? 'Last 7 days' : period === '30d' ? 'Last 30 days' : 'Last 90 days';

  const filteredProspects = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - periodDays);
    cutoff.setHours(0, 0, 0, 0);
    return stats.prospects.filter(p =>
      new Date(p.created_date || p.createdAt) >= cutoff
    );
  }, [stats.prospects, periodDays]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setError(null);
    try {
      const userData = await auth.getCurrentUser();
      setUser(userData);

      // For agents, only load their assigned prospects
      if (userData.role === 'agent') {
        const prospects = await Prospect.filter({ assigned_agent_id: userData.id });
        setStats({ prospects });
        setLastUpdated(new Date());
      } else {
        // Handle cases where the user is not an agent or a different type of user
        // For now, clear stats if not an agent to prevent displaying irrelevant data
        setStats({ prospects: [] });
        console.warn('User is not an agent or user type not recognized for this dashboard.');
      }
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError(err.message || 'Something went wrong while loading the dashboard.');
    }
    setLoading(false);
  };

  const getDashboardMetrics = () => {
    if (!user) return {};

    const normalizedProspects = filteredProspects.map(p => ({
      ...p,
      status: (p.leadStatus || p.status || 'new').toLowerCase()
    }));

    const newProspects = normalizedProspects.filter(p => p.status === 'new').length;

    // Previous period comparison for prospects
    const nowDate = new Date();
    const currentStart = new Date(nowDate);
    currentStart.setDate(currentStart.getDate() - periodDays);
    currentStart.setHours(0, 0, 0, 0);
    const previousStart = new Date(currentStart);
    previousStart.setDate(previousStart.getDate() - periodDays);

    const previousPeriodProspects = stats.prospects.filter(p => {
      const d = new Date(p.created_date || p.createdAt);
      return d >= previousStart && d < currentStart;
    }).length;
    const prospectChange = previousPeriodProspects > 0
      ? ((filteredProspects.length - previousPeriodProspects) / previousPeriodProspects * 100).toFixed(1)
      : null;

    // Check for both 'won' and 'close_won' as backend/frontend conventions might vary
    const closedWon = normalizedProspects.filter(p =>
      p.status === 'won' || p.status === 'close_won'
    ).length;

    const prospectSparkline = Array.from({ length: 7 }, (_, i) => {
      const day = new Date();
      day.setDate(day.getDate() - (6 - i));
      day.setHours(0, 0, 0, 0);
      const nextDay = new Date(day);
      nextDay.setDate(nextDay.getDate() + 1);
      return filteredProspects.filter(p => {
        const d = new Date(p.created_date || p.createdAt);
        return d >= day && d < nextDay;
      }).length;
    });

    return {
      totalProspects: filteredProspects.length,
      newProspects,
      weeklyProspects: filteredProspects.length,
      closedWon,
      prospectSparkline,
      prospectChange
    };
  };

  const handleStatusChange = async (prospectId, newStatus) => {
    try {
      await Prospect.update(prospectId, { leadStatus: newStatus });
      const prospects = await Prospect.filter({ assigned_agent_id: user.id });
      setStats({ prospects });
    } catch (err) {
      console.error('Failed to update status:', err);
      throw err; // Re-throw so the Kanban can revert optimistic update
    }
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

  const now = new Date();
  const overdueProspects = stats.prospects.filter(p => {
    if (!p.nextFollowUpDate) return false;
    const s = (p.leadStatus || p.status || 'new').toLowerCase();
    if (['close_won', 'won', 'close_lost', 'lost', 'rejected'].includes(s)) return false;
    return new Date(p.nextFollowUpDate) < now;
  }).sort((a, b) => new Date(a.nextFollowUpDate) - new Date(b.nextFollowUpDate));

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
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[130px] bg-white" size="sm">
                <SelectValue placeholder="Period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <LastUpdated lastUpdated={lastUpdated} onRefresh={loadDashboardData} loading={loading} />
        </div>

        {error ? (
          <Card className="p-12 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" />
            <h3 className="text-lg font-semibold mb-2">Failed to load dashboard</h3>
            <p className="text-gray-500 text-sm mb-4">{error}</p>
            <Button onClick={loadDashboardData} variant="outline">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </Card>
        ) : (
          <>
            {/* Stats Cards */}
            <div className="mb-8">
              {/* Desktop: grid layout */}
              <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatsCard
                  title="My Prospects"
                  value={metrics.totalProspects}
                  icon={Users}
                  bgColor="bg-blue-500"
                  trend={metrics.prospectChange !== null ? `${metrics.prospectChange > 0 ? '+' : ''}${metrics.prospectChange}% vs prev` : `${metrics.newProspects} new`}
                  linkTo={createPageUrl("MyProspects")}
                  sparkData={metrics.prospectSparkline}
                />
                <StatsCard
                  title={periodLabel}
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
                  value={filteredProspects.filter(p => {
                    const s = (p.leadStatus || p.status || 'new').toLowerCase();
                    return !['close_won', 'won', 'close_lost', 'lost', 'rejected'].includes(s);
                  }).length}
                  icon={Clock}
                  bgColor="bg-orange-500"
                  trend="In pipeline"
                />
              </div>
              {/* Mobile: horizontal scroll */}
              <div
                className="flex md:hidden gap-4 overflow-x-auto pb-4 snap-x snap-mandatory -mx-6 px-6"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
              >
                <div className="min-w-[240px] snap-center shrink-0">
                  <StatsCard
                    title="My Prospects"
                    value={metrics.totalProspects}
                    icon={Users}
                    bgColor="bg-blue-500"
                    trend={metrics.prospectChange !== null ? `${metrics.prospectChange > 0 ? '+' : ''}${metrics.prospectChange}% vs prev` : `${metrics.newProspects} new`}
                    linkTo={createPageUrl("MyProspects")}
                    sparkData={metrics.prospectSparkline}
                  />
                </div>
                <div className="min-w-[240px] snap-center shrink-0">
                  <StatsCard
                    title={periodLabel}
                    value={metrics.weeklyProspects}
                    icon={Calendar}
                    bgColor="bg-green-500"
                    trend="New prospects"
                  />
                </div>
                <div className="min-w-[240px] snap-center shrink-0">
                  <StatsCard
                    title="Closed Won"
                    value={metrics.closedWon}
                    icon={Target}
                    bgColor="bg-purple-500"
                    trend={`${Math.round((metrics.closedWon / Math.max(metrics.totalProspects, 1)) * 100)}% conversion`}
                  />
                </div>
                <div className="min-w-[240px] snap-center shrink-0">
                  <StatsCard
                    title="Active Prospects"
                    value={filteredProspects.filter(p => {
                      const s = (p.leadStatus || p.status || 'new').toLowerCase();
                      return !['close_won', 'won', 'close_lost', 'lost', 'rejected'].includes(s);
                    }).length}
                    icon={Clock}
                    bgColor="bg-orange-500"
                    trend="In pipeline"
                  />
                </div>
              </div>
            </div>

            {/* Pipeline / List Toggle */}
            <div className="flex items-center gap-1 mb-4 bg-white rounded-lg p-1 border w-fit">
              <button
                onClick={() => setPipelineView('pipeline')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  pipelineView === 'pipeline'
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Pipeline
              </button>
              <button
                onClick={() => setPipelineView('list')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  pipelineView === 'list'
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                List
              </button>
            </div>

            {pipelineView === 'pipeline' && (
              <div className="mb-8">
                <ProspectKanban
                  prospects={stats.prospects}
                  onStatusChange={handleStatusChange}
                  loading={loading}
                />
              </div>
            )}

            {/* Main Content Grid */}
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {pipelineView === 'list' && (
                  <RecentActivity
                    prospects={filteredProspects}
                    userRole="agent"
                  />
                )}
              </div>

              <div className="space-y-6">
                <MyLeadPackages userId={user?.id} />

                {/* Overdue Follow-ups */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <AlertCircle className="w-5 h-5 text-amber-500" />
                      Overdue Follow-ups
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {overdueProspects.length > 0 ? (
                      <div className="space-y-3">
                        {overdueProspects.slice(0, 5).map(p => (
                          <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                            <div>
                              <p className="text-sm font-medium text-gray-900">{p.firstName} {p.lastName}</p>
                              <p className="text-xs text-red-500">
                                Due {formatDistanceToNow(new Date(p.nextFollowUpDate), { addSuffix: true })}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-amber-700 bg-amber-50 border-amber-200 text-xs">
                              {p.leadStatus || p.status || 'new'}
                            </Badge>
                          </div>
                        ))}
                        {overdueProspects.length > 5 && (
                          <p className="text-xs text-gray-400 text-center pt-1">
                            +{overdueProspects.length - 5} more overdue
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-4 text-gray-400">
                        <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-400" />
                        <p className="text-sm">All caught up!</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

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
                          {filteredProspects.filter(p => {
                            const s = (p.leadStatus || p.status || 'new').toLowerCase();
                            return !['close_won', 'won', 'close_lost', 'lost', 'rejected'].includes(s);
                          }).length}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">{periodLabel}</span>
                        <Badge variant="outline" className="bg-green-50 text-green-700">
                          {metrics.weeklyProspects} new leads
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
