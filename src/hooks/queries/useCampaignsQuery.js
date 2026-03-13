import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Campaign } from '@/api/entities';

export function useCampaignsList(params = {}) {
  return useQuery({
    queryKey: ['campaigns', 'list', params],
    queryFn: () => Campaign.list(params),
    select: (data) => {
      const all = Array.isArray(data) ? data : data.campaigns || [];
      return {
        active: all.filter((c) => c.status !== 'archived'),
        archived: all.filter((c) => c.status === 'archived'),
      };
    },
  });
}

export function useCampaign(id) {
  return useQuery({
    queryKey: ['campaigns', 'detail', id],
    queryFn: () => Campaign.get(id),
    enabled: !!id,
  });
}

export function useCampaignAnalytics(id) {
  return useQuery({
    queryKey: ['campaigns', 'analytics', id],
    queryFn: () => Campaign.getAnalytics(id),
    enabled: !!id,
  });
}

export function useDuplicateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }) => Campaign.duplicate(id, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useArchiveCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => Campaign.archive(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useRestoreCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => Campaign.restore(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useDeleteCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => Campaign.permanentDelete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => Campaign.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useUpdateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => Campaign.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}
