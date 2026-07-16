import { describe, it, expect, vi, afterEach } from 'vitest';

// Module-scope constant → re-import per case via resetModules.
const load = async () => (await import('@/lib/uploadLimits')).MAX_UPLOAD_SIZE_MB;

describe('MAX_UPLOAD_SIZE_MB', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to 10 (the backend default) when the env var is unset', async () => {
    vi.resetModules();
    expect(await load()).toBe(10);
  });

  it('honors a positive integer override', async () => {
    vi.stubEnv('VITE_MAX_UPLOAD_SIZE_MB', '25');
    vi.resetModules();
    expect(await load()).toBe(25);
  });

  it.each(['abc', '-5', '0', ''])('falls back to 10 for junk value %j', async (value) => {
    vi.stubEnv('VITE_MAX_UPLOAD_SIZE_MB', value);
    vi.resetModules();
    expect(await load()).toBe(10);
  });
});
