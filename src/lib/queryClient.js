import { QueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/use-toast';

/**
 * Global error handler for React Query.
 * Skips toasting on 401 (the auth layer handles redirect).
 */
function onQueryError(error) {
  if (error?.status === 401) return;
  toast({
    title: 'Error',
    description: error?.message || 'Something went wrong',
    variant: 'destructive',
  });
}

function onMutationError(error) {
  if (error?.status === 401) return;
  toast({
    title: 'Error',
    description: error?.message || 'Operation failed',
    variant: 'destructive',
  });
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
      onError: onQueryError,
    },
    mutations: {
      onError: onMutationError,
    },
  },
});
