import { useQuery } from '@tanstack/react-query';
import * as prospectService from '@/services/prospectService';
import * as campaignService from '@/services/campaignService';
import * as userService from '@/services/userService';

export function useDashboardData(period = '30d', enabled = true) {
 // Primary data source: server-computed overview stats.
 const overviewQuery = useQuery({
 queryKey: ['dashboard', 'overview', period],
 queryFn: () => userService.getDashboardOverview(period),
 enabled,
 });

 // Small prospect fetch for RecentActivity feed and AttentionNeeded alerts.
 const prospectsQuery = useQuery({
 queryKey: ['prospects', 'list', { limit: 20, sort: '-createdAt' }],
 queryFn: async () => {
 const result = await prospectService.listProspects({ limit: 20, sort: '-createdAt' });
 return result.prospects || [];
 },
 enabled,
 });

 // Small campaign fetch for AttentionNeeded (checks end dates).
 const campaignsQuery = useQuery({
 queryKey: ['campaigns', 'list', { limit: 20, status: 'active' }],
 queryFn: async () => {
 const all = await campaignService.listCampaigns({ limit: 20 });
 return all.filter((c) => c.status !== 'archived');
 },
 enabled,
 });

 return {
 prospects: prospectsQuery.data ?? [],
 campaigns: campaignsQuery.data ?? [],
 overview: overviewQuery.data,
 isLoading: overviewQuery.isLoading || prospectsQuery.isLoading,
 error: overviewQuery.error || prospectsQuery.error,
 };
}
