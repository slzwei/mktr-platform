import { describe, it, expect, vi, afterEach } from 'vitest';
import { shouldSuppressSplash, safeSessionGet, safeSessionSet } from '@/lib/splash';

// Default test env has no VITE_BRAND → isRedeem() === false (mktr build).
describe('shouldSuppressSplash — mktr (operator) build', () => {
  it('suppresses on redirect shims + public lead-capture / preview surfaces', () => {
    expect(shouldSuppressSplash('/t/abc123')).toBe(true);
    expect(shouldSuppressSplash('/share/xyz')).toBe(true);
    expect(shouldSuppressSplash('/p/some-slug')).toBe(true);
    expect(shouldSuppressSplash('/LeadCapture')).toBe(true);
    expect(shouldSuppressSplash('/lead-capture')).toBe(true);
  });

  it('keeps the splash on admin / marketing routes', () => {
    expect(shouldSuppressSplash('/AdminDashboard')).toBe(false);
    expect(shouldSuppressSplash('/')).toBe(false);
    expect(shouldSuppressSplash('/Homepage')).toBe(false);
    expect(shouldSuppressSplash('/admin/campaigns/123/workspace')).toBe(false);
  });
});

describe('shouldSuppressSplash — redeem (customer) build', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/brand');
    vi.resetModules();
  });

  it('always suppresses, even on admin/apex routes', async () => {
    vi.resetModules();
    vi.doMock('@/lib/brand', () => ({ isRedeem: () => true }));
    const { shouldSuppressSplash: suppress } = await import('@/lib/splash');
    expect(suppress('/AdminDashboard')).toBe(true);
    expect(suppress('/')).toBe(true);
  });
});

describe('safe session storage helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('swallow errors when storage is blocked (private mode)', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => safeSessionSet('k', '1')).not.toThrow();
    expect(safeSessionGet('k')).toBe(null);
  });
});
