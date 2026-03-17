import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as prospectService from '@/services/prospectService';

export function useProspectsList(params = {}) {
  return useQuery({
    queryKey: ['prospects', 'list', params],
    queryFn: () => prospectService.listProspects(params),
  });
}

export function useProspect(id) {
  return useQuery({
    queryKey: ['prospects', 'detail', id],
    queryFn: () => prospectService.getProspect(id),
    enabled: !!id,
  });
}

export function useProspectStats() {
  return useQuery({
    queryKey: ['prospects', 'stats'],
    queryFn: () => prospectService.getProspectStats(),
  });
}

export function useUpdateProspect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => prospectService.updateProspect(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  });
}

export function useDeleteProspect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => prospectService.deleteProspect(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  });
}

export function useAssignProspect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, agentId }) => prospectService.assignProspect(id, agentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  });
}

export function useBulkAssignProspects() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ prospectIds, agentId }) => prospectService.bulkAssignProspects(prospectIds, agentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  });
}
