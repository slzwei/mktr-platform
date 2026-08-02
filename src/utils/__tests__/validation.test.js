import { describe, it, expect } from 'vitest';
import {
 formatSgPhone,
 isValidSgMobile,
} from '../validation';

describe('formatSgPhone', () => {
 it('formats bare 8-digit mobile number starting with 8', () => {
 expect(formatSgPhone('81234567')).toBe('+6581234567');
 });

 it('formats bare 8-digit mobile number starting with 9', () => {
 expect(formatSgPhone('91234567')).toBe('+6591234567');
 });

 it('formats number starting with 6 (landline)', () => {
 expect(formatSgPhone('61234567')).toBe('+6561234567');
 });

 it('formats number starting with 3', () => {
 expect(formatSgPhone('31234567')).toBe('+6531234567');
 });

 it('returns null when input includes +65 prefix (10 digits after stripping)', () => {
 // formatSgPhone strips all non-digits, so +6581234567 becomes 6581234567 (10 digits)
 // which does not match the 8-digit pattern — returns null
 expect(formatSgPhone('+6581234567')).toBeNull();
 });

 it('returns null when input includes 65 prefix without plus (10 digits)', () => {
 expect(formatSgPhone('6581234567')).toBeNull();
 });

 it('strips spaces from input', () => {
 expect(formatSgPhone('8123 4567')).toBe('+6581234567');
 });

 it('returns null for invalid prefix (starts with 1)', () => {
 expect(formatSgPhone('11234567')).toBeNull();
 });

 it('returns null for too-short number', () => {
 expect(formatSgPhone('8123')).toBeNull();
 });

 it('returns null for empty string', () => {
 expect(formatSgPhone('')).toBeNull();
 });

 it('returns null for null', () => {
 expect(formatSgPhone(null)).toBeNull();
 });
});

describe('isValidSgMobile', () => {
 it('accepts valid mobile starting with 8', () => {
 expect(isValidSgMobile('81234567')).toBe(true);
 });

 it('accepts valid mobile starting with 9', () => {
 expect(isValidSgMobile('91234567')).toBe(true);
 });

 /**
  * P2-14: this asserted 3/6 were valid MOBILES. They are not — 6 is
  * fixed-line, 3 is VoIP, and neither receives the OTP both public funnels
  * send before a lead can proceed. Accepting them offered a dead end.
  */
 it('rejects a fixed-line number starting with 6 — it cannot receive an OTP', () => {
 expect(isValidSgMobile('61234567')).toBe(false);
 });

 it('rejects a VoIP number starting with 3', () => {
 expect(isValidSgMobile('31234567')).toBe(false);
 });

 it('formatSgPhone still accepts the wider set — storing a landline is fine', () => {
 expect(formatSgPhone('61234567')).toBe('+6561234567');
 });

 it('rejects number starting with 1', () => {
 expect(isValidSgMobile('11234567')).toBe(false);
 });

 it('rejects number with wrong length', () => {
 expect(isValidSgMobile('812345')).toBe(false);
 });

 it('rejects number with country code included', () => {
 expect(isValidSgMobile('+6581234567')).toBe(false);
 });
});
