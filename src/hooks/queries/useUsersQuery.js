import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as userService from '@/services/userService';

export function useCurrentUser() {
  return useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => userService.getCurrentUser(),
  });
}

export function useUsersList(params = {}) {
  return useQuery({
    queryKey: ['users', 'list', params],
    queryFn: () => userService.listUsers(params),
  });
}

export function useAgentsList() {
  return useQuery({
    queryKey: ['users', 'agents'],
    queryFn: () => userService.getAgentsList(),
  });
}

export function useInviteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => userService.inviteUser(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => userService.deleteUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}
