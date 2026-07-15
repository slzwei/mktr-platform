/**
 * Switchboard admin v2 — react-query hooks. Query keys carry period/filters so
 * period switches and filter changes are cache-correct by construction.
 */
import { useQuery } from '@tanstack/react-query';
import {
  fetchOverview, fetchAttention, fetchSeries, fetchFunnel,
  fetchProspects, fetchCampaignsList, fetchAgentOptions,
} from '@/api/adminV2';

const STALE_MS = 30_000;

export function useOverview(period) {
  return useQuery({ queryKey: ['adminV2', 'overview', period], queryFn: () => fetchOverview(period), staleTime: STALE_MS });
}

export function useAttention() {
  return useQuery({ queryKey: ['adminV2', 'attention'], queryFn: fetchAttention, staleTime: STALE_MS });
}

export function useSeries(period) {
  return useQuery({ queryKey: ['adminV2', 'series', period], queryFn: () => fetchSeries(period), staleTime: STALE_MS });
}

export function useFunnel(period) {
  return useQuery({ queryKey: ['adminV2', 'funnel', period], queryFn: () => fetchFunnel(period), staleTime: STALE_MS });
}

export function useProspects(params) {
  return useQuery({
    queryKey: ['adminV2', 'prospects', params],
    queryFn: () => fetchProspects(params),
    staleTime: 10_000,
    keepPreviousData: true,
  });
}

export function useCampaignLeaderboard(period) {
  return useQuery({ queryKey: ['adminV2', 'campaigns', period], queryFn: () => fetchCampaignsList(period), staleTime: STALE_MS });
}

export function useAgentOptions(enabled) {
  return useQuery({ queryKey: ['adminV2', 'agentOptions'], queryFn: fetchAgentOptions, staleTime: 300_000, enabled });
}
