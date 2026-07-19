/**
 * Switchboard admin v2 — react-query hooks. Query keys carry period/filters so
 * period switches and filter changes are cache-correct by construction.
 */
import { useQuery } from '@tanstack/react-query';
import {
  fetchOverview, fetchAttention, fetchSeries, fetchFunnel,
  fetchProspects, fetchProspectDetail, fetchCampaignsList, fetchAgentOptions,
  fetchAgentsRoster, fetchCampaignSummary, fetchWallets, fetchWalletLedger, fetchAgentGroups,
} from '@/api/adminV2';

const STALE_MS = 30_000;

/** Full prospect detail for the drawer — includes the consumer-spine journey. */
export function useProspectDetail(id) {
  return useQuery({
    queryKey: ['adminV2', 'prospectDetail', id],
    queryFn: () => fetchProspectDetail(id),
    staleTime: STALE_MS,
    enabled: !!id,
  });
}

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

export function useAgentsRoster(params) {
  return useQuery({ queryKey: ['adminV2', 'agentsRoster', params], queryFn: () => fetchAgentsRoster(params), staleTime: STALE_MS, keepPreviousData: true });
}

export function useCampaignSummary(id) {
  return useQuery({ queryKey: ['adminV2', 'campaignSummary', id], queryFn: () => fetchCampaignSummary(id), staleTime: STALE_MS, enabled: !!id });
}

export function useWallets() {
  return useQuery({ queryKey: ['adminV2', 'wallets'], queryFn: fetchWallets, staleTime: STALE_MS });
}

export function useWalletLedger(agentId, page = 1) {
  return useQuery({
    queryKey: ['adminV2', 'walletLedger', agentId, page],
    queryFn: () => fetchWalletLedger(agentId, { page }),
    enabled: !!agentId,
    keepPreviousData: true,
  });
}

export function useAgentGroups() {
  return useQuery({ queryKey: ['adminV2', 'agentGroups'], queryFn: fetchAgentGroups, staleTime: STALE_MS });
}
