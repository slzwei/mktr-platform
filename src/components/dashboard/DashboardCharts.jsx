import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Cell, PieChart, Pie
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format, subDays, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';

const CHART_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b'];

export default function DashboardCharts({ stats, loading }) {
    if (loading) {
        return (
            <div className="grid lg:grid-cols-3 gap-6 mb-8">
                <div className="lg:col-span-2 h-96 bg-gray-100 rounded-xl animate-pulse" />
                <div className="h-96 bg-gray-100 rounded-xl animate-pulse" />
            </div>
        );
    }

    // --- Data Processing for Charts ---

    // 1. Revenue Trend (Commissions over last 30 days)
    const last30Days = eachDayOfInterval({
        start: subDays(new Date(), 29),
        end: new Date()
    });

    const revenueData = last30Days.map(date => {
        const dayCommissions = stats.commissions.filter(c =>
            isSameDay(new Date(c.created_date || c.created_at), date)
        );
        const dayTotal = dayCommissions.reduce((sum, c) => sum + (Number(c.amount_driver || 0) + Number(c.amount_fleet || 0)), 0);
        return {
            date: format(date, 'MMM dd'),
            revenue: dayTotal
        };
    });

    // 2. Prospects Growth
    const prospectsData = last30Days.map(date => {
        const dayProspects = stats.prospects.filter(p =>
            isSameDay(new Date(p.created_at || p.created), date)
        );
        return {
            date: format(date, 'MMM dd'),
            count: dayProspects.length
        };
    });

    // 3. Campaign Performance (Top 5 Active)
    // Since we don't have individual click data attached to the campaign object in this list, 
    // we'll visualize campaign status distribution instead for the pie chart.
    const campaignStatusData = [
        { name: 'Active', value: stats.campaigns.filter(c => c.status === 'active').length, color: '#10b981' },
        { name: 'Draft', value: stats.campaigns.filter(c => c.status === 'draft').length, color: '#94a3b8' },
        { name: 'Completed', value: stats.campaigns.filter(c => c.status === 'completed').length, color: '#3b82f6' },
    ].filter(d => d.value > 0);

    return (
        <div className="grid lg:grid-cols-3 gap-6 mb-8">
            {/* Main Revenue Chart */}
            <Card className="lg:col-span-2 border-none shadow-sm">
                <CardHeader>
                    <CardTitle>Revenue Trend</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={revenueData}>
                                <defs>
                                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis
                                    dataKey="date"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                                    interval={6} // Show every 7th day roughly
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                                    tickFormatter={(value) => `$${value}`}
                                />
                                <Tooltip
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    formatter={(value) => [`$${value.toFixed(2)}`, 'Revenue']}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="revenue"
                                    stroke="#3b82f6"
                                    strokeWidth={2}
                                    fillOpacity={1}
                                    fill="url(#colorRevenue)"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* Secondary Chart: Campaign Status or Prospects */}
            <Card className="border-none shadow-sm">
                <CardHeader>
                    <CardTitle>Campaign Status</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="h-[300px] w-full flex items-center justify-center">
                        {campaignStatusData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={campaignStatusData}
                                        innerRadius={80}
                                        outerRadius={100}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {campaignStatusData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    />
                                    {/* Custom Legend moved outside or simplified */}
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="text-gray-400 text-sm">No campaign data available</div>
                        )}
                    </div>
                    <div className="flex justify-center gap-4 mt-2">
                        {campaignStatusData.map((item, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
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
