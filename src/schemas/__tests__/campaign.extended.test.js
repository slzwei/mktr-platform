import { describe, it, expect } from 'vitest';
import { campaignSchema } from '../campaign';

describe('campaignSchema (extended)', () => {
  const validData = {
    name: 'Summer Campaign',
    type: 'lead_generation',
  };

  it('validates minimal valid campaign', () => {
    const result = campaignSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('rejects empty campaign name', () => {
    const result = campaignSchema.safeParse({ ...validData, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding 100 characters', () => {
    const result = campaignSchema.safeParse({ ...validData, name: 'X'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('validates all campaign types', () => {
    const types = ['lead_generation', 'brand_awareness', 'product_promotion', 'event_marketing'];
    types.forEach(type => {
      const result = campaignSchema.safeParse({ ...validData, type });
      expect(result.success).toBe(true);
    });
  });

  it('rejects invalid campaign type', () => {
    const result = campaignSchema.safeParse({ ...validData, type: 'invalid_type' });
    expect(result.success).toBe(false);
  });

  it('allows optional budget as number', () => {
    const result = campaignSchema.safeParse({ ...validData, budget: 1000 });
    expect(result.success).toBe(true);
  });

  it('rejects negative budget', () => {
    const result = campaignSchema.safeParse({ ...validData, budget: -100 });
    expect(result.success).toBe(false);
  });

  it('coerces string budget to number', () => {
    const result = campaignSchema.safeParse({ ...validData, budget: '500' });
    expect(result.success).toBe(true);
    expect(result.data.budget).toBe(500);
  });

  it('allows optional landing page URL', () => {
    const result = campaignSchema.safeParse({ ...validData, landingPageUrl: 'https://example.com' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid landing page URL', () => {
    const result = campaignSchema.safeParse({ ...validData, landingPageUrl: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('allows empty string for landing page URL', () => {
    const result = campaignSchema.safeParse({ ...validData, landingPageUrl: '' });
    expect(result.success).toBe(true);
  });

  it('allows optional callToAction', () => {
    const result = campaignSchema.safeParse({ ...validData, callToAction: 'Sign up now!' });
    expect(result.success).toBe(true);
  });

  it('rejects callToAction exceeding 200 characters', () => {
    const result = campaignSchema.safeParse({ ...validData, callToAction: 'A'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('allows valid agentAssignmentMode', () => {
    const result = campaignSchema.safeParse({ ...validData, agentAssignmentMode: 'round_robin' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid agentAssignmentMode', () => {
    const result = campaignSchema.safeParse({ ...validData, agentAssignmentMode: 'random' });
    expect(result.success).toBe(false);
  });

  it('allows optional description', () => {
    const result = campaignSchema.safeParse({ ...validData, description: 'A great campaign' });
    expect(result.success).toBe(true);
  });

  it('allows optional startDate and endDate', () => {
    const result = campaignSchema.safeParse({
      ...validData,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    expect(result.success).toBe(true);
  });

  it('passes without any optional fields', () => {
    const result = campaignSchema.safeParse({ name: 'Minimal', type: 'lead_generation' });
    expect(result.success).toBe(true);
  });

  it('rejects missing type', () => {
    const result = campaignSchema.safeParse({ name: 'No Type' });
    expect(result.success).toBe(false);
  });

  it('rejects missing name', () => {
    const result = campaignSchema.safeParse({ type: 'lead_generation' });
    expect(result.success).toBe(false);
  });
});
