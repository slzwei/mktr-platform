import { useQuery } from '@tanstack/react-query';
import { Prospect, Campaign, Car } from '@/api/entities';
import { dashboard } from '@/api/client';

export function useDashboardData(period = '30d', enabled = true) {
  // Primary data source: server-computed overview stats.
  // This replaces the bulk entity fetches (prospects/100, campaigns/100,
  // commissions/100) that were previously computed client-side.
  const overviewQuery = useQuery({
    queryKey: ['dashboard', 'overview', period],
    queryFn: () => dashboard.getOverview(period),
    enabled,
  });

  // Keep a small prospect fetch for the RecentActivity feed, AttentionNeeded
  // alerts, and TopPerformers widget — these need actual entity objects.
  const prospectsQuery = useQuery({
    queryKey: ['prospects', 'list', { limit: 20, sort: '-createdAt' }],
    queryFn: () => Prospect.list({ limit: 20, sort: '-createdAt' }),
    enabled,
    select: (data) => Array.isArray(data) ? data : data.prospects || [],
  });

  // Keep a small campaign fetch for AttentionNeeded (checks end dates).
  const campaignsQuery = useQuery({
    queryKey: ['campaigns', 'list', { limit: 20, status: 'active' }],
    queryFn: () => Campaign.list({ limit: 20 }),
    enabled,
    select: (data) => {
      const all = Array.isArray(data) ? data : data.campaigns || [];
      return all.filter((c) => c.status !== 'archived');
    },
  });

  // Cars count is provided by the overview endpoint (fleet.totalCars).
  // Keep a lightweight query only for fleet size display.
  const carsQuery = useQuery({
    queryKey: ['cars', 'list'],
    queryFn: () => Car.list().catch(() => []),
    enabled,
  });

  const isLoading =
    overviewQuery.isLoading ||
    prospectsQuery.isLoading;

  const error =
    overviewQuery.error ||
    prospectsQuery.error;

  return {
    prospects: prospectsQuery.data ?? [],
    campaigns: campaignsQuery.data ?? [],
    commissions: [],  // No longer fetched — totals come from overview
    cars: carsQuery.data ?? [],
    overview: overviewQuery.data,
    isLoading,
    error,
  };
}
