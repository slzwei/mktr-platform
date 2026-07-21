import { jest } from '@jest/globals';
import '../setup.js';

// Mock the Sequelize connection so these stay pure-unit; we assert the SQL shape
// and the parsing, not Postgres itself.
const query = jest.fn().mockResolvedValue([[{ count: '3', expiresAt: '2026-07-21T16:00:00.000Z' }], {}]);
jest.unstable_mockModule('../../src/database/connection.js', () => ({ sequelize: { query } }));

const {
  sgtDayKey, nextSgtMidnight, blindPhone, bump, unbump, peek, reset,
} = await import('../../src/services/rateCounter.js');

describe('rateCounter (unit)', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('Singapore day boundaries', () => {
    it('reports the SG calendar day, not the UTC one', () => {
      // 16:30Z is already 00:30 the next day in Singapore (UTC+8).
      expect(sgtDayKey(new Date('2026-07-21T10:00:00Z'))).toBe('2026-07-21');
      expect(sgtDayKey(new Date('2026-07-21T16:30:00Z'))).toBe('2026-07-22');
    });

    it('rolls the window at Singapore midnight', () => {
      expect(nextSgtMidnight(new Date('2026-07-21T10:00:00Z')).toISOString())
        .toBe('2026-07-21T16:00:00.000Z'); // = 22 Jul 00:00 SGT

      // Just past SG midnight, the next boundary is a further 24h out.
      expect(nextSgtMidnight(new Date('2026-07-21T16:30:00Z')).toISOString())
        .toBe('2026-07-22T16:00:00.000Z');
    });
  });

  describe('blindPhone', () => {
    it('is deterministic but does not leak the number', () => {
      const a = blindPhone('+6591234567');
      expect(a).toBe(blindPhone('+6591234567'));
      expect(a).not.toContain('91234567');
      expect(a).toHaveLength(32);
    });

    it('separates different numbers', () => {
      expect(blindPhone('+6591234567')).not.toBe(blindPhone('+6591234568'));
    });
  });

  describe('bump', () => {
    it('upserts atomically and returns the post-increment count', async () => {
      const result = await bump('k1', new Date('2026-07-21T16:00:00.000Z'));

      const [sql, opts] = query.mock.calls[0];
      expect(sql).toContain('ON CONFLICT (key) DO UPDATE');
      expect(sql).toContain('RETURNING');
      expect(opts.replacements.key).toBe('k1');
      expect(result.count).toBe(3); // parsed from Postgres' string
    });

    it('resets the counter in-statement when the window has expired', async () => {
      await bump('k1', new Date());
      const [sql] = query.mock.calls[0];
      // The CASE is what makes an expired row self-heal without a sweeper.
      expect(sql).toMatch(/CASE WHEN rate_counters\."expiresAt" <= now\(\) THEN 1/);
    });
  });

  describe('unbump / peek / reset', () => {
    it('never decrements below zero or revives an expired window', async () => {
      await unbump('k1');
      const [sql] = query.mock.calls[0];
      expect(sql).toContain('GREATEST(count - 1, 0)');
      expect(sql).toContain('"expiresAt" > now()');
    });

    it('treats an expired or missing row as zero', async () => {
      query.mockResolvedValueOnce([[], {}]);
      await expect(peek('k1')).resolves.toMatchObject({ count: 0 });
    });

    it('deletes on reset', async () => {
      await reset('k1');
      expect(query.mock.calls[0][0]).toContain('DELETE FROM rate_counters');
    });
  });
});
