/**
 * Switchboard admin v2 — react-query hooks. Query keys carry period/filters so
 * period switches and filter changes are cache-correct by construction.
 */
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  fetchOverview, fetchAttention, fetchSeries, fetchFunnel,
  fetchProspects, fetchProspectDetail, fetchProspectProfile, fetchConsumers, fetchCampaignsList, fetchAgentOptions,
  fetchAgentsRoster, fetchCampaignSummary, fetchWallets, fetchWalletLedger, fetchAgentGroups,
  fetchScoringSheet, fetchScoringHistory, fetchScoringProgress,
} from '@/api/adminV2';

const STALE_MS = 30_000;

/** Full prospect detail — includes the consumer-spine journey. */
export function useProspectDetail(id) {
  return useQuery({
    queryKey: ['adminV2', 'prospectDetail', id],
    queryFn: () => fetchProspectDetail(id),
    staleTime: STALE_MS,
    enabled: !!id,
  });
}

/** Lead Profile page — detail + the ?include=profile enrichments. */
export function useProspectProfile(id) {
  return useQuery({
    queryKey: ['adminV2', 'prospectProfile', id],
    queryFn: () => fetchProspectProfile(id),
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
    // RQ v5: the v4 `keepPreviousData: true` flag was removed and silently
    // ignored here — this is the working idiom (page flips keep prior rows).
    placeholderData: keepPreviousData,
  });
}

/** People directory list (/AdminPeople). */
export function useConsumers(params) {
  return useQuery({
    queryKey: ['adminV2', 'consumers', params],
    queryFn: () => fetchConsumers(params),
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });
}

export function useCampaignLeaderboard(period) {
  return useQuery({ queryKey: ['adminV2', 'campaigns', period], queryFn: () => fetchCampaignsList(period), staleTime: STALE_MS });
}

export function useAgentOptions(enabled) {
  return useQuery({ queryKey: ['adminV2', 'agentOptions'], queryFn: fetchAgentOptions, staleTime: 300_000, enabled });
}

export function useAgentsRoster(params) {
  // placeholderData, not the removed v4 `keepPreviousData: true` (P2-16) —
  // see useProspects above for the same idiom.
  return useQuery({ queryKey: ['adminV2', 'agentsRoster', params], queryFn: () => fetchAgentsRoster(params), staleTime: STALE_MS, placeholderData: keepPreviousData });
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
    placeholderData: keepPreviousData,
  });
}

export function useAgentGroups() {
  return useQuery({ queryKey: ['adminV2', 'agentGroups'], queryFn: fetchAgentGroups, staleTime: STALE_MS });
}

export function useScoringSheet(campaignId) {
  return useQuery({
    queryKey: ['adminV2', 'scoringSheet', campaignId],
    queryFn: () => fetchScoringSheet(campaignId),
    staleTime: STALE_MS,
    enabled: !!campaignId,
    // 404 = the surface is switched off — an answer, not a transient.
    retry: (count, err) => err?.status !== 404 && count < 2,
  });
}

export function useScoringHistory(campaignId, enabled) {
  return useQuery({
    queryKey: ['adminV2', 'scoringHistory', campaignId],
    queryFn: () => fetchScoringHistory(campaignId),
    staleTime: STALE_MS,
    enabled: !!campaignId && enabled !== false,
    retry: (count, err) => err?.status !== 404 && count < 2,
  });
}

export function useScoringProgress(campaignId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['adminV2', 'scoringProgress', campaignId],
    queryFn: () => fetchScoringProgress(campaignId),
    enabled: !!campaignId && enabled,
    // Poll only while the card is mounted AND the regrade is incomplete —
    // the interval callback sees the latest payload and shuts itself off.
    refetchInterval: (query) => (query.state.data && !query.state.data.complete ? 30_000 : false),
    retry: (count, err) => err?.status !== 404 && count < 2,
  });
}
