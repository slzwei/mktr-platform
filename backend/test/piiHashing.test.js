import crypto from 'crypto';
import { hashEmail, hashPhone, hashExternalId } from '../src/utils/piiHashing.js';

const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

describe('piiHashing.hashEmail', () => {
  it('returns undefined for null', () => {
    expect(hashEmail(null)).toBeUndefined();
  });
  it('returns undefined for empty string', () => {
    expect(hashEmail('')).toBeUndefined();
  });
  it('returns undefined for whitespace-only string', () => {
    expect(hashEmail('   ')).toBeUndefined();
  });
  it('returns undefined for non-string', () => {
    expect(hashEmail(123)).toBeUndefined();
    expect(hashEmail({})).toBeUndefined();
  });
  it('lowercases and trims before hashing', () => {
    expect(hashEmail('Shawn@MKTR.sg  ')).toBe(hashEmail('shawn@mktr.sg'));
    expect(hashEmail('  USER@EXAMPLE.COM')).toBe(hashEmail('user@example.com'));
  });
  it('returns a 64-char hex string', () => {
    const h = hashEmail('shawn@mktr.sg');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
  it('matches reference SHA-256 over normalized email', () => {
    expect(hashEmail('Shawn@MKTR.sg')).toBe(sha256Hex('shawn@mktr.sg'));
  });
});

describe('piiHashing.hashPhone', () => {
  it('returns undefined for null/empty/non-string', () => {
    expect(hashPhone(null)).toBeUndefined();
    expect(hashPhone('')).toBeUndefined();
    expect(hashPhone(65812345)).toBeUndefined();
  });
  it('returns undefined when no digits present', () => {
    expect(hashPhone('+')).toBeUndefined();
    expect(hashPhone('---')).toBeUndefined();
  });
  it('strips non-digit characters before hashing', () => {
    const expected = hashPhone('6581234567');
    expect(hashPhone('+65 8123 4567')).toBe(expected);
    expect(hashPhone('+65-8123-4567')).toBe(expected);
    expect(hashPhone('(65) 81234567')).toBe(expected);
  });
  it('returns a 64-char hex string', () => {
    expect(hashPhone('6581234567')).toMatch(/^[a-f0-9]{64}$/);
  });
  it('matches reference SHA-256 over digit-only normalized phone', () => {
    expect(hashPhone('+65 8123 4567')).toBe(sha256Hex('6581234567'));
  });
});

describe('piiHashing.hashExternalId', () => {
  it('returns undefined for null/undefined/empty', () => {
    expect(hashExternalId(null)).toBeUndefined();
    expect(hashExternalId(undefined)).toBeUndefined();
    expect(hashExternalId('')).toBeUndefined();
  });
  it('coerces non-string to string before hashing', () => {
    expect(hashExternalId(123)).toBe(hashExternalId('123'));
  });
  it('returns a 64-char hex string', () => {
    expect(hashExternalId('uuid-1234')).toMatch(/^[a-f0-9]{64}$/);
  });
  it('matches reference SHA-256 over stringified value', () => {
    expect(hashExternalId('abc-123')).toBe(sha256Hex('abc-123'));
  });
});
