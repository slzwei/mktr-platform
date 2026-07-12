import { normalizeFeaturedDrop, applyFeaturedDropPolicy } from '../src/utils/featuredDrop.js';

describe('normalizeFeaturedDrop', () => {
  test('non-object inputs return undefined (drop the key)', () => {
    for (const bad of [undefined, null, 'yes', 42, true, [], [{}], new Date()]) {
      expect(normalizeFeaturedDrop(bad)).toBeUndefined();
    }
  });

  test('enabled is a strict boolean', () => {
    expect(normalizeFeaturedDrop({ enabled: true }).enabled).toBe(true);
    for (const bad of ['true', 1, {}, null, undefined]) {
      expect(normalizeFeaturedDrop({ enabled: bad }).enabled).toBe(false);
    }
  });

  test('strings are trimmed and length-capped; empty dropped', () => {
    const out = normalizeFeaturedDrop({
      enabled: true,
      title: `  ${'x'.repeat(60)}  `,
      valueLabel: ' S$20 ',
      emoji: '🧳',
    });
    expect(out.title).toHaveLength(40);
    expect(out.valueLabel).toBe('S$20');
    expect(out.emoji).toBe('🧳');
    expect(normalizeFeaturedDrop({ enabled: true, title: '   ' }).title).toBeUndefined();
    expect(normalizeFeaturedDrop({ enabled: true, title: 42 }).title).toBeUndefined();
  });

  test('cap coerces numeric strings, rejects junk and out-of-range', () => {
    expect(normalizeFeaturedDrop({ cap: '300' }).cap).toBe(300);
    expect(normalizeFeaturedDrop({ cap: 1 }).cap).toBe(1);
    for (const bad of [0, -5, 2.5, 'lots', null, 100001, Infinity, NaN]) {
      expect(normalizeFeaturedDrop({ cap: bad }).cap).toBeUndefined();
    }
  });

  test('endsAt accepts strict YYYY-MM-DD only', () => {
    expect(normalizeFeaturedDrop({ endsAt: '2026-07-20' }).endsAt).toBe('2026-07-20');
    expect(normalizeFeaturedDrop({ endsAt: ' 2026-07-20 ' }).endsAt).toBe('2026-07-20');
    for (const bad of ['20/07/2026', '2026-13-40', 'soon', 20260720, '2026-07-20T00:00:00Z']) {
      expect(normalizeFeaturedDrop({ endsAt: bad }).endsAt).toBeUndefined();
    }
  });

  test('unknown keys are stripped', () => {
    const out = normalizeFeaturedDrop({ enabled: true, valueLabel: 'FREE', __proto__pollute: 1, script: '<img>' });
    expect(Object.keys(out).sort()).toEqual(['enabled', 'valueLabel']);
  });
});

describe('applyFeaturedDropPolicy (publication is admin-only)', () => {
  const stored = { enabled: true, valueLabel: 'S$20' };

  test('admin: incoming wins, normalized', () => {
    const out = applyFeaturedDropPolicy({
      incoming: { enabled: true, valueLabel: ' FREE ', junk: 1 },
      stored,
      role: 'admin',
    });
    expect(out).toEqual({ enabled: true, valueLabel: 'FREE' });
  });

  test('admin omitting the key preserves stored', () => {
    expect(applyFeaturedDropPolicy({ incoming: undefined, stored, role: 'admin' })).toEqual(stored);
  });

  test('admin can unpublish', () => {
    const out = applyFeaturedDropPolicy({ incoming: { enabled: false }, stored, role: 'admin' });
    expect(out.enabled).toBe(false);
  });

  test('agent changes are ignored — stored value preserved', () => {
    const out = applyFeaturedDropPolicy({
      incoming: { enabled: true, valueLabel: 'HACKED' },
      stored: { enabled: false },
      role: 'agent',
    });
    expect(out).toEqual({ enabled: false });
  });

  test('agent cannot seed publication when nothing stored', () => {
    expect(
      applyFeaturedDropPolicy({ incoming: { enabled: true }, stored: undefined, role: 'agent' })
    ).toBeUndefined();
  });

  test('missing role behaves like non-admin', () => {
    expect(
      applyFeaturedDropPolicy({ incoming: { enabled: true }, stored: undefined, role: undefined })
    ).toBeUndefined();
  });
});
