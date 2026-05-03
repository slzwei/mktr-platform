import { useState, useMemo } from"react";
import { useQuery, useQueryClient } from"@tanstack/react-query";
import { Car } from"@/api/entities";
import { Commission } from"@/api/entities";
import { useAuthStore } from"@/stores/authStore";
import { Card, CardContent, CardHeader, CardTitle } from"@/components/ui/card";
import { Badge } from"@/components/ui/badge";
import { Button } from"@/components/ui/button";
import { Link } from"react-router-dom";
import {
 Car as CarIcon,
 DollarSign,
 TrendingUp,
 ArrowRight,
 Users,
} from"lucide-react";

import DashboardShell from"../components/dashboard/DashboardShell";
import DashboardHeader from"../components/dashboard/DashboardHeader";
import ResponsiveStatsGrid from"../components/dashboard/ResponsiveStatsGrid";
import CommissionSummary from"../components/dashboard/CommissionSummary";
import VehiclePerformance from"../components/dashboard/VehiclePerformance";

export default function FleetOwnerDashboard() {
 const user = useAuthStore((s) => s.user);
 const queryClient = useQueryClient();
 const [period, setPeriod] = useState("30d");

 const { data: cars = [], isLoading: carsLoading, error: carsError } = useQuery({
 queryKey: ['cars', 'fleet-owner', user?.id],
 queryFn: () => Car.filter({ fleet_owner_id: user.id }),
 enabled: !!user,
 });
 const { data: commissions = [], isLoading: commissionsLoading, error: commissionsError } = useQuery({
 queryKey: ['commissions', 'fleet-owner', user?.id],
 queryFn: () => Commission.filter({ fleet_owner_id: user.id }),
 enabled: !!user,
 });

 const stats = { cars, commissions };
 const loading = carsLoading || commissionsLoading;
 const error = (carsError || commissionsError)?.message || null;

 const handleRefresh = () => {
 queryClient.invalidateQueries({ queryKey: ['cars'] });
 queryClient.invalidateQueries({ queryKey: ['commissions'] });
 };

 const periodDays = period ==="7d"? 7 : period ==="30d"? 30 : 90;

 const filteredCommissions = useMemo(() => {
 const cutoff = new Date();
 cutoff.setDate(cutoff.getDate() - periodDays);
 cutoff.setHours(0, 0, 0, 0);
 return stats.commissions.filter((c) => new Date(c.created_date || c.createdAt) >= cutoff);
 }, [stats.commissions, periodDays]);

 const getDashboardMetrics = () => {
 if (!user) return {};

 const activeCars = stats.cars.filter((c) => c.status ==="active").length;
 const periodEarnings = filteredCommissions.reduce((sum, c) => sum + (c.amount_fleet || 0), 0);
 const totalEarnings = stats.commissions.reduce((sum, c) => sum + (c.amount_fleet || 0), 0);

 const nowDate = new Date();
 const currentStart = new Date(nowDate);
 currentStart.setDate(currentStart.getDate() - periodDays);
 currentStart.setHours(0, 0, 0, 0);
 const previousStart = new Date(currentStart);
 previousStart.setDate(previousStart.getDate() - periodDays);

 const previousEarnings = stats.commissions
 .filter((c) => {
 const d = new Date(c.created_date || c.createdAt);
 return d >= previousStart && d < currentStart;
 })
 .reduce((sum, c) => sum + (c.amount_fleet || 0), 0);
 const earningsChange = previousEarnings > 0
 ? ((periodEarnings - previousEarnings) / previousEarnings * 100).toFixed(1)
 : null;

 return { totalCars: stats.cars.length, activeCars, periodEarnings, totalEarnings, earningsChange };
 };

 const metrics = !loading ? getDashboardMetrics() : {};

 const cards = !loading
 ? [
 {
 title:"Total Vehicles",
 value: metrics.totalCars,
 icon: CarIcon,
 trend: `${metrics.activeCars} active`,
 trendUp: true,
 iconColor:"text-primary",
 iconBg:"bg-primary/10",
 linkTo:"/AdminFleet",
 },
 {
 title:"Active Vehicles",
 value: metrics.activeCars,
 icon: Users,
 trend:"Currently operational",
 trendUp: true,
 iconColor:"text-success",
 iconBg:"bg-success/10",
 },
 {
 title:"Period Earnings",
 value: `$${metrics.periodEarnings.toFixed(2)}`,
 icon: DollarSign,
 trend: metrics.earningsChange !== null
 ? `${metrics.earningsChange > 0 ?"+":""}${metrics.earningsChange}% vs prev`
 :"No prior data",
 trendUp: metrics.earningsChange !== null ? metrics.earningsChange > 0 : true,
 iconColor:"text-plum",
 iconBg:"bg-plum/10",
 linkTo:"/AdminCommissions",
 },
 {
 title:"Total Earnings",
 value: `$${metrics.totalEarnings.toFixed(2)}`,
 icon: TrendingUp,
 trend:"All time",
 trendUp: true,
 iconColor:"text-warning",
 iconBg:"bg-warning/10",
 linkTo:"/AdminCommissions",
 },
 ]
 : [];

 return (
 <DashboardShell loading={loading} error={error} onRetry={handleRefresh}>
 <DashboardHeader
 user={user}
 greeting
 roleBadge="Fleet Owner" period={period}
 onPeriodChange={setPeriod}
 periodOptions={{"7d":"Last 7 days","30d":"Last 30 days","90d":"Last 90 days"}}
 lastUpdated={null}
 onRefresh={handleRefresh}
 refreshLoading={loading}
 />

 <ResponsiveStatsGrid cards={cards} loading={loading} />

 <div className="grid lg:grid-cols-3 gap-6">
 <div className="lg:col-span-2 space-y-6">
 {/* Fleet Overview */}
 <Card className="border-none shadow-sm">
 <CardHeader className="border-b border-border">
 <div className="flex justify-between items-center">
 <CardTitle className="text-xl font-bold">My Fleet</CardTitle>
 <Link to={"/AdminFleet"}>
 <Button variant="outline" size="sm">
 Manage Fleet
 <ArrowRight className="w-4 h-4 ml-2"/>
 </Button>
 </Link>
 </div>
 </CardHeader>
 <CardContent className="p-6">
 {stats.cars.length > 0 ? (
 <div className="space-y-4">
 {stats.cars.slice(0, 5).map((car) => (
 <div key={car.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 bg-info/15 rounded-full flex items-center justify-center">
 <CarIcon className="w-5 h-5 text-primary"/>
 </div>
 <div>
 <p className="font-semibold text-foreground">{car.plate_number}</p>
 <p className="text-sm text-muted-foreground">{car.model} {car.color ? `• ${car.color}` :""}</p>
 </div>
 </div>
 <Badge className={
 car.status ==="active"?"bg-success/15 text-success":
 car.status ==="maintenance"?"bg-warning/15 text-warning":
"bg-muted text-muted-foreground" }>
 {car.status}
 </Badge>
 </div>
 ))}
 {stats.cars.length > 5 && (
 <div className="text-center pt-4">
 <Link to={"/AdminFleet"}>
 <Button variant="outline" size="sm">
 View All {stats.cars.length} Vehicles
 </Button>
 </Link>
 </div>
 )}
 </div>
 ) : (
 <div className="text-center py-8 text-muted-foreground">
 <CarIcon className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50"/>
 <p className="font-medium">No vehicles registered</p>
 <p className="text-sm">Add your first vehicle to get started</p>
 </div>
 )}
 </CardContent>
 </Card>

 <VehiclePerformance cars={stats.cars} commissions={stats.commissions} />
 </div>

 <div className="space-y-6">
 <CommissionSummary commissions={stats.commissions} userRole="fleet_owner"/>

 <Card className="border-none shadow-sm">
 <CardHeader>
 <CardTitle className="text-lg">Quick Actions</CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 <Link to={"/AdminFleet"}>
 <Button variant="outline" className="w-full justify-between">
 Manage My Fleet
 <ArrowRight className="w-4 h-4"/>
 </Button>
 </Link>
 <Link to={"/AdminCommissions"}>
 <Button variant="outline" className="w-full justify-between">
 View My Commissions
 <ArrowRight className="w-4 h-4"/>
 </Button>
 </Link>
 </CardContent>
 </Card>
 </div>
 </div>
 </DashboardShell>
 );
}
