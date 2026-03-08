import { useEffect, useState } from "react";
import { auth, entities, apiClient } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, BarChart3, AlertTriangle } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import CommissionSummary from "@/components/dashboard/CommissionSummary";
import { format } from "date-fns";

export default function DriverDashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("30d");
  const [commissions, setCommissions] = useState([]);
  const [scanTrend, setScanTrend] = useState([]);
  const [earnTrend, setEarnTrend] = useState([]);
  const [lifetimeEarnings, setLifetimeEarnings] = useState(0);
  const [lifetimeScans, setLifetimeScans] = useState(0);

  useEffect(() => {
    loadBase();
  }, []);

  useEffect(() => {
    if (user) {
      loadData(period);
      loadLifetime();
    }
  }, [user, period]);

  const loadBase = async () => {
    try {
      const me = await auth.getCurrentUser();
      setUser(me);
    } catch (e) {
      console.error("Failed to load user", e);
    } finally {
      setLoading(false);
    }
  };

  const loadData = async (p) => {
    try {
      try {
        const resp = await apiClient.get(`/dashboard/driver/commissions`, { period: p });
        setCommissions(resp?.data?.commissions || []);
      } catch (e) {
        setCommissions([]);
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
      setScanTrend(scans);
      try {
        const commResp = await apiClient.get(`/dashboard/driver/commissions`, { period: p });
        const comms = commResp?.data?.commissions || [];
        const map = new Map();
        if (p === '1d') {
          for (let h = 0; h < 24; h++) map.set(`${h}:00`, 0);
          for (const c of comms) {
            const dt = new Date(c.created_date);
            const hour = dt.getHours();
            const key = `${hour}:00`;
            if (map.has(key)) map.set(key, (map.get(key) || 0) + (Number(c.amount_driver) || 0));
          }
          setEarnTrend(Array.from(map.entries()).map(([label, amount]) => ({ label, amount })));
        } else {
          const now = new Date();
          const days = p === '7d' ? 7 : 30;
          for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const key = d.toISOString().split('T')[0];
            map.set(key, 0);
          }
          for (const c of comms) {
            const key = new Date(c.created_date).toISOString().split('T')[0];
            if (map.has(key)) map.set(key, (map.get(key) || 0) + (Number(c.amount_driver) || 0));
          }
          setEarnTrend(Array.from(map.entries()).map(([day, amount]) => ({ label: `${day.slice(8)}-${day.slice(5, 7)}`, amount })));
        }
      } catch (_) {
        setEarnTrend([]);
      }
    } catch (e) {
      console.error("Failed to load driver data", e);
    }
  };

  const loadLifetime = async () => {
    try {
      const [commResp, scansResp] = await Promise.all([
        apiClient.get(`/dashboard/driver/commissions`, { period: 'all' }),
        apiClient.get(`/dashboard/driver/scans`, { period: 'all' })
      ]);
      const lifetimeCommissions = commResp?.data?.commissions || [];
      const totalEarned = lifetimeCommissions.reduce((sum, c) => sum + (Number(c.amount_driver) || 0), 0);
      setLifetimeEarnings(totalEarned);
      setLifetimeScans(scansResp?.data?.total || 0);
    } catch (e) { }
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

  if (!user || user.role !== 'driver_partner') {
    return (
      <div className="p-6 lg:p-8 flex items-center justify-center min-h-[calc(100vh-64px)]">
        <Card className="max-w-md w-full text-center p-8">
          <CardHeader>
            <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
            <CardTitle>Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">You do not have permission to view this dashboard.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome back, {user?.full_name || user?.fullName || 'Driver'}!</h1>
          <div className="flex items-center gap-4 text-gray-600">
            <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">Driver Partner</Badge>
            <span className="text-sm">{format(new Date(), 'EEEE, dd MMMM yyyy')}</span>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card className="shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-lg">Successful Scans Trend</CardTitle>
                <div className="w-40">
                  <Select value={period} onValueChange={setPeriod}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30d">Last 30 days</SelectItem>
                      <SelectItem value="7d">Last 7 days</SelectItem>
                      <SelectItem value="1d">Today (hourly)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <div className="w-full h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={scanTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                      <Tooltip formatter={(v) => [v, 'Scans']} labelStyle={{ color: '#64748b' }} />
                      <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card className="shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-lg">Earnings Trend</CardTitle>
                <div className="w-40">
                  <Select value={period} onValueChange={setPeriod}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30d">Last 30 days</SelectItem>
                      <SelectItem value="7d">Last 7 days</SelectItem>
                      <SelectItem value="1d">Today (hourly)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <div className="w-full h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={earnTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" tickFormatter={(v) => `$${v}`} />
                      <Tooltip formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Earnings']} labelStyle={{ color: '#64748b' }} />
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
      </div>
    </div>
  );
}
