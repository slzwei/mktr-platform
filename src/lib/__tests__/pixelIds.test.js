import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveMetaPixelId, resolveTikTokPixelId, resolvePixelIds } from '../pixelIds';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolvePixelIds', () => {
  it('prefers the per-campaign override over the build env id', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', 'env-meta');
    vi.stubEnv('VITE_TIKTOK_PIXEL_ID', 'env-tiktok');
    const campaign = { metaPixelId: 'camp-meta', tiktokPixelId: 'camp-tiktok' };
    expect(resolvePixelIds(campaign)).toEqual({
      metaPixelId: 'camp-meta',
      tiktokPixelId: 'camp-tiktok',
    });
  });

  it('falls back to the env id when the campaign has no override', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', 'env-meta');
    vi.stubEnv('VITE_TIKTOK_PIXEL_ID', 'env-tiktok');
    expect(resolveMetaPixelId({})).toBe('env-meta');
    expect(resolveTikTokPixelId({})).toBe('env-tiktok');
  });

  it('resolves each platform independently — one override does not affect the other', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', 'env-meta');
    vi.stubEnv('VITE_TIKTOK_PIXEL_ID', 'env-tiktok');
    const campaign = { metaPixelId: 'camp-meta' };
    expect(resolvePixelIds(campaign)).toEqual({
      metaPixelId: 'camp-meta',
      tiktokPixelId: 'env-tiktok',
    });
  });

  it('returns empty strings (never undefined) when neither source has an id', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '');
    vi.stubEnv('VITE_TIKTOK_PIXEL_ID', '');
    expect(resolvePixelIds({})).toEqual({ metaPixelId: '', tiktokPixelId: '' });
    expect(resolveMetaPixelId(null)).toBe('');
    expect(resolveTikTokPixelId(undefined)).toBe('');
  });

  it('an override works with no env id at all (the server-side path relies on this)', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '');
    expect(resolveMetaPixelId({ metaPixelId: 'camp-only' })).toBe('camp-only');
  });
});
