import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Global error handlers for React Query.
 * Skips toasting on 401 (the auth layer handles redirect).
 *
 * NOTE: In React Query v5, `onError` on `defaultOptions.queries`/`mutations` was
 * removed and is silently ignored. Global error handling MUST live on
 * QueryCache/MutationCache instead — that is what these handlers are wired to.
 */
function onQueryError(error) {
  if (error?.status === 401) return;
  toast.error(error?.message || 'Something went wrong');
}

function onMutationError(error) {
  if (error?.status === 401) return;
  toast.error(error?.message || 'Operation failed');
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onQueryError }),
  mutationCache: new MutationCache({ onError: onMutationError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
