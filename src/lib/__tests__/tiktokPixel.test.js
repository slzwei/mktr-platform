import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  shouldTrackTikTok,
  captureTtclidFromUrl,
  readTtclid,
  readTtp,
  initTikTokPixel,
  trackTikTokEvent,
  trackTikTokViewContent,
  trackTikTokCompleteRegistration,
  trackTikTokLead,
} from '../tiktokPixel.js';

const PIXEL_ID = 'CABC123DEF456';

function stubProdWithPixel() {
  vi.stubEnv('VITE_TIKTOK_PIXEL_ID', PIXEL_ID);
  vi.stubEnv('VITE_TIKTOK_TEST_EVENT_CODE', 'TT_TEST');
  vi.stubEnv('MODE', 'production');
  vi.stubEnv('PROD', true);
  vi.stubEnv('DEV', false);
}

describe('shouldTrackTikTok', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubProdWithPixel();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns true on /LeadCapture with all conditions met', () => {
    expect(shouldTrackTikTok({ pathname: '/LeadCapture', search: '' })).toBe(true);
  });

  it('returns true on /leadcapture (lowercase)', () => {
    expect(shouldTrackTikTok({ pathname: '/leadcapture' })).toBe(true);
  });

  it('returns false when VITE_TIKTOK_PIXEL_ID is empty', () => {
    vi.stubEnv('VITE_TIKTOK_PIXEL_ID', '');
    expect(shouldTrackTikTok({ pathname: '/LeadCapture' })).toBe(false);
  });

  it('returns false on /preview, /LeadCapture/demo, and /p/:slug (shared suppression)', () => {
    expect(shouldTrackTikTok({ pathname: '/preview' })).toBe(false);
    expect(shouldTrackTikTok({ pathname: '/preview/atelier' })).toBe(false);
    expect(shouldTrackTikTok({ pathname: '/LeadCapture/demo' })).toBe(false);
    expect(shouldTrackTikTok({ pathname: '/p/some-slug' })).toBe(false);
  });

  it('returns false when ?preview=true querystring is present', () => {
    expect(shouldTrackTikTok({ pathname: '/LeadCapture', search: '?preview=true' })).toBe(false);
  });

  it('returns false when campaign.is_test_data is true', () => {
    expect(shouldTrackTikTok({ pathname: '/LeadCapture', campaign: { is_test_data: true } })).toBe(false);
  });

  it('returns false in dev mode without VITE_TIKTOK_TEST_EVENT_CODE', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_TIKTOK_TEST_EVENT_CODE', '');
    expect(shouldTrackTikTok({ pathname: '/LeadCapture' })).toBe(false);
  });

  it('returns true in dev mode when VITE_TIKTOK_TEST_EVENT_CODE is set', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_TIKTOK_TEST_EVENT_CODE', 'TT_TEST');
    expect(shouldTrackTikTok({ pathname: '/LeadCapture' })).toBe(true);
  });

  it('returns false on non-allowlisted paths', () => {
    expect(shouldTrackTikTok({ pathname: '/Pricing' })).toBe(false);
    expect(shouldTrackTikTok({ pathname: '/' })).toBe(false);
  });

  it('handles missing pathname gracefully (returns false)', () => {
    expect(shouldTrackTikTok({})).toBe(false);
  });
});

describe('captureTtclidFromUrl', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('extracts ttclid and persists it raw to sessionStorage', () => {
    const result = captureTtclidFromUrl('?ttclid=TT_CLICK_123');
    expect(result).toBe('TT_CLICK_123');
    expect(sessionStorage.getItem('_mktr_ttclid')).toBe('TT_CLICK_123');
  });

  it('returns null when no ttclid in querystring', () => {
    expect(captureTtclidFromUrl('?utm_source=tiktok')).toBe(null);
    expect(sessionStorage.getItem('_mktr_ttclid')).toBe(null);
  });

  it('returns null for empty or null input', () => {
    expect(captureTtclidFromUrl('')).toBe(null);
    expect(captureTtclidFromUrl(null)).toBe(null);
    expect(captureTtclidFromUrl(undefined)).toBe(null);
  });
});

describe('readTtclid', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns the persisted sessionStorage value', () => {
    sessionStorage.setItem('_mktr_ttclid', 'persisted-ttclid');
    expect(readTtclid()).toBe('persisted-ttclid');
  });

  it('returns null when no value present', () => {
    expect(readTtclid()).toBe(null);
  });
});

describe('readTtp', () => {
  let originalCookieDescriptor;

  beforeEach(() => {
    originalCookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  });

  afterEach(() => {
    if (originalCookieDescriptor) {
      Object.defineProperty(Document.prototype, 'cookie', originalCookieDescriptor);
    }
  });

  it('parses _ttp from document.cookie when present', () => {
    Object.defineProperty(document, 'cookie', {
      value: '_ttp=ttp_value_999; other=val',
      writable: true,
      configurable: true,
    });
    expect(readTtp()).toBe('ttp_value_999');
  });

  it('returns null when _ttp cookie is absent', () => {
    Object.defineProperty(document, 'cookie', {
      value: 'foo=bar; baz=qux',
      writable: true,
      configurable: true,
    });
    expect(readTtp()).toBe(null);
  });
});

describe('initTikTokPixel', () => {
  beforeEach(() => {
    vi.stubGlobal('ttq', { load: vi.fn(), page: vi.fn(), track: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls ttq.load + ttq.page with the pixel id', () => {
    initTikTokPixel('PIXEL_AAA');
    expect(window.ttq.load).toHaveBeenCalledWith('PIXEL_AAA');
    expect(window.ttq.page).toHaveBeenCalledTimes(1);
  });

  it('is idempotent for the same pixel id', () => {
    initTikTokPixel('PIXEL_BBB');
    initTikTokPixel('PIXEL_BBB');
    initTikTokPixel('PIXEL_BBB');
    expect(window.ttq.load).toHaveBeenCalledTimes(1);
  });

  it('does nothing when pixel id is empty or null', () => {
    initTikTokPixel('');
    initTikTokPixel(null);
    initTikTokPixel(undefined);
    expect(window.ttq.load).not.toHaveBeenCalled();
  });

  it('does nothing and does not throw when ttq is not loaded', () => {
    vi.unstubAllGlobals();
    expect(() => initTikTokPixel('PIXEL_CCC')).not.toThrow();
  });
});

describe('trackTikTokEvent', () => {
  beforeEach(() => {
    vi.stubGlobal('ttq', { track: vi.fn(), load: vi.fn(), page: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls ttq.track with name, params, and event_id option for dedup', () => {
    trackTikTokEvent('ViewContent', { content_name: 'Quiz' }, 'evt-tt-1');
    expect(window.ttq.track).toHaveBeenCalledWith(
      'ViewContent',
      { content_name: 'Quiz' },
      { event_id: 'evt-tt-1' }
    );
  });

  it('omits the options arg when no eventId is provided', () => {
    trackTikTokEvent('ViewContent', { content_name: 'Quiz' });
    expect(window.ttq.track).toHaveBeenCalledWith('ViewContent', { content_name: 'Quiz' });
  });

  it('does nothing and does not throw when ttq is not loaded', () => {
    vi.unstubAllGlobals();
    expect(() => trackTikTokEvent('ViewContent', {})).not.toThrow();
  });

  it('wrappers fire the right TikTok event names with the dedup event_id', () => {
    trackTikTokViewContent({ a: 1 }, 'id-vc');
    trackTikTokCompleteRegistration({ b: 2 }, 'id-cr');
    trackTikTokLead({ c: 3 }, 'id-lead');
    expect(window.ttq.track).toHaveBeenNthCalledWith(1, 'ViewContent', { a: 1 }, { event_id: 'id-vc' });
    expect(window.ttq.track).toHaveBeenNthCalledWith(2, 'CompleteRegistration', { b: 2 }, { event_id: 'id-cr' });
    expect(window.ttq.track).toHaveBeenNthCalledWith(3, 'Lead', { c: 3 }, { event_id: 'id-lead' });
  });
});
