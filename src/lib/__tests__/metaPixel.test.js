import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  shouldTrack,
  generateEventId,
  captureFbcFromUrl,
  readFbc,
  readFbp,
  ensureFbp,
  initPixel,
  trackEvent,
  trackLead,
} from '../metaPixel.js';

const PIXEL_ID = '1690392415464750';

function stubProdWithPixel() {
  vi.stubEnv('VITE_META_PIXEL_ID', PIXEL_ID);
  vi.stubEnv('VITE_META_TEST_EVENT_CODE', 'TEST21092');
  vi.stubEnv('MODE', 'production');
  vi.stubEnv('PROD', true);
  vi.stubEnv('DEV', false);
}

describe('shouldTrack', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubProdWithPixel();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns true on /LeadCapture with all conditions met', () => {
    expect(shouldTrack({ pathname: '/LeadCapture', search: '' })).toBe(true);
  });

  it('returns true on /leadcapture (lowercase) — path matching is case-insensitive', () => {
    expect(shouldTrack({ pathname: '/leadcapture' })).toBe(true);
  });

  it('returns false when VITE_META_PIXEL_ID is empty', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '');
    expect(shouldTrack({ pathname: '/LeadCapture' })).toBe(false);
  });

  it('returns false on /preview', () => {
    expect(shouldTrack({ pathname: '/preview' })).toBe(false);
  });

  it('returns false on /preview/atelier and other design prototype subroutes', () => {
    expect(shouldTrack({ pathname: '/preview/atelier' })).toBe(false);
    expect(shouldTrack({ pathname: '/preview/aurora' })).toBe(false);
    expect(shouldTrack({ pathname: '/preview/specimen' })).toBe(false);
  });

  it('returns false on /LeadCapture/demo', () => {
    expect(shouldTrack({ pathname: '/LeadCapture/demo' })).toBe(false);
  });

  it('returns false on /p/:slug PublicPreview', () => {
    expect(shouldTrack({ pathname: '/p/some-slug-123' })).toBe(false);
  });

  it('returns false when ?preview=true querystring is present', () => {
    expect(shouldTrack({ pathname: '/LeadCapture', search: '?preview=true' })).toBe(false);
  });

  it('returns false when campaign.is_test_data is true', () => {
    expect(shouldTrack({ pathname: '/LeadCapture', campaign: { is_test_data: true } })).toBe(false);
  });

  it('returns false in dev mode without VITE_META_TEST_EVENT_CODE', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_META_TEST_EVENT_CODE', '');
    expect(shouldTrack({ pathname: '/LeadCapture' })).toBe(false);
  });

  it('returns true in dev mode when VITE_META_TEST_EVENT_CODE is set', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_META_TEST_EVENT_CODE', 'TEST21092');
    expect(shouldTrack({ pathname: '/LeadCapture' })).toBe(true);
  });

  it('returns false on non-allowlisted paths like /Pricing or /Homepage', () => {
    expect(shouldTrack({ pathname: '/Pricing' })).toBe(false);
    expect(shouldTrack({ pathname: '/Homepage' })).toBe(false);
    expect(shouldTrack({ pathname: '/' })).toBe(false);
  });

  it('handles missing pathname gracefully (returns false)', () => {
    expect(shouldTrack({})).toBe(false);
  });
});

describe('generateEventId', () => {
  it('returns a non-empty string', () => {
    const id = generateEventId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns unique values on consecutive calls', () => {
    const a = generateEventId();
    const b = generateEventId();
    expect(a).not.toBe(b);
  });

  it('returns a UUID-shaped string when crypto.randomUUID is available', () => {
    const id = generateEventId();
    // matches if a real UUID; otherwise will match the fallback's shape
    expect(id).toMatch(/^[a-f0-9-]+|^[a-z0-9]+-[a-z0-9]+$/);
  });
});

describe('captureFbcFromUrl', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('extracts fbclid, formats as fb.1.{ts}.{fbclid}, and persists to sessionStorage', () => {
    const result = captureFbcFromUrl('?fbclid=TESTABC');
    expect(result).toMatch(/^fb\.1\.\d+\.TESTABC$/);
    expect(sessionStorage.getItem('_mktr_fbc')).toBe(result);
  });

  it('returns null when no fbclid in querystring', () => {
    const result = captureFbcFromUrl('?utm_source=foo&campaign_id=abc');
    expect(result).toBe(null);
    expect(sessionStorage.getItem('_mktr_fbc')).toBe(null);
  });

  it('returns null for empty or null input', () => {
    expect(captureFbcFromUrl('')).toBe(null);
    expect(captureFbcFromUrl(null)).toBe(null);
    expect(captureFbcFromUrl(undefined)).toBe(null);
  });

  it('handles fbclid with special characters by URL-decoding via URLSearchParams', () => {
    const result = captureFbcFromUrl('?fbclid=AB%20CD');
    expect(result).toMatch(/^fb\.1\.\d+\.AB CD$/);
  });
});

describe('readFbc', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns persisted sessionStorage value', () => {
    sessionStorage.setItem('_mktr_fbc', 'fb.1.123456.testfbclid');
    expect(readFbc()).toBe('fb.1.123456.testfbclid');
  });

  it('returns null when no value present', () => {
    expect(readFbc()).toBe(null);
  });
});

describe('readFbp', () => {
  let originalCookieDescriptor;

  beforeEach(() => {
    originalCookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  });

  afterEach(() => {
    if (originalCookieDescriptor) {
      Object.defineProperty(Document.prototype, 'cookie', originalCookieDescriptor);
    }
  });

  it('parses _fbp from document.cookie when present', () => {
    Object.defineProperty(document, 'cookie', {
      value: '_fbp=fb.1.999888.7777; otherKey=value',
      writable: true,
      configurable: true,
    });
    expect(readFbp()).toBe('fb.1.999888.7777');
  });

  it('returns null when _fbp cookie is absent', () => {
    Object.defineProperty(document, 'cookie', {
      value: 'someOther=cookie; another=here',
      writable: true,
      configurable: true,
    });
    expect(readFbp()).toBe(null);
  });

  it('returns null when document.cookie is empty', () => {
    Object.defineProperty(document, 'cookie', {
      value: '',
      writable: true,
      configurable: true,
    });
    expect(readFbp()).toBe(null);
  });
});

describe('ensureFbp', () => {
  let originalCookieDescriptor;

  beforeEach(() => {
    originalCookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  });

  afterEach(() => {
    if (originalCookieDescriptor) {
      Object.defineProperty(Document.prototype, 'cookie', originalCookieDescriptor);
    }
  });

  it('returns the existing _fbp without overwriting it', () => {
    Object.defineProperty(document, 'cookie', {
      value: '_fbp=fb.1.999888.7777; otherKey=value',
      writable: true,
      configurable: true,
    });
    expect(ensureFbp()).toBe('fb.1.999888.7777');
    // unchanged — no new cookie written over the existing one
    expect(document.cookie).toBe('_fbp=fb.1.999888.7777; otherKey=value');
  });

  it('generates and persists a fb.1.{ts}.{rand} cookie when _fbp is absent', () => {
    Object.defineProperty(document, 'cookie', {
      value: '',
      writable: true,
      configurable: true,
    });
    const result = ensureFbp();
    expect(result).toMatch(/^fb\.1\.\d+\.\d+$/);
    expect(document.cookie).toContain(`_fbp=${result}`);
  });
});

describe('initPixel', () => {
  beforeEach(() => {
    vi.stubGlobal('fbq', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls fbq init with the pixel id', () => {
    initPixel('1111111111');
    expect(window.fbq).toHaveBeenCalledWith('init', '1111111111');
  });

  it('is idempotent for the same pixel id', () => {
    initPixel('2222222222');
    initPixel('2222222222');
    initPixel('2222222222');
    expect(window.fbq).toHaveBeenCalledTimes(1);
  });

  it('allows initialisation of a different pixel id', () => {
    initPixel('3333333333');
    initPixel('4444444444');
    expect(window.fbq).toHaveBeenCalledTimes(2);
  });

  it('does nothing when pixel id is empty or null', () => {
    initPixel('');
    initPixel(null);
    initPixel(undefined);
    expect(window.fbq).not.toHaveBeenCalled();
  });

  it('does nothing when fbq is not loaded', () => {
    vi.unstubAllGlobals();
    expect(() => initPixel('5555555555')).not.toThrow();
  });
});

describe('trackEvent', () => {
  beforeEach(() => {
    vi.stubGlobal('fbq', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls fbq track with name and params', () => {
    trackEvent('ViewContent', { content_name: 'Test Campaign' });
    expect(window.fbq).toHaveBeenCalledWith('track', 'ViewContent', { content_name: 'Test Campaign' });
  });

  it('passes through options like eventID for Pixel/CAPI dedup', () => {
    trackEvent('Lead', { value: 0, currency: 'SGD' }, { eventID: 'evt-abc-123' });
    expect(window.fbq).toHaveBeenCalledWith(
      'track',
      'Lead',
      { value: 0, currency: 'SGD' },
      { eventID: 'evt-abc-123' }
    );
  });

  it('omits options arg when not provided (matches fbq 3-arg form)', () => {
    trackEvent('ViewContent');
    expect(window.fbq).toHaveBeenCalledWith('track', 'ViewContent', {});
  });

  it('does nothing and does not throw when fbq is not loaded', () => {
    vi.unstubAllGlobals();
    expect(() => trackEvent('ViewContent', {})).not.toThrow();
  });
});

describe('trackLead', () => {
  beforeEach(() => {
    vi.stubGlobal('fbq', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls fbq track Lead with params and eventID for Pixel/CAPI dedup', () => {
    trackLead({ content_name: 'CPF CareShield', value: 0, currency: 'SGD' }, 'evt-lead-123');
    expect(window.fbq).toHaveBeenCalledWith(
      'track',
      'Lead',
      { content_name: 'CPF CareShield', value: 0, currency: 'SGD' },
      { eventID: 'evt-lead-123' }
    );
  });

  it('omits the options arg when no eventId is provided (falls back to fbq 3-arg form)', () => {
    trackLead({ content_name: 'X' });
    expect(window.fbq).toHaveBeenCalledWith('track', 'Lead', { content_name: 'X' });
  });
});
