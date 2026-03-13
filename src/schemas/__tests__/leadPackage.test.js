import { describe, it, expect } from 'vitest';
import { leadPackageSchema, leadPackageTemplateSchema } from '../leadPackage';

describe('leadPackageSchema', () => {
  const validPackage = {
    campaign_id: 'some-campaign-id',
    package_name: 'Gold Package',
    total_leads: 100,
    price_per_lead: 20,
  };

  it('validates correct package data', () => {
    const result = leadPackageSchema.safeParse(validPackage);
    expect(result.success).toBe(true);
  });

  it('rejects missing campaign_id', () => {
    const result = leadPackageSchema.safeParse({ ...validPackage, campaign_id: '' });
    expect(result.success).toBe(false);
  });

  it('rejects zero total_leads', () => {
    const result = leadPackageSchema.safeParse({ ...validPackage, total_leads: 0 });
    expect(result.success).toBe(false);
  });

  it('coerces string numbers', () => {
    const result = leadPackageSchema.safeParse({ ...validPackage, total_leads: '50', price_per_lead: '25.5' });
    expect(result.success).toBe(true);
    expect(result.data.total_leads).toBe(50);
    expect(result.data.price_per_lead).toBe(25.5);
  });

  it('validates payment_status enum', () => {
    for (const status of ['pending', 'paid', 'partial']) {
      const result = leadPackageSchema.safeParse({ ...validPackage, payment_status: status });
      expect(result.success).toBe(true);
    }
  });
});

describe('leadPackageTemplateSchema', () => {
  const validTemplate = {
    name: 'Starter Template',
    campaignId: 'some-campaign-id',
    leadCount: 100,
    price: 500,
  };

  it('validates correct template data', () => {
    const result = leadPackageTemplateSchema.safeParse(validTemplate);
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = leadPackageTemplateSchema.safeParse({ ...validTemplate, name: '' });
    expect(result.success).toBe(false);
  });

  it('validates type enum', () => {
    for (const type of ['basic', 'premium', 'enterprise', 'custom']) {
      const result = leadPackageTemplateSchema.safeParse({ ...validTemplate, type });
      expect(result.success).toBe(true);
    }
  });
});
