import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { User } from '@/api/entities';

export function useCurrentUser() {
  return useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => User.me(),
  });
}

export function useUsersList(params = {}) {
  return useQuery({
    queryKey: ['users', 'list', params],
    queryFn: () => User.list(params),
  });
}

export function useAgentsList() {
  return useQuery({
    queryKey: ['users', 'agents'],
    queryFn: () => User.getAgents(),
  });
}

export function useInviteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => User.invite(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => User.permanentDelete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}
