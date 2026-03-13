import { describe, it, expect } from 'vitest';
import { campaignSchema } from '../campaign';

describe('campaignSchema', () => {
  const validCampaign = {
    name: 'Summer Promo',
    type: 'lead_generation',
  };

  it('validates minimal campaign data', () => {
    const result = campaignSchema.safeParse(validCampaign);
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = campaignSchema.safeParse({ ...validCampaign, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = campaignSchema.safeParse({ ...validCampaign, type: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('validates all campaign types', () => {
    for (const type of ['lead_generation', 'brand_awareness', 'product_promotion', 'event_marketing']) {
      const result = campaignSchema.safeParse({ ...validCampaign, type });
      expect(result.success).toBe(true);
    }
  });

  it('coerces budget from string', () => {
    const result = campaignSchema.safeParse({ ...validCampaign, budget: '5000' });
    expect(result.success).toBe(true);
    expect(result.data.budget).toBe(5000);
  });

  it('allows empty string for landingPageUrl', () => {
    const result = campaignSchema.safeParse({ ...validCampaign, landingPageUrl: '' });
    expect(result.success).toBe(true);
  });

  it('validates landingPageUrl as URL', () => {
    const result = campaignSchema.safeParse({ ...validCampaign, landingPageUrl: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('accepts valid URL for landingPageUrl', () => {
    const result = campaignSchema.safeParse({ ...validCampaign, landingPageUrl: 'https://example.com' });
    expect(result.success).toBe(true);
  });
});
