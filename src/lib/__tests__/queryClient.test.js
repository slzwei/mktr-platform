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

  it('retries once, but never a rate-limited call', () => {
    const retry = queryClient.getDefaultOptions().queries.retry;
    expect(typeof retry).toBe('function');
    // one retry for ordinary failures
    expect(retry(0, { status: 500 })).toBe(true);
    expect(retry(1, { status: 500 })).toBe(false);
    // 429 is never retried — the retry is charged against the same traffic
    // budget and only keeps the client pinned at the limit
    expect(retry(0, { status: 429 })).toBe(false);
    // errors without a status (network) still get their one retry
    expect(retry(0, new Error('Failed to fetch'))).toBe(true);
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
