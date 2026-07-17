import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

/**
 * Studio server-data hooks (PR 3) — both advisory and fail-silent, exactly
 * like the legacy CampaignReadinessBanner: a fetch failure never blocks
 * editing, it just leaves the pill on design-only checks.
 */

export function useServerReadiness(campaignId) {
  return useQuery({
    queryKey: ['studio', 'readiness', campaignId],
    queryFn: async () => {
      const res = await apiClient.get(`/campaigns/${campaignId}/readiness`);
      return res?.data?.readiness || null;
    },
    enabled: !!campaignId,
    staleTime: 30_000,
    retry: false,
  });
}

/** The composed marketplace preview DTO (ops facts + the 7-key publication gate). */
export function useMarketplacePreview(campaignId) {
  return useQuery({
    queryKey: ['studio', 'marketplace-preview', campaignId],
    queryFn: async () => {
      const res = await apiClient.get(`/campaigns/${campaignId}/marketplace-preview`);
      return res?.data?.campaign || null;
    },
    enabled: !!campaignId,
    staleTime: 30_000,
    retry: false,
  });
}
