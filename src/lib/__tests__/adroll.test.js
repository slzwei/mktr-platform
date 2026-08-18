import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  shouldTrackAdRoll,
  isAdRollSurface,
  isAdRollCampaignSurface,
  resolveAdRollIds,
  initAdRoll,
  trackAdRollPageView,
  __resetAdRollStateForTests,
} from '../adroll.js';

const ADV_ID = 'XWJKUPH2LRC4LG4ZVFR4MS';
const PIX_ID = 'Q5WESFHM2JDHPIDHKY3DBT';

const ROUNDTRIP_SELECTOR = 'script[src*="s.adroll.com/j/"]';

function stubProdWithIds() {
  vi.stubEnv('VITE_ADROLL_ADV_ID', ADV_ID);
  vi.stubEnv('VITE_ADROLL_PIX_ID', PIX_ID);
  vi.stubEnv('MODE', 'production');
  vi.stubEnv('PROD', true);
  vi.stubEnv('DEV', false);
}

/** Mirrors the index.html stub: queue + globals, no SDK, no pageView. */
function installStub() {
  window.adroll_adv_id = ADV_ID;
  window.adroll_pix_id = PIX_ID;
  window.adroll = [];
  window.adroll.track = vi.fn();
  return window.adroll.track;
}

function removeStub() {
  delete window.adroll;
  delete window.adroll_adv_id;
  delete window.adroll_pix_id;
}

describe('shouldTrackAdRoll', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubProdWithIds();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns true on the campaign funnel surfaces', () => {
    expect(shouldTrackAdRoll({ pathname: '/LeadCapture', search: '' })).toBe(true);
    expect(shouldTrackAdRoll({ pathname: '/offers/tokyo-draw' })).toBe(true);
    expect(shouldTrackAdRoll({ pathname: '/flow/tokyo-draw' })).toBe(true);
  });

  it('returns true on the public browse surfaces the other pixels skip', () => {
    expect(shouldTrackAdRoll({ pathname: '/' })).toBe(true);
    expect(shouldTrackAdRoll({ pathname: '/explore' })).toBe(true);
    expect(shouldTrackAdRoll({ pathname: '/c/travel' })).toBe(true);
    expect(shouldTrackAdRoll({ pathname: '/winners' })).toBe(true);
    expect(shouldTrackAdRoll({ pathname: '/how-it-works' })).toBe(true);
    expect(shouldTrackAdRoll({ pathname: '/legal/terms' })).toBe(true);
  });

  it('returns false when either id is missing — both halves are required', () => {
    vi.stubEnv('VITE_ADROLL_ADV_ID', '');
    expect(shouldTrackAdRoll({ pathname: '/explore' })).toBe(false);
    stubProdWithIds();
    vi.stubEnv('VITE_ADROLL_PIX_ID', '');
    expect(shouldTrackAdRoll({ pathname: '/explore' })).toBe(false);
  });

  it('returns false on /preview, /LeadCapture/demo and /p/:slug (shared suppression)', () => {
    expect(shouldTrackAdRoll({ pathname: '/preview' })).toBe(false);
    expect(shouldTrackAdRoll({ pathname: '/preview/atelier' })).toBe(false);
    expect(shouldTrackAdRoll({ pathname: '/LeadCapture/demo' })).toBe(false);
    expect(shouldTrackAdRoll({ pathname: '/p/some-slug' })).toBe(false);
  });

  it('returns false when ?preview=true is present', () => {
    expect(shouldTrackAdRoll({ pathname: '/LeadCapture', search: '?preview=true' })).toBe(false);
  });

  it('returns false when campaign.is_test_data is true', () => {
    expect(shouldTrackAdRoll({ pathname: '/offers/x', campaign: { is_test_data: true } })).toBe(false);
  });

  it('never fires on token-bearing routes — those URLs must not reach AdRoll', () => {
    expect(shouldTrackAdRoll({ pathname: '/r/abc123token' })).toBe(false);
    expect(shouldTrackAdRoll({ pathname: '/callback', search: '?t=abc123token' })).toBe(false);
    expect(shouldTrackAdRoll({ pathname: '/t/some-slug' })).toBe(false);
    expect(shouldTrackAdRoll({ pathname: '/share/some-slug' })).toBe(false);
  });

  it('never fires on internal surfaces (allow-list keeps new admin routes dark)', () => {
    expect(shouldTrackAdRoll({ pathname: '/AdminDashboard' })).toBe(false);
    expect(shouldTrackAdRoll({ pathname: '/admin/campaigns/123/studio' })).toBe(false);
    expect(shouldTrackAdRoll({ pathname: '/redeem-ops/partners' })).toBe(false);
    expect(shouldTrackAdRoll({ pathname: '/CustomerLogin' })).toBe(false);
    expect(shouldTrackAdRoll({ pathname: '/AdminLogin' })).toBe(false);
  });

  it('returns false in dev without VITE_ADROLL_DEV_MODE, true with it', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_ADROLL_DEV_MODE', '');
    expect(shouldTrackAdRoll({ pathname: '/explore' })).toBe(false);
    vi.stubEnv('VITE_ADROLL_DEV_MODE', '1');
    expect(shouldTrackAdRoll({ pathname: '/explore' })).toBe(true);
  });

  it('handles a missing pathname gracefully', () => {
    expect(shouldTrackAdRoll({})).toBe(false);
  });

  it('resolveAdRollIds reads both build ids', () => {
    expect(resolveAdRollIds()).toEqual({ advId: ADV_ID, pixId: PIX_ID });
  });
});

describe('surface classification', () => {
  it('separates the campaign funnel from the browse pages', () => {
    expect(isAdRollCampaignSurface('/LeadCapture')).toBe(true);
    expect(isAdRollCampaignSurface('/offers/tokyo-draw')).toBe(true);
    expect(isAdRollCampaignSurface('/flow/tokyo-draw')).toBe(true);
    // Browse pages are on the allow-list but NOT campaign surfaces — the route
    // tracker owns those, the pages own the funnel.
    expect(isAdRollCampaignSurface('/explore')).toBe(false);
    expect(isAdRollSurface('/explore')).toBe(true);
  });

  it('requires a slug segment on the marketplace patterns', () => {
    expect(isAdRollSurface('/offers')).toBe(false);
    expect(isAdRollSurface('/flow')).toBe(false);
  });
});

describe('initAdRoll', () => {
  let track;

  beforeEach(() => {
    __resetAdRollStateForTests();
    document.querySelectorAll(ROUNDTRIP_SELECTOR).forEach((s) => s.remove());
    track = installStub();
  });

  afterEach(() => {
    removeStub();
    document.querySelectorAll(ROUNDTRIP_SELECTOR).forEach((s) => s.remove());
  });

  it('injects roundtrip.js for the advertisable id', () => {
    initAdRoll();
    const scripts = document.querySelectorAll(ROUNDTRIP_SELECTOR);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toContain(ADV_ID);
    expect(scripts[0].async).toBe(true);
  });

  it('does not fire a pageView on its own', () => {
    initAdRoll();
    expect(track).not.toHaveBeenCalled();
  });

  it('is idempotent — repeat calls inject once', () => {
    initAdRoll();
    initAdRoll();
    initAdRoll();
    expect(document.querySelectorAll(ROUNDTRIP_SELECTOR)).toHaveLength(1);
  });

  it('no-ops when the index.html stub is absent (ids unset at build)', () => {
    removeStub();
    expect(() => initAdRoll()).not.toThrow();
    expect(document.querySelectorAll(ROUNDTRIP_SELECTOR)).toHaveLength(0);
  });
});

describe('trackAdRollPageView', () => {
  let track;

  beforeEach(() => {
    __resetAdRollStateForTests();
    track = installStub();
  });

  afterEach(() => {
    removeStub();
    document.querySelectorAll(ROUNDTRIP_SELECTOR).forEach((s) => s.remove());
  });

  it('pushes a pageView through the queue', () => {
    trackAdRollPageView();
    expect(track).toHaveBeenCalledWith('pageView');
  });

  it('fires once per call — no session guard, unlike ViewContent', () => {
    trackAdRollPageView();
    trackAdRollPageView();
    expect(track).toHaveBeenCalledTimes(2);
  });

  it('no-ops when the stub is absent', () => {
    removeStub();
    expect(() => trackAdRollPageView()).not.toThrow();
  });
});
