import { useQuery } from '@tanstack/react-query';
import { Prospect, Campaign, Commission, Car } from '@/api/entities';
import { dashboard } from '@/api/client';

export function useDashboardData(period = '30d', enabled = true) {
  const prospectsQuery = useQuery({
    queryKey: ['prospects', 'list', { limit: 100 }],
    queryFn: () => Prospect.list({ limit: 100 }),
    enabled,
    select: (data) => Array.isArray(data) ? data : data.prospects || [],
  });

  const campaignsQuery = useQuery({
    queryKey: ['campaigns', 'list', { limit: 100 }],
    queryFn: () => Campaign.list({ limit: 100 }),
    enabled,
    select: (data) => {
      const all = Array.isArray(data) ? data : data.campaigns || [];
      return all.filter((c) => c.status !== 'archived');
    },
  });

  const commissionsQuery = useQuery({
    queryKey: ['commissions', 'list', { limit: 100 }],
    queryFn: () => Commission.list({ limit: 100 }),
    enabled,
    select: (data) => Array.isArray(data) ? data : data.commissions || [],
  });

  const carsQuery = useQuery({
    queryKey: ['cars', 'list'],
    queryFn: () => Car.list().catch(() => []),
    enabled,
  });

  const overviewQuery = useQuery({
    queryKey: ['dashboard', 'overview', period],
    queryFn: () => dashboard.getOverview(period),
    enabled,
  });

  const isLoading =
    prospectsQuery.isLoading ||
    campaignsQuery.isLoading ||
    commissionsQuery.isLoading ||
    carsQuery.isLoading ||
    overviewQuery.isLoading;

  const error =
    prospectsQuery.error ||
    campaignsQuery.error ||
    commissionsQuery.error ||
    overviewQuery.error;

  return {
    prospects: prospectsQuery.data ?? [],
    campaigns: campaignsQuery.data ?? [],
    commissions: commissionsQuery.data ?? [],
    cars: carsQuery.data ?? [],
    overview: overviewQuery.data,
    isLoading,
    error,
  };
}
