import { describe, it, expect, vi } from 'vitest';

// Mock sonner toast before importing queryClient
vi.mock('sonner', () => ({
 toast: {
 error: vi.fn(),
 },
}));

import { queryClient } from '../queryClient';
import { toast } from 'sonner';

describe('queryClient', () => {
 it('is a QueryClient instance', () => {
 expect(queryClient).toBeDefined();
 expect(queryClient.getDefaultOptions).toBeDefined();
 });

 it('has staleTime set to 30 seconds', () => {
 const defaults = queryClient.getDefaultOptions();
 expect(defaults.queries.staleTime).toBe(30_000);
 });

 it('has retry set to 1', () => {
 const defaults = queryClient.getDefaultOptions();
 expect(defaults.queries.retry).toBe(1);
 });

 it('has refetchOnWindowFocus disabled', () => {
 const defaults = queryClient.getDefaultOptions();
 expect(defaults.queries.refetchOnWindowFocus).toBe(false);
 });

 it('query onError skips toast for 401 errors', () => {
 const defaults = queryClient.getDefaultOptions();
 const onError = defaults.queries.onError;
 onError({ status: 401, message: 'Unauthorized' });
 expect(toast.error).not.toHaveBeenCalled();
 });

 it('query onError shows toast for non-401 errors', () => {
 const defaults = queryClient.getDefaultOptions();
 const onError = defaults.queries.onError;
 onError({ status: 500, message: 'Server error' });
 expect(toast.error).toHaveBeenCalledWith('Server error');
 });

 it('mutation onError skips toast for 401 errors', () => {
 const defaults = queryClient.getDefaultOptions();
 const onError = defaults.mutations.onError;
 onError({ status: 401 });
 // toast.error should not have been called again
 expect(toast.error).toHaveBeenCalledTimes(1); // only from previous test
 });
});
