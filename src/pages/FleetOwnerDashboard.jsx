import { useState, useEffect, useMemo } from "react";
import { Car } from "@/api/entities";
import { Commission } from "@/api/entities";
import { auth } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { 
  Car as CarIcon, 
  DollarSign, 
  TrendingUp,
  ArrowRight,
  Users,
  AlertTriangle,
  AlertCircle,
  RefreshCw
} from "lucide-react";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import StatsCard from "../components/dashboard/StatsCard";
import CommissionSummary from "../components/dashboard/CommissionSummary";
import LastUpdated from "../components/dashboard/LastUpdated";
import VehiclePerformance from "../components/dashboard/VehiclePerformance";

export default function FleetOwnerDashboard() {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({
    cars: [],
    commissions: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [period, setPeriod] = useState('30d');

  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const periodLabel = period === '7d' ? 'Last 7 days' : period === '30d' ? 'Last 30 days' : 'Last 90 days';

  const filteredCommissions = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - periodDays);
    cutoff.setHours(0, 0, 0, 0);
    return stats.commissions.filter(c =>
      new Date(c.created_date || c.createdAt) >= cutoff
    );
  }, [stats.commissions, periodDays]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setError(null);
    try {
      const userData = await auth.getCurrentUser();
      setUser(userData);

      // For fleet owners, load their cars and commissions
      if (userData.role === 'fleet_owner') {
        const [cars, commissions] = await Promise.all([
          Car.filter({ fleet_owner_id: userData.id }),
          Commission.filter({ fleet_owner_id: userData.id })
        ]);
        setStats({ cars, commissions });
        setLastUpdated(new Date());
      } else {
        setStats({ cars: [], commissions: [] });
        console.warn('User is not a fleet owner.');
      }
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError(err.message || 'Something went wrong while loading the dashboard.');
    }
    setLoading(false);
  };

  const getDashboardMetrics = () => {
    if (!user) return {};

    const activeCars = stats.cars.filter(c => c.status === 'active').length;
    const periodEarnings = filteredCommissions
      .reduce((sum, c) => sum + (c.amount_fleet || 0), 0);

    const totalEarnings = stats.commissions
      .reduce((sum, c) => sum + (c.amount_fleet || 0), 0);

    // Previous period earnings comparison
    const nowDate = new Date();
    const currentStart = new Date(nowDate);
    currentStart.setDate(currentStart.getDate() - periodDays);
    currentStart.setHours(0, 0, 0, 0);
    const previousStart = new Date(currentStart);
    previousStart.setDate(previousStart.getDate() - periodDays);

    const previousEarnings = stats.commissions
      .filter(c => {
        const d = new Date(c.created_date || c.createdAt);
        return d >= previousStart && d < currentStart;
      })
      .reduce((sum, c) => sum + (c.amount_fleet || 0), 0);
    const earningsChange = previousEarnings > 0
      ? ((periodEarnings - previousEarnings) / previousEarnings * 100).toFixed(1)
      : null;

    return {
      totalCars: stats.cars.length,
      activeCars,
      periodEarnings,
      totalEarnings,
      earningsChange
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

  // If user is not a fleet owner
  if (!user || user.role !== 'fleet_owner') {
    return (
      <div className="p-6 lg:p-8 flex items-center justify-center min-h-[calc(100vh-64px)]">
        <Card className="max-w-md w-full text-center p-8">
          <CardHeader>
            <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
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
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              Fleet Owner
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
                  title="Total Vehicles"
                  value={metrics.totalCars}
                  icon={CarIcon}
                  bgColor="bg-blue-500"
                  trend={`${metrics.activeCars} active`}
                  linkTo={createPageUrl("AdminFleet")}
                />
                <StatsCard
                  title="Active Vehicles"
                  value={metrics.activeCars}
                  icon={Users}
                  bgColor="bg-green-500"
                  trend="Currently operational"
                />
                <StatsCard
                  title="Period Earnings"
                  value={`$${metrics.periodEarnings.toFixed(2)}`}
                  icon={DollarSign}
                  bgColor="bg-purple-500"
                  trend={metrics.earningsChange !== null ? `${metrics.earningsChange > 0 ? '+' : ''}${metrics.earningsChange}% vs prev` : 'No prior data'}
                  linkTo={createPageUrl("AdminCommissions")}
                />
                <StatsCard
                  title="Total Earnings"
                  value={`$${metrics.totalEarnings.toFixed(2)}`}
                  icon={TrendingUp}
                  bgColor="bg-orange-500"
                  linkTo={createPageUrl("AdminCommissions")}
                />
              </div>
              {/* Mobile: horizontal scroll */}
              <div
                className="flex md:hidden gap-4 overflow-x-auto pb-4 snap-x snap-mandatory -mx-6 px-6"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
              >
                <div className="min-w-[240px] snap-center shrink-0">
                  <StatsCard
                    title="Total Vehicles"
                    value={metrics.totalCars}
                    icon={CarIcon}
                    bgColor="bg-blue-500"
                    trend={`${metrics.activeCars} active`}
                    linkTo={createPageUrl("AdminFleet")}
                  />
                </div>
                <div className="min-w-[240px] snap-center shrink-0">
                  <StatsCard
                    title="Active Vehicles"
                    value={metrics.activeCars}
                    icon={Users}
                    bgColor="bg-green-500"
                    trend="Currently operational"
                  />
                </div>
                <div className="min-w-[240px] snap-center shrink-0">
                  <StatsCard
                    title="Period Earnings"
                    value={`$${metrics.periodEarnings.toFixed(2)}`}
                    icon={DollarSign}
                    bgColor="bg-purple-500"
                    trend={metrics.earningsChange !== null ? `${metrics.earningsChange > 0 ? '+' : ''}${metrics.earningsChange}% vs prev` : 'No prior data'}
                    linkTo={createPageUrl("AdminCommissions")}
                  />
                </div>
                <div className="min-w-[240px] snap-center shrink-0">
                  <StatsCard
                    title="Total Earnings"
                    value={`$${metrics.totalEarnings.toFixed(2)}`}
                    icon={TrendingUp}
                    bgColor="bg-orange-500"
                    linkTo={createPageUrl("AdminCommissions")}
                  />
                </div>
              </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {/* Fleet Overview */}
                <Card className="shadow-md">
                  <CardHeader className="border-b border-gray-100">
                    <div className="flex justify-between items-center">
                      <CardTitle className="text-xl font-bold">My Fleet</CardTitle>
                      <Link to={createPageUrl("AdminFleet")}>
                        <Button variant="outline" size="sm">
                          Manage Fleet
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent className="p-6">
                    {stats.cars.length > 0 ? (
                      <div className="space-y-4">
                        {stats.cars.slice(0, 5).map((car) => (
                          <div key={car.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                                <CarIcon className="w-5 h-5 text-blue-600" />
                              </div>
                              <div>
                                <p className="font-semibold text-gray-900">{car.plate_number}</p>
                                <p className="text-sm text-gray-500">{car.model} • {car.color}</p>
                              </div>
                            </div>
                            <Badge className={
                              car.status === 'active' ? 'bg-green-100 text-green-800' :
                              car.status === 'maintenance' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-gray-100 text-gray-800'
                            }>
                              {car.status}
                            </Badge>
                          </div>
                        ))}
                        {stats.cars.length > 5 && (
                          <div className="text-center pt-4">
                            <Link to={createPageUrl("AdminFleet")}>
                              <Button variant="outline" size="sm">
                                View All {stats.cars.length} Vehicles
                              </Button>
                            </Link>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <CarIcon className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                        <p className="font-medium">No vehicles registered</p>
                        <p className="text-sm">Add your first vehicle to get started</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <VehiclePerformance cars={stats.cars} commissions={stats.commissions} />
              </div>

              <div className="space-y-6">
                <CommissionSummary
                  commissions={stats.commissions}
                  userRole="fleet_owner"
                />

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Link to={createPageUrl("AdminFleet")}>
                      <Button variant="outline" className="w-full justify-between">
                        Manage My Fleet
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </Link>
                    <Link to={createPageUrl("AdminCommissions")}>
                      <Button variant="outline" className="w-full justify-between">
                        View My Commissions
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </Link>
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