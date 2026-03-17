import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Prospect } from "@/api/entities";
import { useUpdateProspect } from "@/hooks/queries/useProspectsQuery";
import { useAuthStore } from "@/stores/authStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Calendar,
  Target,
  Clock,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import DashboardShell from "../components/dashboard/DashboardShell";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import ResponsiveStatsGrid from "../components/dashboard/ResponsiveStatsGrid";
import RecentActivity from "../components/dashboard/RecentActivity";
import ProspectKanban from "../components/dashboard/ProspectKanban";
import MyLeadPackages from "../components/agents/MyLeadPackages";

const TERMINAL_STATUSES = ["close_won", "won", "close_lost", "lost", "rejected"];

function isActiveProspect(p) {
  const s = (p.leadStatus || p.status || "new").toLowerCase();
  return !TERMINAL_STATUSES.includes(s);
}

export default function AgentDashboard() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState("30d");
  const [pipelineView, setPipelineView] = useState("pipeline");

  const { data: agentProspects = [], isLoading: loading, error: queryError } = useQuery({
    queryKey: ['prospects', 'agent', user?.id],
    queryFn: () => Prospect.filter({ assigned_agent_id: user.id }),
    enabled: !!user,
  });

  const stats = { prospects: agentProspects };
  const error = queryError?.message || null;

  const periodDays = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  const periodLabel = period === "7d" ? "Last 7 days" : period === "30d" ? "Last 30 days" : "Last 90 days";

  const filteredProspects = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - periodDays);
    cutoff.setHours(0, 0, 0, 0);
    return stats.prospects.filter((p) => new Date(p.created_date || p.createdAt) >= cutoff);
  }, [stats.prospects, periodDays]);

  const getDashboardMetrics = () => {
    if (!user) return {};

    const normalizedProspects = filteredProspects.map((p) => ({
      ...p,
      status: (p.leadStatus || p.status || "new").toLowerCase(),
    }));

    const newProspects = normalizedProspects.filter((p) => p.status === "new").length;

    // Previous period comparison
    const nowDate = new Date();
    const currentStart = new Date(nowDate);
    currentStart.setDate(currentStart.getDate() - periodDays);
    currentStart.setHours(0, 0, 0, 0);
    const previousStart = new Date(currentStart);
    previousStart.setDate(previousStart.getDate() - periodDays);

    const previousPeriodProspects = stats.prospects.filter((p) => {
      const d = new Date(p.created_date || p.createdAt);
      return d >= previousStart && d < currentStart;
    }).length;
    const prospectChange =
      previousPeriodProspects > 0
        ? ((filteredProspects.length - previousPeriodProspects) / previousPeriodProspects * 100).toFixed(1)
        : null;

    const closedWon = normalizedProspects.filter((p) => p.status === "won" || p.status === "close_won").length;

    const prospectSparkline = Array.from({ length: 7 }, (_, i) => {
      const day = new Date();
      day.setDate(day.getDate() - (6 - i));
      day.setHours(0, 0, 0, 0);
      const nextDay = new Date(day);
      nextDay.setDate(nextDay.getDate() + 1);
      return filteredProspects.filter((p) => {
        const d = new Date(p.created_date || p.createdAt);
        return d >= day && d < nextDay;
      }).length;
    });

    return { totalProspects: filteredProspects.length, newProspects, closedWon, prospectSparkline, prospectChange };
  };

  const updateMutation = useUpdateProspect();
  const handleStatusChange = async (prospectId, newStatus) => {
    await updateMutation.mutateAsync({ id: prospectId, data: { leadStatus: newStatus } });
  };

  const handleRefresh = () => queryClient.invalidateQueries({ queryKey: ['prospects', 'agent'] });

  const metrics = !loading ? getDashboardMetrics() : {};

  const cards = !loading
    ? [
        {
          title: "My Prospects",
          value: metrics.totalProspects,
          icon: Users,
          trend: metrics.prospectChange !== null
            ? `${metrics.prospectChange > 0 ? "+" : ""}${metrics.prospectChange}% vs prev`
            : `${metrics.newProspects} new`,
          trendUp: metrics.prospectChange !== null ? metrics.prospectChange > 0 : true,
          iconColor: "text-blue-600",
          iconBg: "bg-blue-50 dark:bg-blue-950/30",
          linkTo: "/MyProspects",
          sparkData: metrics.prospectSparkline,
        },
        {
          title: periodLabel,
          value: filteredProspects.length,
          icon: Calendar,
          trend: "New prospects",
          trendUp: true,
          iconColor: "text-green-600",
          iconBg: "bg-green-50 dark:bg-green-950/30",
        },
        {
          title: "Closed Won",
          value: metrics.closedWon,
          icon: Target,
          trend: `${Math.round((metrics.closedWon / Math.max(metrics.totalProspects, 1)) * 100)}% conversion`,
          trendUp: true,
          iconColor: "text-purple-600",
          iconBg: "bg-purple-50 dark:bg-purple-950/30",
        },
        {
          title: "Active Prospects",
          value: filteredProspects.filter(isActiveProspect).length,
          icon: Clock,
          trend: "In pipeline",
          trendUp: true,
          iconColor: "text-orange-600",
          iconBg: "bg-orange-50 dark:bg-orange-950/30",
        },
      ]
    : [];

  const now = new Date();
  const overdueProspects = stats.prospects
    .filter((p) => {
      if (!p.nextFollowUpDate) return false;
      if (!isActiveProspect(p)) return false;
      return new Date(p.nextFollowUpDate) < now;
    })
    .sort((a, b) => new Date(a.nextFollowUpDate) - new Date(b.nextFollowUpDate));

  return (
    <DashboardShell loading={loading} error={error} onRetry={handleRefresh}>
      <DashboardHeader
        user={user}
        greeting
        roleBadge="Sales Agent"
        period={period}
        onPeriodChange={setPeriod}
        periodOptions={{ "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" }}
        lastUpdated={null}
        onRefresh={handleRefresh}
        refreshLoading={loading}
      />

      <ResponsiveStatsGrid cards={cards} loading={loading} />

      {/* Pipeline / List Toggle */}
      <Tabs value={pipelineView} onValueChange={setPipelineView} className="w-fit">
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="list">List</TabsTrigger>
        </TabsList>
      </Tabs>

      {pipelineView === "pipeline" && (
        <ProspectKanban
          prospects={stats.prospects}
          onStatusChange={handleStatusChange}
          loading={loading}
        />
      )}

      {/* Content grid — always visible so sidebar cards are never hidden */}
      <div className={pipelineView === "list" ? "grid lg:grid-cols-3 gap-6" : "grid md:grid-cols-2 gap-6"}>
        {pipelineView === "list" && (
          <div className="lg:col-span-2">
            <RecentActivity prospects={filteredProspects} userRole="agent" />
          </div>
        )}

        <div className="space-y-6">
          <MyLeadPackages userId={user?.id} />

          {/* Overdue Follow-ups */}
          <Card className="border-none shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                Overdue Follow-ups
              </CardTitle>
            </CardHeader>
            <CardContent>
              {overdueProspects.length > 0 ? (
                <div className="space-y-3">
                  {overdueProspects.slice(0, 5).map((p) => (
                    <div key={p.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {p.firstName} {p.lastName}
                        </p>
                        <p className="text-xs text-red-500">
                          Due {formatDistanceToNow(new Date(p.nextFollowUpDate), { addSuffix: true })}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800 text-xs">
                        {p.leadStatus || p.status || "new"}
                      </Badge>
                    </div>
                  ))}
                  {overdueProspects.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center pt-1">
                      +{overdueProspects.length - 5} more overdue
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-400" />
                  <p className="text-sm">All caught up!</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardShell>
  );
}
