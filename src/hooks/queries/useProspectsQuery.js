import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Prospect } from '@/api/entities';

export function useProspectsList(params = {}) {
  return useQuery({
    queryKey: ['prospects', 'list', params],
    queryFn: () => Prospect.list(params),
  });
}

export function useProspect(id) {
  return useQuery({
    queryKey: ['prospects', 'detail', id],
    queryFn: () => Prospect.getById(id),
    enabled: !!id,
  });
}

export function useProspectStats() {
  return useQuery({
    queryKey: ['prospects', 'stats'],
    queryFn: () => Prospect.getStats(),
  });
}

export function useUpdateProspect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => Prospect.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  });
}

export function useDeleteProspect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => Prospect.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  });
}

export function useAssignProspect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, agentId }) => Prospect.assign(id, agentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  });
}

export function useBulkAssignProspects() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ prospectIds, agentId }) => Prospect.bulkAssign(prospectIds, agentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  });
}
