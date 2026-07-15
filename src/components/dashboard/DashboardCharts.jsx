import {
 Tooltip,
 ResponsiveContainer,
 Cell,
 PieChart,
 Pie,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function DashboardCharts({ stats, loading }) {
 if (loading) {
 return (
 <div className="grid lg:grid-cols-3 gap-5 mb-8">
 <div className="lg:col-span-3 h-[380px] bg-card rounded-xl border border-border animate-pulse"/>
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
 <Card className="lg:col-span-3 border border-border shadow-none bg-card">
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

 </div>
 );
}
