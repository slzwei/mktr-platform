import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as campaignService from '@/services/campaignService';

export function useCampaignsList(params = {}) {
 return useQuery({
 queryKey: ['campaigns', 'list', params],
 queryFn: () => campaignService.listCampaigns(params),
 select: (all) => ({
 active: all.filter((c) => c.status !== 'archived'),
 archived: all.filter((c) => c.status === 'archived'),
 }),
 });
}

/**
 * Shared hook for campaign lookup (name resolution by id).
 * Returns the raw array of campaigns (not split by status).
 */
export function useCampaignLookup() {
 return useQuery({
 queryKey: ['campaigns', 'all-for-lookup'],
 queryFn: () => campaignService.listCampaigns({ limit: 1000 }),
 staleTime: 60_000,
 });
}

export function useCampaign(id) {
 return useQuery({
 queryKey: ['campaigns', 'detail', id],
 queryFn: () => campaignService.getCampaign(id),
 enabled: !!id,
 });
}

export function useCampaignAnalytics(id) {
 return useQuery({
 queryKey: ['campaigns', 'analytics', id],
 queryFn: () => campaignService.getCampaignAnalytics(id),
 enabled: !!id,
 });
}

export function useDuplicateCampaign() {
 const queryClient = useQueryClient();
 return useMutation({
 mutationFn: ({ id, name }) => campaignService.duplicateCampaign(id, name),
 onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
 });
}

export function useArchiveCampaign() {
 const queryClient = useQueryClient();
 return useMutation({
 mutationFn: (id) => campaignService.archiveCampaign(id),
 onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
 });
}

export function useRestoreCampaign() {
 const queryClient = useQueryClient();
 return useMutation({
 mutationFn: (id) => campaignService.restoreCampaign(id),
 onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
 });
}

export function useDeleteCampaign() {
 const queryClient = useQueryClient();
 return useMutation({
 mutationFn: (id) => campaignService.permanentDeleteCampaign(id),
 onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
 });
}

export function useCreateCampaign() {
 const queryClient = useQueryClient();
 return useMutation({
 mutationFn: (data) => campaignService.createCampaign(data),
 onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
 });
}

export function useUpdateCampaign() {
 const queryClient = useQueryClient();
 return useMutation({
 mutationFn: ({ id, data }) => campaignService.updateCampaign(id, data),
 onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
 });
}

// --- Campaign Launch Workspace ---

export function useCampaignDeliveryPool(id) {
 return useQuery({
 queryKey: ['campaignDeliveryPool', id],
 queryFn: () => campaignService.getCampaignDeliveryPool(id),
 enabled: !!id,
 });
}

export function useBulkAssignCampaignPackage(id) {
 const queryClient = useQueryClient();
 return useMutation({
 mutationFn: (payload) => campaignService.bulkAssignCampaignPackage(id, payload),
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ['campaignDeliveryPool', id] });
 queryClient.invalidateQueries({ queryKey: ['leadPackages'] });
 queryClient.invalidateQueries({ queryKey: ['agents'] });
 },
 });
}

export function useSetCampaignLaunchState(id) {
 const queryClient = useQueryClient();
 return useMutation({
 mutationFn: (payload) => campaignService.setCampaignLaunchState(id, payload),
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ['campaigns'] });
 queryClient.invalidateQueries({ queryKey: ['campaignDeliveryPool', id] });
 },
 });
}
