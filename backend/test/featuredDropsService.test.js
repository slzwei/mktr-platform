import { jest } from '@jest/globals';

// Mock models BEFORE the SUT is imported (Jest ESM pattern) — no DB needed.
const findAllMock = jest.fn();
const countMock = jest.fn();
jest.unstable_mockModule('../src/models/index.js', () => ({
  Campaign: { findAll: findAllMock },
  Prospect: { count: countMock },
}));

const loggerErrorMock = jest.fn();
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: loggerErrorMock, debug: jest.fn() },
}));

process.env.PUBLIC_BASE_URL = 'https://redeem.sg';

const { getFeaturedDrops, __resetFeaturedDropsCache } = await import(
  '../src/services/featuredDropsService.js'
);

// 2026-07-12 12:00 SGT
const NOW = Date.parse('2026-07-12T04:00:00Z');
const DAY = 24 * 3600 * 1000;

const campaign = (id, fd, name = `Campaign ${id}`) => ({ id, name, design_config: { featuredDrop: fd } });

beforeEach(() => {
  __resetFeaturedDropsCache();
  findAllMock.mockReset();
  countMock.mockReset();
  loggerErrorMock.mockReset();
  countMock.mockResolvedValue([]);
});

describe('getFeaturedDrops', () => {
  test('queries only active-lifecycle campaigns and keeps only enabled flags', async () => {
    findAllMock.mockResolvedValue([
      campaign('a', { enabled: true, valueLabel: 'FREE' }),
      campaign('b', { enabled: false }),
      campaign('c', undefined),
      campaign('d', 'garbage'),
    ]);
    const drops = await getFeaturedDrops({ now: NOW });
    expect(findAllMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { is_active: true, status: 'active' } })
    );
    expect(drops.map((d) => d.id)).toEqual(['a']);
  });

  test('DTO is a strict whitelist; claim link always redeem.sg; title falls back to campaign name', async () => {
    findAllMock.mockResolvedValue([campaign('a', { enabled: true, valueLabel: 'S$20', emoji: '🛒' }, 'Grocery Run')]);
    const [drop] = await getFeaturedDrops({ now: NOW });
    expect(drop).toEqual({
      id: 'a',
      title: 'Grocery Run',
      valueLabel: 'S$20',
      emoji: '🛒',
      status: 'live',
      claimUrl: 'https://redeem.sg/LeadCapture?campaign_id=a',
    });
  });

  test('counts appear only when a cap is set; pct clamped; pg string counts parsed', async () => {
    findAllMock.mockResolvedValue([
      campaign('capped', { enabled: true, cap: 100 }),
      campaign('uncapped', { enabled: true }),
    ]);
    countMock.mockResolvedValue([
      { campaignId: 'capped', count: '72' },
      { campaignId: 'uncapped', count: '9999' },
    ]);
    const drops = await getFeaturedDrops({ now: NOW });
    const capped = drops.find((d) => d.id === 'capped');
    const uncapped = drops.find((d) => d.id === 'uncapped');
    expect(capped.claimedPct).toBe(72);
    expect(capped.left).toBe(28);
    expect(uncapped.claimedPct).toBeUndefined();
    expect(uncapped.left).toBeUndefined();
    expect(uncapped).not.toHaveProperty('claimedCount');
  });

  test('cap reached → gone with left 0 and pct 100', async () => {
    findAllMock.mockResolvedValue([campaign('a', { enabled: true, cap: 50 })]);
    countMock.mockResolvedValue([{ campaignId: 'a', count: 61 }]);
    const [drop] = await getFeaturedDrops({ now: NOW });
    expect(drop.status).toBe('gone');
    expect(drop.left).toBe(0);
    expect(drop.claimedPct).toBe(100);
  });

  test('endsAt is inclusive through SGT end-of-day', async () => {
    findAllMock.mockResolvedValue([campaign('a', { enabled: true, endsAt: '2026-07-12' })]);
    // 2026-07-12 23:59:00 SGT — still live
    let [drop] = await getFeaturedDrops({ now: Date.parse('2026-07-12T15:59:00Z') });
    expect(drop.status).toBe('live');
    __resetFeaturedDropsCache();
    // 2026-07-13 00:01 SGT — gone
    [drop] = await getFeaturedDrops({ now: Date.parse('2026-07-12T16:01:00Z') });
    expect(drop.status).toBe('gone');
  });

  test('gone drops auto-hide 7 days after endsAt', async () => {
    findAllMock.mockResolvedValue([campaign('a', { enabled: true, endsAt: '2026-07-01' })]);
    const drops = await getFeaturedDrops({ now: NOW }); // 11 days later
    expect(drops).toEqual([]);
    // No count query when nothing is flagged/visible
    expect(countMock).not.toHaveBeenCalled();
  });

  test('deterministic ordering: live first, soonest end first, nulls last, id tiebreak', async () => {
    findAllMock.mockResolvedValue([
      campaign('z-nul', { enabled: true }),
      campaign('gone1', { enabled: true, endsAt: '2026-07-11' }),
      campaign('b-late', { enabled: true, endsAt: '2026-07-30' }),
      campaign('a-soon', { enabled: true, endsAt: '2026-07-14' }),
      campaign('a-nul', { enabled: true }),
    ]);
    const drops = await getFeaturedDrops({ now: NOW });
    expect(drops.map((d) => d.id)).toEqual(['a-soon', 'b-late', 'a-nul', 'z-nul', 'gone1']);
  });

  test('caps the list at 6', async () => {
    findAllMock.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => campaign(`c${i}`, { enabled: true }))
    );
    const drops = await getFeaturedDrops({ now: NOW });
    expect(drops).toHaveLength(6);
  });

  test('60s TTL cache: second call within TTL hits cache', async () => {
    findAllMock.mockResolvedValue([campaign('a', { enabled: true })]);
    await getFeaturedDrops({ now: NOW });
    await getFeaturedDrops({ now: NOW + 59_000 });
    expect(findAllMock).toHaveBeenCalledTimes(1);
    await getFeaturedDrops({ now: NOW + 61_000 });
    expect(findAllMock).toHaveBeenCalledTimes(2);
  });

  test('concurrent misses coalesce into one query', async () => {
    let release;
    findAllMock.mockReturnValue(new Promise((res) => { release = () => res([campaign('a', { enabled: true })]); }));
    const p1 = getFeaturedDrops({ now: NOW });
    const p2 = getFeaturedDrops({ now: NOW });
    release();
    const [d1, d2] = await Promise.all([p1, p2]);
    expect(d1).toBe(d2);
    expect(findAllMock).toHaveBeenCalledTimes(1);
  });

  test('stale-on-error: failed refresh serves last good list and logs', async () => {
    findAllMock.mockResolvedValueOnce([campaign('a', { enabled: true })]);
    const first = await getFeaturedDrops({ now: NOW });
    findAllMock.mockRejectedValueOnce(new Error('db down'));
    const second = await getFeaturedDrops({ now: NOW + 61_000 });
    expect(second).toBe(first);
    expect(loggerErrorMock).toHaveBeenCalled();
  });

  test('error with no cache propagates (route 500s, homepage falls back)', async () => {
    findAllMock.mockRejectedValueOnce(new Error('db down'));
    await expect(getFeaturedDrops({ now: NOW })).rejects.toThrow('db down');
  });
});
