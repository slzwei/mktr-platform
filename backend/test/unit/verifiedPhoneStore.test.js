import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  markPhoneVerified,
  isPhoneRecentlyVerified,
  _resetVerifiedPhones,
} from '../../src/services/verifiedPhoneStore.js';

describe('verifiedPhoneStore', () => {
  beforeEach(() => _resetVerifiedPhones());

  it('marked phone is recently verified; unmarked is not', () => {
    expect(isPhoneRecentlyVerified('+6591234567')).toBe(false);
    markPhoneVerified('+6591234567');
    expect(isPhoneRecentlyVerified('+6591234567')).toBe(true);
    // a different number stays false (no cross-talk)
    expect(isPhoneRecentlyVerified('+6598765432')).toBe(false);
  });

  it('marker expires after the TTL (and self-prunes on read)', () => {
    const t0 = 1_000_000;
    markPhoneVerified('+6591234567', t0);
    expect(isPhoneRecentlyVerified('+6591234567', t0 + 60_000)).toBe(true); // within TTL
    // default TTL is 10 min; 11 min later it is expired
    expect(isPhoneRecentlyVerified('+6591234567', t0 + 11 * 60_000)).toBe(false);
    // and a fresh check at the same later time still false (entry was pruned)
    expect(isPhoneRecentlyVerified('+6591234567', t0 + 11 * 60_000)).toBe(false);
  });

  it('honors DNC_VERIFIED_MARKER_TTL_MS override', () => {
    const prev = process.env.DNC_VERIFIED_MARKER_TTL_MS;
    process.env.DNC_VERIFIED_MARKER_TTL_MS = '1000';
    const t0 = 5_000_000;
    markPhoneVerified('+6590000000', t0);
    expect(isPhoneRecentlyVerified('+6590000000', t0 + 500)).toBe(true);
    expect(isPhoneRecentlyVerified('+6590000000', t0 + 1500)).toBe(false);
    process.env.DNC_VERIFIED_MARKER_TTL_MS = prev;
  });

  it('no-ops for falsy phone', () => {
    markPhoneVerified('');
    markPhoneVerified(null);
    expect(isPhoneRecentlyVerified('')).toBe(false);
    expect(isPhoneRecentlyVerified(null)).toBe(false);
  });

  it('reset clears all markers', () => {
    markPhoneVerified('+6591234567');
    _resetVerifiedPhones();
    expect(isPhoneRecentlyVerified('+6591234567')).toBe(false);
  });
});
