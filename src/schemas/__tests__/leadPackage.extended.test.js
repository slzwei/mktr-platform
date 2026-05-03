import { describe, it, expect } from 'vitest';
import { leadPackageSchema, leadPackageTemplateSchema } from '../leadPackage';

describe('leadPackageSchema (extended)', () => {
 const valid = {
 campaign_id: 'campaign-123',
 package_name: 'Gold Package',
 total_leads: 100,
 price_per_lead: 20,
 };

 it('rejects empty package_name', () => {
 const result = leadPackageSchema.safeParse({ ...valid, package_name: '' });
 expect(result.success).toBe(false);
 });

 it('rejects package_name exceeding 100 characters', () => {
 const result = leadPackageSchema.safeParse({ ...valid, package_name: 'A'.repeat(101) });
 expect(result.success).toBe(false);
 });

 it('rejects negative price_per_lead', () => {
 const result = leadPackageSchema.safeParse({ ...valid, price_per_lead: -1 });
 expect(result.success).toBe(false);
 });

 it('allows zero price_per_lead', () => {
 const result = leadPackageSchema.safeParse({ ...valid, price_per_lead: 0 });
 expect(result.success).toBe(true);
 });

 it('allows empty start_date', () => {
 const result = leadPackageSchema.safeParse({ ...valid, start_date: '' });
 expect(result.success).toBe(true);
 });

 it('allows empty end_date', () => {
 const result = leadPackageSchema.safeParse({ ...valid, end_date: '' });
 expect(result.success).toBe(true);
 });

 it('allows valid start_date string', () => {
 const result = leadPackageSchema.safeParse({ ...valid, start_date: '2026-01-01' });
 expect(result.success).toBe(true);
 });

 it('rejects invalid payment_status', () => {
 const result = leadPackageSchema.safeParse({ ...valid, payment_status: 'cancelled' });
 expect(result.success).toBe(false);
 });

 it('allows notes up to 500 characters', () => {
 const result = leadPackageSchema.safeParse({ ...valid, notes: 'A'.repeat(500) });
 expect(result.success).toBe(true);
 });

 it('rejects notes exceeding 500 characters', () => {
 const result = leadPackageSchema.safeParse({ ...valid, notes: 'A'.repeat(501) });
 expect(result.success).toBe(false);
 });

 it('allows empty notes string', () => {
 const result = leadPackageSchema.safeParse({ ...valid, notes: '' });
 expect(result.success).toBe(true);
 });

 it('rejects negative total_leads', () => {
 const result = leadPackageSchema.safeParse({ ...valid, total_leads: -5 });
 expect(result.success).toBe(false);
 });
});

describe('leadPackageTemplateSchema (extended)', () => {
 const valid = {
 name: 'Starter Template',
 campaignId: 'campaign-456',
 leadCount: 100,
 price: 500,
 };

 it('rejects name exceeding 100 characters', () => {
 const result = leadPackageTemplateSchema.safeParse({ ...valid, name: 'B'.repeat(101) });
 expect(result.success).toBe(false);
 });

 it('allows description up to 500 characters', () => {
 const result = leadPackageTemplateSchema.safeParse({ ...valid, description: 'D'.repeat(500) });
 expect(result.success).toBe(true);
 });

 it('rejects description exceeding 500 characters', () => {
 const result = leadPackageTemplateSchema.safeParse({ ...valid, description: 'D'.repeat(501) });
 expect(result.success).toBe(false);
 });

 it('allows empty description', () => {
 const result = leadPackageTemplateSchema.safeParse({ ...valid, description: '' });
 expect(result.success).toBe(true);
 });

 it('rejects invalid type enum', () => {
 const result = leadPackageTemplateSchema.safeParse({ ...valid, type: 'unlimited' });
 expect(result.success).toBe(false);
 });

 it('rejects zero leadCount', () => {
 const result = leadPackageTemplateSchema.safeParse({ ...valid, leadCount: 0 });
 expect(result.success).toBe(false);
 });

 it('rejects negative price', () => {
 const result = leadPackageTemplateSchema.safeParse({ ...valid, price: -10 });
 expect(result.success).toBe(false);
 });

 it('allows isPublic boolean', () => {
 const result = leadPackageTemplateSchema.safeParse({ ...valid, isPublic: true });
 expect(result.success).toBe(true);
 });

 it('validates status enum values', () => {
 ['active', 'inactive'].forEach(status => {
 const result = leadPackageTemplateSchema.safeParse({ ...valid, status });
 expect(result.success).toBe(true);
 });
 });

 it('rejects invalid status', () => {
 const result = leadPackageTemplateSchema.safeParse({ ...valid, status: 'archived' });
 expect(result.success).toBe(false);
 });

 it('rejects empty campaignId', () => {
 const result = leadPackageTemplateSchema.safeParse({ ...valid, campaignId: '' });
 expect(result.success).toBe(false);
 });

 it('coerces string leadCount to number', () => {
 const result = leadPackageTemplateSchema.safeParse({ ...valid, leadCount: '50' });
 expect(result.success).toBe(true);
 expect(result.data.leadCount).toBe(50);
 });

 it('coerces string price to number', () => {
 const result = leadPackageTemplateSchema.safeParse({ ...valid, price: '99.99' });
 expect(result.success).toBe(true);
 expect(result.data.price).toBe(99.99);
 });
});
