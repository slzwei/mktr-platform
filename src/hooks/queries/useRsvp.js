import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/rsvp';

const STALE_MS = 15_000;

export function useRsvpEvents() {
  return useQuery({ queryKey: ['rsvp', 'events'], queryFn: api.listRsvpEvents, staleTime: STALE_MS });
}

export function useRsvpEvent(id) {
  return useQuery({ queryKey: ['rsvp', 'event', id], queryFn: () => api.fetchRsvpEvent(id), enabled: !!id, staleTime: STALE_MS });
}

export function useRsvpResponses(id, cursor) {
  return useQuery({
    queryKey: ['rsvp', 'responses', id, cursor || ''],
    queryFn: () => api.fetchRsvpResponses(id, { cursor }),
    enabled: !!id,
    staleTime: STALE_MS,
  });
}

function useInvalidating(mutationFn) {
  const qc = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => qc.invalidateQueries({ queryKey: ['rsvp'] }) });
}

export const useCreateRsvpEvent = () => useInvalidating((body) => api.createRsvpEvent(body));
export const useUpdateRsvpEvent = () => useInvalidating(({ id, patch }) => api.updateRsvpEvent(id, patch));
export const usePublishRsvpEvent = () => useInvalidating((id) => api.publishRsvpEvent(id));
export const useCloseRsvpEvent = () => useInvalidating((id) => api.closeRsvpEvent(id));
export const useDeleteRsvpEvent = () => useInvalidating((id) => api.deleteRsvpEvent(id));
export const useUpdateRsvpResponse = () => useInvalidating(({ id, responseId, patch }) => api.updateRsvpResponse(id, responseId, patch));
