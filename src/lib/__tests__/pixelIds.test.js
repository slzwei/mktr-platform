import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  resolveMetaPixelId,
  resolveTikTokPixelId,
  resolveGoogleAdsConversionId,
  resolveGoogleAdsLeadLabel,
  resolvePixelIds,
} from '../pixelIds';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolvePixelIds', () => {
  it('prefers the per-campaign override over the build env id', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', 'env-meta');
    vi.stubEnv('VITE_TIKTOK_PIXEL_ID', 'env-tiktok');
    vi.stubEnv('VITE_GOOGLE_ADS_CONVERSION_ID', 'env-google');
    const campaign = {
      metaPixelId: 'camp-meta',
      tiktokPixelId: 'camp-tiktok',
      googleAdsConversionId: 'camp-google',
    };
    expect(resolvePixelIds(campaign)).toEqual({
      metaPixelId: 'camp-meta',
      tiktokPixelId: 'camp-tiktok',
      googleAdsConversionId: 'camp-google',
    });
  });

  it('falls back to the env id when the campaign has no override', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', 'env-meta');
    vi.stubEnv('VITE_TIKTOK_PIXEL_ID', 'env-tiktok');
    vi.stubEnv('VITE_GOOGLE_ADS_CONVERSION_ID', 'env-google');
    vi.stubEnv('VITE_GOOGLE_ADS_LEAD_LABEL', 'env-label');
    expect(resolveMetaPixelId({})).toBe('env-meta');
    expect(resolveTikTokPixelId({})).toBe('env-tiktok');
    expect(resolveGoogleAdsConversionId({})).toBe('env-google');
    expect(resolveGoogleAdsLeadLabel({})).toBe('env-label');
  });

  it('resolves each platform independently — one override does not affect the other', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', 'env-meta');
    vi.stubEnv('VITE_TIKTOK_PIXEL_ID', 'env-tiktok');
    vi.stubEnv('VITE_GOOGLE_ADS_CONVERSION_ID', 'env-google');
    const campaign = { metaPixelId: 'camp-meta' };
    expect(resolvePixelIds(campaign)).toEqual({
      metaPixelId: 'camp-meta',
      tiktokPixelId: 'env-tiktok',
      googleAdsConversionId: 'env-google',
    });
  });

  it('returns empty strings (never undefined) when neither source has an id', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '');
    vi.stubEnv('VITE_TIKTOK_PIXEL_ID', '');
    vi.stubEnv('VITE_GOOGLE_ADS_CONVERSION_ID', '');
    vi.stubEnv('VITE_GOOGLE_ADS_LEAD_LABEL', '');
    expect(resolvePixelIds({})).toEqual({
      metaPixelId: '',
      tiktokPixelId: '',
      googleAdsConversionId: '',
    });
    expect(resolveMetaPixelId(null)).toBe('');
    expect(resolveTikTokPixelId(undefined)).toBe('');
    expect(resolveGoogleAdsConversionId(null)).toBe('');
    expect(resolveGoogleAdsLeadLabel(undefined)).toBe('');
  });

  it('an override works with no env id at all (the server-side path relies on this)', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '');
    expect(resolveMetaPixelId({ metaPixelId: 'camp-only' })).toBe('camp-only');
  });
});
