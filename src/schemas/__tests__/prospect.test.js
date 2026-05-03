import { describe, it, expect } from 'vitest';
import { prospectSchema } from '../prospect';

describe('prospectSchema', () => {
 const validProspect = {
 firstName: 'John',
 email: 'john@example.com',
 leadSource: 'website',
 };

 it('validates correct prospect data', () => {
 const result = prospectSchema.safeParse(validProspect);
 expect(result.success).toBe(true);
 });

 it('rejects missing firstName', () => {
 const result = prospectSchema.safeParse({ ...validProspect, firstName: '' });
 expect(result.success).toBe(false);
 });

 it('rejects invalid email', () => {
 const result = prospectSchema.safeParse({ ...validProspect, email: 'bad' });
 expect(result.success).toBe(false);
 });

 it('validates all leadSource options', () => {
 const sources = ['qr_code', 'website', 'referral', 'social_media', 'advertisement', 'direct', 'other'];
 for (const leadSource of sources) {
 const result = prospectSchema.safeParse({ ...validProspect, leadSource });
 expect(result.success).toBe(true);
 }
 });

 it('allows empty phone string', () => {
 const result = prospectSchema.safeParse({ ...validProspect, phone: '' });
 expect(result.success).toBe(true);
 });

 it('rejects phone under 8 digits', () => {
 const result = prospectSchema.safeParse({ ...validProspect, phone: '1234' });
 expect(result.success).toBe(false);
 });

 it('allows nullable campaignId', () => {
 const result = prospectSchema.safeParse({ ...validProspect, campaignId: null });
 expect(result.success).toBe(true);
 });

 it('validates campaignId as UUID', () => {
 const result = prospectSchema.safeParse({
 ...validProspect,
 campaignId: '550e8400-e29b-41d4-a716-446655440000',
 });
 expect(result.success).toBe(true);
 });
});
