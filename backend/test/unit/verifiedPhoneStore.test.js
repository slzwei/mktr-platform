import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  markPhoneVerified,
  isPhoneRecentlyVerified,
  _resetVerifiedPhones,
  persistPhoneVerification,
  isPhoneVerifiedDurable,
  forgetPhoneVerification,
  phoneMarkerHash,
  pruneExpiredMarkers,
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

/**
 * The durable half. The in-memory Map answers the DNC oracle; these answer
 * "may we write reward-bearing proof?", which has to survive a redeploy
 * landing between the lead's OTP and their submit.
 */
describe('verifiedPhoneStore — durable marker', () => {
  const PHONE = '+6591234567';
  const HASH = phoneMarkerHash(PHONE);
  const T0 = Date.parse('2026-07-27T00:00:00Z');
  const mkModel = (row) => ({
    findByPk: jest.fn().mockResolvedValue(row),
    upsert: jest.fn().mockResolvedValue([{}, true]),
    destroy: jest.fn().mockResolvedValue(1),
  });
  const silent = { warn: () => {}, info: () => {}, error: () => {} };

  beforeEach(() => _resetVerifiedPhones());

  it('hashes the full phone and never stores the raw number', async () => {
    const PhoneVerificationMarker = mkModel(null);
    await persistPhoneVerification(PHONE, T0, { PhoneVerificationMarker });
    const [written] = PhoneVerificationMarker.upsert.mock.calls[0];
    expect(written).toEqual({ phoneHash: HASH, verifiedAt: new Date(T0) });
    expect(JSON.stringify(written)).not.toContain(PHONE);
  });

  it('the in-memory marker short-circuits the DB entirely', async () => {
    const PhoneVerificationMarker = mkModel(null);
    markPhoneVerified(PHONE, T0);
    expect(await isPhoneVerifiedDurable(PHONE, T0 + 1000, { PhoneVerificationMarker })).toBe(true);
    expect(PhoneVerificationMarker.findByPk).not.toHaveBeenCalled();
  });

  it('survives the restart that used to cost a lead their reward', async () => {
    // Map empty (fresh process), row on disk from 40 min ago — well past the
    // 10-minute in-process TTL that produced the false "phone unverified".
    const PhoneVerificationMarker = mkModel({ verifiedAt: new Date(T0) });
    expect(isPhoneRecentlyVerified(PHONE, T0 + 40 * 60_000)).toBe(false);
    expect(await isPhoneVerifiedDurable(PHONE, T0 + 40 * 60_000, { PhoneVerificationMarker })).toBe(true);
    expect(PhoneVerificationMarker.findByPk).toHaveBeenCalledWith(HASH, expect.anything());
  });

  it('expires past the durable window', async () => {
    const PhoneVerificationMarker = mkModel({ verifiedAt: new Date(T0) });
    expect(await isPhoneVerifiedDurable(PHONE, T0 + 23 * 3600_000, { PhoneVerificationMarker })).toBe(true);
    expect(await isPhoneVerifiedDurable(PHONE, T0 + 25 * 3600_000, { PhoneVerificationMarker })).toBe(false);
  });

  it('no row, unusable row, or a falsy phone → false', async () => {
    expect(await isPhoneVerifiedDurable(PHONE, T0, { PhoneVerificationMarker: mkModel(null) })).toBe(false);
    expect(await isPhoneVerifiedDurable(PHONE, T0, {
      PhoneVerificationMarker: mkModel({ verifiedAt: 'not-a-date' }),
    })).toBe(false);
    expect(await isPhoneVerifiedDurable('', T0, { PhoneVerificationMarker: mkModel(null) })).toBe(false);
  });

  it('fails CLOSED on a read error — a DB wobble must never mint verified proof', async () => {
    const PhoneVerificationMarker = {
      findByPk: jest.fn().mockRejectedValue(new Error('connection reset')),
    };
    expect(await isPhoneVerifiedDurable(PHONE, T0, { PhoneVerificationMarker, logger: silent })).toBe(false);
  });

  it('a write failure is swallowed — an OTP check must not 500 over a marker', async () => {
    const PhoneVerificationMarker = { upsert: jest.fn().mockRejectedValue(new Error('nope')) };
    await expect(persistPhoneVerification(PHONE, T0, { PhoneVerificationMarker, logger: silent }))
      .resolves.toBe(false);
  });

  it('a successful persist sweeps markers past the durable window', async () => {
    const PhoneVerificationMarker = mkModel(null);
    await persistPhoneVerification(PHONE, T0, { PhoneVerificationMarker });
    await Promise.resolve(); // the sweep is detached from the verify
    const [{ where }] = PhoneVerificationMarker.destroy.mock.calls[0];
    expect(where.verifiedAt[Object.getOwnPropertySymbols(where.verifiedAt)[0]])
      .toEqual(new Date(T0 - 24 * 3600_000));
  });

  it('a failed persist reports false and sweeps nothing', async () => {
    const PhoneVerificationMarker = mkModel(null);
    PhoneVerificationMarker.upsert.mockRejectedValue(new Error('nope'));
    await expect(persistPhoneVerification(PHONE, T0, { PhoneVerificationMarker, logger: silent }))
      .resolves.toBe(false);
    expect(PhoneVerificationMarker.destroy).not.toHaveBeenCalled();
  });

  it('a sweep failure never surfaces', async () => {
    const PhoneVerificationMarker = mkModel(null);
    PhoneVerificationMarker.destroy.mockRejectedValue(new Error('lock timeout'));
    await expect(persistPhoneVerification(PHONE, T0, { PhoneVerificationMarker, logger: silent }))
      .resolves.toBe(true);
    await expect(pruneExpiredMarkers(T0, { PhoneVerificationMarker, logger: silent })).resolves.toBe(0);
  });

  it('erasure deletes the durable row by hash', async () => {
    const PhoneVerificationMarker = mkModel(null);
    await forgetPhoneVerification(PHONE, { PhoneVerificationMarker });
    expect(PhoneVerificationMarker.destroy).toHaveBeenCalledWith({ where: { phoneHash: HASH } });
  });

  it('erasure never throws', async () => {
    const PhoneVerificationMarker = { destroy: jest.fn().mockRejectedValue(new Error('gone')) };
    await expect(forgetPhoneVerification(PHONE, { PhoneVerificationMarker, logger: silent }))
      .resolves.toBe(false);
  });
});
