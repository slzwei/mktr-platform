import { describe, it, expect } from 'vitest';
import {
  resolveCustomerHost,
  DEFAULT_CUSTOMER_HOST,
  customerPublicUrl,
  customerLeadCaptureUrl,
  customerPreviewUrl,
  publicTrackingUrl,
  publicShareUrl,
} from '../brand.js';

describe('resolveCustomerHost', () => {
  it("maps 'redeem' → redeem.sg and 'mktr' → mktr.sg", () => {
    expect(resolveCustomerHost('redeem')).toBe('redeem.sg');
    expect(resolveCustomerHost('mktr')).toBe('mktr.sg');
  });

  it('defaults to redeem.sg for missing/garbage choices (enum-only, case-sensitive)', () => {
    for (const bad of [undefined, null, '', 'MKTR', 'mktr.sg', 'evil.com']) {
      expect(resolveCustomerHost(bad)).toBe('redeem.sg');
    }
  });

  it('exposes redeem.sg as the default host', () => {
    expect(DEFAULT_CUSTOMER_HOST).toBe('redeem.sg');
  });
});

describe('customer URL helpers default to redeem.sg (backward compatible)', () => {
  it('emit redeem.sg when no host is passed', () => {
    expect(customerPublicUrl('/x')).toBe('https://redeem.sg/x');
    expect(customerLeadCaptureUrl('abc')).toBe('https://redeem.sg/LeadCapture?campaign_id=abc');
    expect(publicTrackingUrl('slug')).toBe('https://redeem.sg/t/slug');
    expect(publicShareUrl('slug')).toBe('https://redeem.sg/share/slug');
    expect(customerPreviewUrl('slug')).toBe('https://redeem.sg/p/slug');
  });
});

describe('customer URL helpers honor an explicit mktr.sg host', () => {
  const mktr = resolveCustomerHost('mktr');

  it('emit mktr.sg when the resolved host is passed', () => {
    expect(customerPublicUrl('/x', mktr)).toBe('https://mktr.sg/x');
    expect(customerLeadCaptureUrl('abc', {}, mktr)).toBe('https://mktr.sg/LeadCapture?campaign_id=abc');
    expect(customerLeadCaptureUrl('abc', { ref: '1' }, mktr)).toBe(
      'https://mktr.sg/LeadCapture?campaign_id=abc&ref=1'
    );
    expect(publicTrackingUrl('slug', mktr)).toBe('https://mktr.sg/t/slug');
    expect(publicShareUrl('slug', mktr)).toBe('https://mktr.sg/share/slug');
    expect(customerPreviewUrl('slug', mktr)).toBe('https://mktr.sg/p/slug');
  });
});
