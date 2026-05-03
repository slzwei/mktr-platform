import { describe, it, expect } from 'vitest';
import { prospectSchema } from '../prospect';

describe('prospectSchema (extended)', () => {
 const validProspect = {
 firstName: 'John',
 email: 'john@example.com',
 leadSource: 'website',
 };

 it('rejects firstName exceeding 50 characters', () => {
 const result = prospectSchema.safeParse({ ...validProspect, firstName: 'A'.repeat(51) });
 expect(result.success).toBe(false);
 });

 it('allows lastName up to 50 characters', () => {
 const result = prospectSchema.safeParse({ ...validProspect, lastName: 'B'.repeat(50) });
 expect(result.success).toBe(true);
 });

 it('rejects lastName exceeding 50 characters', () => {
 const result = prospectSchema.safeParse({ ...validProspect, lastName: 'B'.repeat(51) });
 expect(result.success).toBe(false);
 });

 it('allows company up to 100 characters', () => {
 const result = prospectSchema.safeParse({ ...validProspect, company: 'C'.repeat(100) });
 expect(result.success).toBe(true);
 });

 it('rejects company exceeding 100 characters', () => {
 const result = prospectSchema.safeParse({ ...validProspect, company: 'C'.repeat(101) });
 expect(result.success).toBe(false);
 });

 it('allows jobTitle up to 100 characters', () => {
 const result = prospectSchema.safeParse({ ...validProspect, jobTitle: 'D'.repeat(100) });
 expect(result.success).toBe(true);
 });

 it('rejects jobTitle exceeding 100 characters', () => {
 const result = prospectSchema.safeParse({ ...validProspect, jobTitle: 'D'.repeat(101) });
 expect(result.success).toBe(false);
 });

 it('validates phone with exactly 8 digits', () => {
 const result = prospectSchema.safeParse({ ...validProspect, phone: '91234567' });
 expect(result.success).toBe(true);
 });

 it('validates phone up to 20 characters', () => {
 const result = prospectSchema.safeParse({ ...validProspect, phone: '+6591234567' });
 expect(result.success).toBe(true);
 });

 it('rejects phone exceeding 20 characters', () => {
 const result = prospectSchema.safeParse({ ...validProspect, phone: '1'.repeat(21) });
 expect(result.success).toBe(false);
 });

 it('rejects invalid leadSource value', () => {
 const result = prospectSchema.safeParse({ ...validProspect, leadSource: 'invalid' });
 expect(result.success).toBe(false);
 });

 it('rejects non-UUID campaignId', () => {
 const result = prospectSchema.safeParse({ ...validProspect, campaignId: 'not-a-uuid' });
 expect(result.success).toBe(false);
 });

 it('allows optional date_of_birth', () => {
 const result = prospectSchema.safeParse({ ...validProspect, date_of_birth: '1990-05-15' });
 expect(result.success).toBe(true);
 });

 it('allows optional postal_code', () => {
 const result = prospectSchema.safeParse({ ...validProspect, postal_code: '123456' });
 expect(result.success).toBe(true);
 });

 it('validates all lead source enum values', () => {
 const sources = ['qr_code', 'website', 'referral', 'social_media', 'advertisement', 'direct', 'other'];
 for (const leadSource of sources) {
 const result = prospectSchema.safeParse({ ...validProspect, leadSource });
 expect(result.success).toBe(true);
 }
 });

 it('rejects missing email', () => {
 const result = prospectSchema.safeParse({ firstName: 'Test', leadSource: 'website' });
 expect(result.success).toBe(false);
 });

 it('rejects missing leadSource', () => {
 const result = prospectSchema.safeParse({ firstName: 'Test', email: 'test@test.com' });
 expect(result.success).toBe(false);
 });
});
