import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
 AreaChart,
 Area,
 XAxis,
 YAxis,
 CartesianGrid,
 Tooltip,
 ResponsiveContainer,
 Cell,
 PieChart,
 Pie,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { dashboard } from '@/api/client';
import { format, subDays, eachDayOfInterval } from 'date-fns';

export default function DashboardCharts({ stats, loading }) {
 // Fetch commission trend from analytics endpoint (server-computed daily sums).
 const { data: commissionAnalytics } = useQuery({
 queryKey: ['dashboard', 'analytics', 'commissions', '30d'],
 queryFn: () => dashboard.getAnalytics('commissions', '30d'),
 enabled: !loading,
 staleTime: 60_000,
 });

 // All hooks must be called before any early return.
 const commissionTrend = commissionAnalytics?.commissionTrend || [];
 const revenueData = useMemo(() => {
 if (commissionTrend.length > 0) {
 return commissionTrend.map((d) => ({
 date: d.date ? format(new Date(d.date), 'MMM dd') : d.date,
 revenue: Number(d.amount || 0),
 }));
 }
 // Fallback: empty 30-day grid
 return eachDayOfInterval({ start: subDays(new Date(), 29), end: new Date() }).map((date) => ({
 date: format(date, 'MMM dd'),
 revenue: 0,
 }));
 }, [commissionTrend]);

 if (loading) {
 return (
 <div className="grid lg:grid-cols-3 gap-5 mb-8">
 <div className="lg:col-span-2 h-[380px] bg-card rounded-xl border border-border animate-pulse"/>
 <div className="h-[380px] bg-card rounded-xl border border-border animate-pulse"/>
 </div>
 );
 }

 // 2. Campaign Status Distribution
 // Use overview stats when available (server-computed totals), fall back to entity list.
 const ov = stats.overview || {};
 const campaignsActive = ov.campaignsActive ?? (stats.campaigns || []).filter((c) => c.status === 'active').length;
 const campaignsDraft = (stats.campaigns || []).filter((c) => c.status === 'draft').length;
 const campaignsCompleted = (stats.campaigns || []).filter((c) => c.status === 'completed').length;

 const campaignStatusData = [
 { name: 'Active', value: campaignsActive, color: 'hsl(var(--chart-2))' }, // sage
 { name: 'Draft', value: campaignsDraft, color: 'hsl(var(--muted-foreground))' },
 { name: 'Completed', value: campaignsCompleted, color: 'hsl(var(--chart-3))' }, // dusty slate-blue
 ].filter((d) => d.value > 0);

 return (
 <div className="grid lg:grid-cols-3 gap-5 mb-8">
 {/* Main Revenue Chart */}
 <Card className="lg:col-span-2 border border-border shadow-none bg-card">
 <CardHeader>
 <CardTitle className="text-base font-semibold tracking-tight">Revenue Trend</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="h-[300px] w-full">
 <ResponsiveContainer width="100%" height="100%">
 <AreaChart data={revenueData}>
 <defs>
 <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
 <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.18} />
 <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
 </linearGradient>
 </defs>
 <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border"/>
 <XAxis
 dataKey="date" axisLine={false}
 tickLine={false}
 className="fill-muted-foreground" tick={{ fontSize: 12 }}
 interval={6}
 />
 <YAxis
 axisLine={false}
 tickLine={false}
 className="fill-muted-foreground" tick={{ fontSize: 12 }}
 tickFormatter={(value) => `$${value}`}
 />
 <Tooltip
 contentStyle={{
 borderRadius: '8px',
 border: '1px solid hsl(var(--border))',
 boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.06)',
 background: 'hsl(var(--card))',
 color: 'hsl(var(--card-foreground))',
 }}
 formatter={(value) => [`$${value.toFixed(2)}`, 'Revenue']}
 />
 <Area
 type="monotone" dataKey="revenue" stroke="hsl(var(--chart-1))" strokeWidth={2}
 fillOpacity={1}
 fill="url(#colorRevenue)" />
 </AreaChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>

 {/* Secondary Chart: Campaign Status or Prospects */}
 <Card className="border border-border shadow-none bg-card">
 <CardHeader>
 <CardTitle className="text-base font-semibold tracking-tight">Campaign Status</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="h-[300px] w-full flex items-center justify-center">
 {campaignStatusData.length > 0 ? (
 <ResponsiveContainer width="100%" height="100%">
 <PieChart>
 <Pie data={campaignStatusData} innerRadius={80} outerRadius={100} paddingAngle={5} dataKey="value">
 {campaignStatusData.map((entry, index) => (
 <Cell key={`cell-${index}`} fill={entry.color} />
 ))}
 </Pie>
 <Tooltip
 contentStyle={{
 borderRadius: '8px',
 border: '1px solid hsl(var(--border))',
 boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.06)',
 background: 'hsl(var(--card))',
 color: 'hsl(var(--card-foreground))',
 }}
 />
 {/* Custom Legend moved outside or simplified */}
 </PieChart>
 </ResponsiveContainer>
 ) : (
 <div className="text-muted-foreground text-sm">No campaign data available</div>
 )}
 </div>
 <div className="flex justify-center gap-4 mt-2">
 {campaignStatusData.map((item, i) => (
 <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
 <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
 {item.name} ({item.value})
 </div>
 ))}
 </div>
 </CardContent>
 </Card>

 {/* Third Row: Prospects Growth (Full width if needed, or split) - 
 Actually let's put this full width below if requested, but for now 2 cols is cleaner.
 We will stick to the plan: layout is Responsive.
 */}
 </div>
 );
}
