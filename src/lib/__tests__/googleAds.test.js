import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  shouldTrackGoogle,
  initGoogleAds,
  trackGoogleConversion,
  trackGoogleLead,
  __resetGoogleAdsStateForTests,
} from '../googleAds.js';

const CONVERSION_ID = 'AW-123456789';
const OTHER_ID = 'AW-987654321';
const LEAD_LABEL = 'AbC-D_efG-h12_34-567';

const GTAG_SELECTOR = 'script[src*="googletagmanager.com/gtag/js"]';

function stubProdWithId() {
  vi.stubEnv('VITE_GOOGLE_ADS_CONVERSION_ID', CONVERSION_ID);
  vi.stubEnv('MODE', 'production');
  vi.stubEnv('PROD', true);
  vi.stubEnv('DEV', false);
}

describe('shouldTrackGoogle', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubProdWithId();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns true on /LeadCapture with all conditions met', () => {
    expect(shouldTrackGoogle({ pathname: '/LeadCapture', search: '' })).toBe(true);
  });

  it('returns true on the marketplace campaign surfaces', () => {
    expect(shouldTrackGoogle({ pathname: '/offers/tokyo-draw' })).toBe(true);
    expect(shouldTrackGoogle({ pathname: '/flow/tokyo-draw' })).toBe(true);
  });

  it('returns false when VITE_GOOGLE_ADS_CONVERSION_ID is empty', () => {
    vi.stubEnv('VITE_GOOGLE_ADS_CONVERSION_ID', '');
    expect(shouldTrackGoogle({ pathname: '/LeadCapture' })).toBe(false);
  });

  it('prefers the caller-resolved conversionId over the build env id', () => {
    vi.stubEnv('VITE_GOOGLE_ADS_CONVERSION_ID', '');
    expect(shouldTrackGoogle({ pathname: '/LeadCapture', conversionId: OTHER_ID })).toBe(true);
  });

  it('returns false on /preview, /LeadCapture/demo, and /p/:slug (shared suppression)', () => {
    expect(shouldTrackGoogle({ pathname: '/preview' })).toBe(false);
    expect(shouldTrackGoogle({ pathname: '/preview/atelier' })).toBe(false);
    expect(shouldTrackGoogle({ pathname: '/LeadCapture/demo' })).toBe(false);
    expect(shouldTrackGoogle({ pathname: '/p/some-slug' })).toBe(false);
  });

  it('returns false when ?preview=true querystring is present', () => {
    expect(shouldTrackGoogle({ pathname: '/LeadCapture', search: '?preview=true' })).toBe(false);
  });

  it('returns false when campaign.is_test_data is true', () => {
    expect(shouldTrackGoogle({ pathname: '/LeadCapture', campaign: { is_test_data: true } })).toBe(false);
  });

  it('returns false in dev mode without VITE_GOOGLE_ADS_DEV_MODE', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_GOOGLE_ADS_DEV_MODE', '');
    expect(shouldTrackGoogle({ pathname: '/LeadCapture' })).toBe(false);
  });

  it('returns true in dev mode when VITE_GOOGLE_ADS_DEV_MODE is set', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_GOOGLE_ADS_DEV_MODE', '1');
    expect(shouldTrackGoogle({ pathname: '/LeadCapture' })).toBe(true);
  });

  it('returns false on non-allowlisted paths', () => {
    expect(shouldTrackGoogle({ pathname: '/Pricing' })).toBe(false);
    expect(shouldTrackGoogle({ pathname: '/' })).toBe(false);
  });

  it('handles missing pathname gracefully (returns false)', () => {
    expect(shouldTrackGoogle({})).toBe(false);
  });
});

describe('initGoogleAds', () => {
  let gtag;

  beforeEach(() => {
    __resetGoogleAdsStateForTests();
    document.querySelectorAll(GTAG_SELECTOR).forEach((s) => s.remove());
    gtag = vi.fn();
    window.gtag = gtag;
  });

  afterEach(() => {
    delete window.gtag;
    document.querySelectorAll(GTAG_SELECTOR).forEach((s) => s.remove());
  });

  it('configures the id and injects gtag.js', () => {
    initGoogleAds(CONVERSION_ID);
    expect(gtag).toHaveBeenCalledWith('config', CONVERSION_ID);
    const scripts = document.querySelectorAll(GTAG_SELECTOR);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toContain(CONVERSION_ID);
    expect(scripts[0].async).toBe(true);
  });

  it('is idempotent per id — a repeat call neither reconfigures nor re-injects', () => {
    initGoogleAds(CONVERSION_ID);
    initGoogleAds(CONVERSION_ID);
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(GTAG_SELECTOR)).toHaveLength(1);
  });

  it('configures a second id but injects the script only once', () => {
    initGoogleAds(CONVERSION_ID);
    initGoogleAds(OTHER_ID);
    expect(gtag).toHaveBeenCalledTimes(2);
    expect(gtag).toHaveBeenLastCalledWith('config', OTHER_ID);
    expect(document.querySelectorAll(GTAG_SELECTOR)).toHaveLength(1);
  });

  it('no-ops on a falsy id', () => {
    initGoogleAds('');
    initGoogleAds(undefined);
    expect(gtag).not.toHaveBeenCalled();
    expect(document.querySelectorAll(GTAG_SELECTOR)).toHaveLength(0);
  });

  it('no-ops when the index.html gtag stub is absent (env id unset at build)', () => {
    delete window.gtag;
    expect(() => initGoogleAds(CONVERSION_ID)).not.toThrow();
    expect(document.querySelectorAll(GTAG_SELECTOR)).toHaveLength(0);
  });
});

describe('trackGoogleConversion', () => {
  let gtag;

  beforeEach(() => {
    gtag = vi.fn();
    window.gtag = gtag;
  });

  afterEach(() => {
    delete window.gtag;
  });

  it('addresses the conversion as {conversionId}/{label}', () => {
    trackGoogleConversion(CONVERSION_ID, LEAD_LABEL);
    expect(gtag).toHaveBeenCalledWith('event', 'conversion', {
      send_to: `${CONVERSION_ID}/${LEAD_LABEL}`,
    });
  });

  it('passes transactionId through as the Google dedup key', () => {
    trackGoogleConversion(CONVERSION_ID, LEAD_LABEL, { transactionId: 'evt-abc' });
    expect(gtag).toHaveBeenCalledWith('event', 'conversion', {
      send_to: `${CONVERSION_ID}/${LEAD_LABEL}`,
      transaction_id: 'evt-abc',
    });
  });

  it('omits value/currency entirely when no value is given', () => {
    trackGoogleConversion(CONVERSION_ID, LEAD_LABEL, { transactionId: 'evt-abc' });
    const payload = gtag.mock.calls[0][2];
    expect(payload).not.toHaveProperty('value');
    expect(payload).not.toHaveProperty('currency');
  });

  it('omits value when it is not a finite number', () => {
    trackGoogleConversion(CONVERSION_ID, LEAD_LABEL, { value: Number.NaN });
    trackGoogleConversion(CONVERSION_ID, LEAD_LABEL, { value: '25' });
    expect(gtag.mock.calls[0][2]).not.toHaveProperty('value');
    expect(gtag.mock.calls[1][2]).not.toHaveProperty('value');
  });

  it('includes value with SGD by default when a real value is given', () => {
    trackGoogleConversion(CONVERSION_ID, LEAD_LABEL, { value: 12.5 });
    expect(gtag.mock.calls[0][2]).toMatchObject({ value: 12.5, currency: 'SGD' });
  });

  it('refuses to emit when either half of send_to is missing', () => {
    trackGoogleConversion(CONVERSION_ID, '');
    trackGoogleConversion('', LEAD_LABEL);
    trackGoogleConversion(undefined, undefined);
    expect(gtag).not.toHaveBeenCalled();
  });

  it('no-ops when the gtag stub is absent', () => {
    delete window.gtag;
    expect(() => trackGoogleConversion(CONVERSION_ID, LEAD_LABEL)).not.toThrow();
  });
});

describe('trackGoogleLead', () => {
  let gtag;

  beforeEach(() => {
    gtag = vi.fn();
    window.gtag = gtag;
  });

  afterEach(() => {
    delete window.gtag;
  });

  it('fires the conversion with the lead label and dedup id', () => {
    trackGoogleLead(CONVERSION_ID, LEAD_LABEL, { transactionId: 'lead-1' });
    expect(gtag).toHaveBeenCalledWith('event', 'conversion', {
      send_to: `${CONVERSION_ID}/${LEAD_LABEL}`,
      transaction_id: 'lead-1',
    });
  });

  it('stays silent when the lead label is unconfigured', () => {
    trackGoogleLead(CONVERSION_ID, '', { transactionId: 'lead-1' });
    expect(gtag).not.toHaveBeenCalled();
  });
});
