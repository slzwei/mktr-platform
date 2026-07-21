import { jest } from '@jest/globals';
import '../setup.js';

const bump = jest.fn();
const unbump = jest.fn().mockResolvedValue(undefined);
const reset = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('../../src/services/rateCounter.js', () => ({ bump, unbump, reset }));

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.unstable_mockModule('../../src/utils/logger.js', () => ({ logger }));

const { PostgresRateLimitStore, clientKey } = await import('../../src/middleware/pgRateLimitStore.js');

const WINDOW = 15 * 60 * 1000;

describe('PostgresRateLimitStore (unit)', () => {
  let store;

  beforeEach(() => {
    jest.clearAllMocks();
    bump.mockResolvedValue({ count: 4, expiresAt: new Date() });
    store = new PostgresRateLimitStore({ prefix: 'rl:test' });
    store.init({ windowMs: WINDOW });
  });

  it('returns the durable count in express-rate-limit shape', async () => {
    const info = await store.increment('1.2.3.4');

    expect(info.totalHits).toBe(4);
    expect(info.resetTime).toBeInstanceOf(Date);
  });

  it('buckets hits into fixed windows aligned to windowMs', async () => {
    await store.increment('1.2.3.4');

    const [key, expiresAt] = bump.mock.calls[0];
    expect(key).toMatch(/^rl:test:1\.2\.3\.4:\d+$/);

    const windowStart = Number(key.split(':').pop());
    expect(windowStart % WINDOW).toBe(0);                       // aligned
    expect(expiresAt.getTime()).toBe(windowStart + WINDOW);     // and expires with it
  });

  it('keeps separate prefixes from colliding', async () => {
    const other = new PostgresRateLimitStore({ prefix: 'rl:other' });
    other.init({ windowMs: WINDOW });

    await store.increment('1.2.3.4');
    await other.increment('1.2.3.4');

    expect(bump.mock.calls[0][0]).not.toBe(bump.mock.calls[1][0]);
  });

  it('fails OPEN when Postgres is unreachable', async () => {
    // A DB blip must not 503 the whole verification surface — the per-number
    // quota (which fails closed) is what guards the sender ID.
    bump.mockRejectedValue(new Error('ECONNREFUSED'));

    const info = await store.increment('1.2.3.4');

    expect(info.totalHits).toBe(0); // treated as under the limit
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('clientKey', () => {
  const req = (ip) => ({ ip });

  it('passes IPv4 through', () => {
    expect(clientKey(req('203.0.113.7'))).toBe('203.0.113.7');
  });

  it('unwraps IPv4-mapped IPv6', () => {
    expect(clientKey(req('::ffff:203.0.113.7'))).toBe('203.0.113.7');
  });

  it('collapses IPv6 to its /64 so one allocation is one client', () => {
    // A /64 hands out 2^64 addresses; keying on the full address would make the
    // limiter free to bypass.
    const a = clientKey(req('2001:db8:85a3:8d3:1319:8a2e:370:7348'));
    const b = clientKey(req('2001:db8:85a3:8d3:ffff:ffff:ffff:1'));
    expect(a).toBe(b);
    expect(a).toBe('2001:0db8:85a3:08d3');
  });

  it('expands :: compression correctly', () => {
    expect(clientKey(req('2001:db8::1'))).toBe('2001:0db8:0000:0000');
  });

  it('separates different /64s', () => {
    expect(clientKey(req('2001:db8:85a3:8d3::1')))
      .not.toBe(clientKey(req('2001:db8:85a3:8d4::1')));
  });

  it('falls back when no address is available', () => {
    expect(clientKey({})).toBe('unknown');
  });
});
