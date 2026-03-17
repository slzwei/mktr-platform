import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { entities, apiClient } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, BarChart3, TrendingUp, Activity } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import CommissionSummary from "@/components/dashboard/CommissionSummary";
import { format } from "date-fns";

import DashboardShell from "../components/dashboard/DashboardShell";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import ResponsiveStatsGrid from "../components/dashboard/ResponsiveStatsGrid";

export default function DriverDashboard() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState("30d");

  const { data: periodData, isLoading: periodLoading, error: periodError, dataUpdatedAt } = useQuery({
    queryKey: ['driver', 'dashboard', period, user?.id],
    queryFn: async () => {
      const p = period;

      // Fetch commissions once and reuse for both state and earnings trend
      let comms = [];
      try {
        const resp = await apiClient.get(`/dashboard/driver/commissions`, { period: p });
        comms = resp?.data?.commissions || [];
      } catch (e) {
        comms = [];
      }

      let scans = [];
      try {
        const resp = await apiClient.get(`/dashboard/driver/scans`, { period: p });
        scans = resp?.data?.trend || [];
      } catch (_) {
        const qrData = await entities.QrTag.list({});
        const qrList = Array.isArray(qrData) ? qrData : (qrData.qrTags || []);
        const mine = (qrList || []).filter((q) => String(q.ownerUserId) === String(user.id));
        const map = new Map();
        const now = new Date();
        if (p === "1d") {
          for (let h = 0; h < 24; h++) map.set(h, 0);
          for (const q of mine) {
            const daily = q?.analytics?.hourlyScans || {};
            const keyDate = format(now, "yyyy-MM-dd");
            const byHour = daily?.[keyDate] || {};
            for (const [hStr, cnt] of Object.entries(byHour)) {
              const h = parseInt(hStr, 10);
              map.set(h, (map.get(h) || 0) + (cnt || 0));
            }
          }
          scans = Array.from(map.entries()).map(([hour, count]) => ({ label: `${hour}:00`, count }));
        } else {
          const days = p === "7d" ? 7 : 30;
          for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const key = format(d, "yyyy-MM-dd");
            map.set(key, 0);
          }
          for (const q of mine) {
            const daily = q?.analytics?.dailyScans || {};
            for (const [day, cnt] of Object.entries(daily)) {
              if (map.has(day)) map.set(day, (map.get(day) || 0) + (cnt || 0));
            }
          }
          scans = Array.from(map.entries()).map(([day, count]) => ({ label: `${day.slice(8)}-${day.slice(5, 7)}`, count }));
        }
      }

      // Build earnings trend from already-fetched commissions
      let earnTrendResult = [];
      try {
        const map = new Map();
        if (p === "1d") {
          for (let h = 0; h < 24; h++) map.set(`${h}:00`, 0);
          for (const c of comms) {
            const dt = new Date(c.created_date);
            const hour = dt.getHours();
            const key = `${hour}:00`;
            if (map.has(key)) map.set(key, (map.get(key) || 0) + (Number(c.amount_driver) || 0));
          }
          earnTrendResult = Array.from(map.entries()).map(([label, amount]) => ({ label, amount }));
        } else {
          const now = new Date();
          const days = p === "7d" ? 7 : 30;
          for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const key = d.toISOString().split("T")[0];
            map.set(key, 0);
          }
          for (const c of comms) {
            const key = new Date(c.created_date).toISOString().split("T")[0];
            if (map.has(key)) map.set(key, (map.get(key) || 0) + (Number(c.amount_driver) || 0));
          }
          earnTrendResult = Array.from(map.entries()).map(([day, amount]) => ({ label: `${day.slice(8)}-${day.slice(5, 7)}`, amount }));
        }
      } catch (_) {
        earnTrendResult = [];
      }

      return { commissions: comms, scanTrend: scans, earnTrend: earnTrendResult };
    },
    enabled: !!user,
  });

  const { data: lifetimeData } = useQuery({
    queryKey: ['driver', 'lifetime', user?.id],
    queryFn: async () => {
      const [commResp, scansResp] = await Promise.all([
        apiClient.get(`/dashboard/driver/commissions`, { period: "all" }),
        apiClient.get(`/dashboard/driver/scans`, { period: "all" }),
      ]);
      const lifetimeCommissions = commResp?.data?.commissions || [];
      const totalEarned = lifetimeCommissions.reduce((sum, c) => sum + (Number(c.amount_driver) || 0), 0);
      return { earnings: totalEarned, scans: scansResp?.data?.total || 0 };
    },
    enabled: !!user,
  });

  const commissions = periodData?.commissions ?? [];
  const scanTrend = periodData?.scanTrend ?? [];
  const earnTrend = periodData?.earnTrend ?? [];
  const lifetimeEarnings = lifetimeData?.earnings ?? 0;
  const lifetimeScans = lifetimeData?.scans ?? 0;
  const loading = periodLoading;
  const error = periodError?.message || null;
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['driver'] });
  };

  const periodEarnings = commissions.reduce((sum, c) => sum + (Number(c.amount_driver) || 0), 0);
  const periodDays = period === "1d" ? 1 : period === "7d" ? 7 : 30;
  const avgPerDay = periodDays > 0 ? (periodEarnings / periodDays) : 0;

  const cards = [
    {
      title: "Period Earnings",
      value: `$${periodEarnings.toFixed(2)}`,
      icon: DollarSign,
      trend: period === "1d" ? "Today" : period === "7d" ? "Last 7 days" : "Last 30 days",
      trendUp: true,
      iconColor: "text-emerald-600",
      iconBg: "bg-emerald-50 dark:bg-emerald-950/30",
    },
    {
      title: "Lifetime Earnings",
      value: `$${Number(lifetimeEarnings).toFixed(2)}`,
      icon: TrendingUp,
      trend: "All time",
      trendUp: true,
      iconColor: "text-indigo-600",
      iconBg: "bg-indigo-50 dark:bg-indigo-950/30",
    },
    {
      title: "Total Scans",
      value: Number(lifetimeScans).toLocaleString(),
      icon: BarChart3,
      trend: "Lifetime",
      trendUp: true,
      iconColor: "text-purple-600",
      iconBg: "bg-purple-50 dark:bg-purple-950/30",
    },
    {
      title: "Avg / Day",
      value: `$${avgPerDay.toFixed(2)}`,
      icon: Activity,
      trend: "This period",
      trendUp: true,
      iconColor: "text-blue-600",
      iconBg: "bg-blue-50 dark:bg-blue-950/30",
    },
  ];

  return (
    <DashboardShell loading={loading} error={error} onRetry={handleRefresh}>
      <DashboardHeader
        user={user}
        greeting
        roleBadge="Driver Partner"
        period={period}
        onPeriodChange={setPeriod}
        periodOptions={{ "1d": "Today (hourly)", "7d": "Last 7 days", "30d": "Last 30 days" }}
        lastUpdated={lastUpdated}
        onRefresh={handleRefresh}
        refreshLoading={false}
      />

      <ResponsiveStatsGrid cards={cards} loading={false} />

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-none shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg">Successful Scans Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="w-full h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={scanTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} className="stroke-muted-foreground" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} className="stroke-muted-foreground" />
                    <Tooltip formatter={(v) => [v, "Scans"]} />
                    <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg">Earnings Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="w-full h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={earnTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} className="stroke-muted-foreground" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} className="stroke-muted-foreground" tickFormatter={(v) => `$${v}`} />
                    <Tooltip formatter={(v) => [`$${Number(v).toFixed(2)}`, "Earnings"]} />
                    <Line type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <CommissionSummary
            commissions={commissions}
            userRole="driver_partner"
            period={period}
            lifetimeEarnings={lifetimeEarnings}
            lifetimeScans={lifetimeScans}
          />
        </div>
      </div>
    </DashboardShell>
  );
}
