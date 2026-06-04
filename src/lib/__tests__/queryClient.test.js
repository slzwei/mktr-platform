import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sonner toast before importing queryClient
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

import { queryClient } from '../queryClient';
import { toast } from 'sonner';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('queryClient', () => {
  it('is a QueryClient instance', () => {
    expect(queryClient).toBeDefined();
    expect(queryClient.getDefaultOptions).toBeDefined();
  });

  it('has staleTime set to 30 seconds', () => {
    expect(queryClient.getDefaultOptions().queries.staleTime).toBe(30_000);
  });

  it('has retry set to 1', () => {
    expect(queryClient.getDefaultOptions().queries.retry).toBe(1);
  });

  it('has refetchOnWindowFocus disabled', () => {
    expect(queryClient.getDefaultOptions().queries.refetchOnWindowFocus).toBe(false);
  });

  // NOTE: In React Query v5, `onError` on defaultOptions.queries/mutations is
  // ignored — global error handling lives on QueryCache/MutationCache. These
  // tests drive REAL failures through the client so they verify the framework
  // actually invokes our handlers (the previous test merely read a handler off
  // defaultOptions and called it by hand, which masked the v5 regression).

  it('toasts on a non-401 query error (via QueryCache)', async () => {
    await queryClient
      .fetchQuery({
        queryKey: ['qc-test-500'],
        queryFn: () => Promise.reject({ status: 500, message: 'Server error' }),
        retry: false,
      })
      .catch(() => {});
    expect(toast.error).toHaveBeenCalledWith('Server error');
  });

  it('does NOT toast on a 401 query error (auth layer handles redirect)', async () => {
    await queryClient
      .fetchQuery({
        queryKey: ['qc-test-401'],
        queryFn: () => Promise.reject({ status: 401, message: 'Unauthorized' }),
        retry: false,
      })
      .catch(() => {});
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('toasts on a non-401 mutation error (via MutationCache)', async () => {
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => Promise.reject({ status: 500, message: 'Operation failed' }),
      retry: false,
    });
    await mutation.execute(undefined).catch(() => {});
    expect(toast.error).toHaveBeenCalledWith('Operation failed');
  });

  it('does NOT toast on a 401 mutation error', async () => {
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => Promise.reject({ status: 401, message: 'Unauthorized' }),
      retry: false,
    });
    await mutation.execute(undefined).catch(() => {});
    expect(toast.error).not.toHaveBeenCalled();
  });
});
