import { resolveCurrentFacts } from '../../src/utils/factResolver.js';

/**
 * resolveCurrentFacts (consumer-profile-enrichment plan §3.4) — the total,
 * deterministic precedence function. These are the Codex R2 #8 / R3 #8 /
 * R4-era matrix cases: fresh-window eligibility, tuple total order,
 * collection baseline/augment/dedupe, supersession/retraction, and
 * order-independence.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
let seq = 0;

function obs(key, value, { source = 'form', confidence = 1, daysAgo = 0, id, supersededAt = null, retractedAt = null } = {}) {
  seq += 1;
  return {
    id: id || `obs-${String(seq).padStart(4, '0')}`,
    key,
    value,
    confidence,
    source,
    sourceEventAt: new Date(T0 + 400 * DAY - daysAgo * DAY),
    supersededAt,
    retractedAt,
  };
}

describe('resolveCurrentFacts', () => {
  test('unknown keys and superseded/retracted rows never resolve', () => {
    const out = resolveCurrentFacts([
      obs('identity.gender', { v: 'male' }, { supersededAt: new Date() }),
      obs('identity.gender', { v: 'female' }, { retractedAt: new Date() }),
      { ...obs('identity.gender', { v: 'male' }), key: 'not.a.key' },
    ]);
    expect(out).toEqual({});
  });

  test('within the fresh window, source rank beats confidence beats recency', () => {
    const out = resolveCurrentFacts([
      obs('family.marital_status', { v: 'single' }, { source: 'screening_transcript', confidence: 0.9, daysAgo: 1 }),
      obs('family.marital_status', { v: 'married' }, { source: 'form', confidence: 1, daysAgo: 100 }),
    ]);
    expect(out['family.marital_status'].value).toEqual({ v: 'married' });
    expect(out['family.marital_status'].source).toBe('form');
  });

  test('the 180-day fresh window is eligibility, not a tie-break: stale explicit answers lose', () => {
    const out = resolveCurrentFacts([
      obs('family.marital_status', { v: 'married' }, { source: 'form', daysAgo: 200 }),
      obs('family.marital_status', { v: 'divorced' }, { source: 'screening_transcript', confidence: 0.7, daysAgo: 0 }),
    ]);
    expect(out['family.marital_status'].value).toEqual({ v: 'divorced' });
  });

  test('exactly-180-days-old still competes (boundary is inclusive)', () => {
    const out = resolveCurrentFacts([
      obs('family.marital_status', { v: 'married' }, { source: 'form', daysAgo: 180 }),
      obs('family.marital_status', { v: 'single' }, { source: 'quiz', daysAgo: 0 }),
    ]);
    expect(out['family.marital_status'].value).toEqual({ v: 'married' });
  });

  test('same rank: higher confidence wins; then newer; then id (total order)', () => {
    const byConf = resolveCurrentFacts([
      obs('assets.car_owner', { v: true }, { source: 'screening_transcript', confidence: 0.6, daysAgo: 0 }),
      obs('assets.car_owner', { v: false }, { source: 'screening_transcript', confidence: 0.9, daysAgo: 5 }),
    ]);
    expect(byConf['assets.car_owner'].value).toEqual({ v: false });

    const byTime = resolveCurrentFacts([
      obs('assets.car_owner', { v: true }, { source: 'form', daysAgo: 3 }),
      obs('assets.car_owner', { v: false }, { source: 'form', daysAgo: 1 }),
    ]);
    expect(byTime['assets.car_owner'].value).toEqual({ v: false });

    const a = obs('assets.car_owner', { v: true }, { source: 'form', daysAgo: 2, id: 'obs-aaaa' });
    const b = { ...obs('assets.car_owner', { v: false }, { source: 'form', daysAgo: 2, id: 'obs-bbbb' }), sourceEventAt: a.sourceEventAt };
    expect(resolveCurrentFacts([a, b])['assets.car_owner'].observationId).toBe('obs-bbbb');
  });

  test('negatives win like any other value (sold the car)', () => {
    const out = resolveCurrentFacts([
      obs('assets.car_owner', { v: true }, { source: 'form', daysAgo: 90 }),
      obs('assets.car_owner', { v: false }, { source: 'form', daysAgo: 1 }),
    ]);
    expect(out['assets.car_owner'].value).toEqual({ v: false });
  });

  describe('collections (family.children)', () => {
    test('complete baseline + later partial augments; earlier partial is ignored', () => {
      const earlierPartial = obs('family.children', { v: [{ birth_year_band: '2010-2014', gender: 'female' }], complete: false }, { source: 'screening_transcript', confidence: 0.8, daysAgo: 40 });
      const baseline = obs('family.children', { v: [{ birth_year_band: '2015-2019', gender: 'male' }], complete: true }, { source: 'form', daysAgo: 30 });
      const laterPartial = obs('family.children', { v: [{ birth_year_band: '2020-2024', gender: 'female' }], complete: false }, { source: 'screening_transcript', confidence: 0.8, daysAgo: 5 });
      const out = resolveCurrentFacts([earlierPartial, baseline, laterPartial]);
      expect(out['family.children'].value.v).toEqual([
        { birth_year_band: '2015-2019', gender: 'male' },
        { birth_year_band: '2020-2024', gender: 'female' },
      ]);
      expect(out['family.children'].value.complete).toBe(true);
      expect(out['family.children'].basis).toEqual([baseline.id, laterPartial.id]);
    });

    test('a partial mention can never SHRINK the set ("my daughter is eight")', () => {
      const baseline = obs('family.children', {
        v: [{ birth_year_band: '2015-2019', gender: 'male' }, { birth_year_band: '2015-2019', gender: 'female' }],
        complete: true,
      }, { source: 'form', daysAgo: 20 });
      const partial = obs('family.children', { v: [{ birth_year_band: '2015-2019', gender: 'female' }], complete: false }, { source: 'screening_transcript', confidence: 0.9, daysAgo: 2 });
      const out = resolveCurrentFacts([baseline, partial]);
      expect(out['family.children'].value.v).toHaveLength(2);
    });

    test('empty-complete = explicitly no children; later partials still augment', () => {
      const none = obs('family.children', { v: [], complete: true }, { source: 'form', daysAgo: 50 });
      const newborn = obs('family.children', { v: [{ birth_year_band: '2025-2029' }], complete: false }, { source: 'screening_transcript', confidence: 0.9, daysAgo: 1 });
      const out = resolveCurrentFacts([none, newborn]);
      expect(out['family.children'].value.v).toEqual([{ birth_year_band: '2025-2029' }]);
    });

    test('no baseline: deduped union of fresh partials, canonical order', () => {
      const p1 = obs('family.children', { v: [{ birth_year_band: '2020-2024', gender: 'male' }] }, { source: 'screening_transcript', confidence: 0.7, daysAgo: 9 });
      const p2 = obs('family.children', { v: [{ birth_year_band: '2020-2024', gender: 'male' }, { birth_year_band: '2015-2019', gender: 'female' }] }, { source: 'screening_transcript', confidence: 0.8, daysAgo: 3 });
      const out = resolveCurrentFacts([p1, p2]);
      expect(out['family.children'].value.v).toEqual([
        { birth_year_band: '2015-2019', gender: 'female' },
        { birth_year_band: '2020-2024', gender: 'male' },
      ]);
      expect(out['family.children'].value.complete).toBe(false);
    });

    test('stale partials outside the fresh window never resurface', () => {
      const old = obs('family.children', { v: [{ birth_year_band: '2005-2009' }] }, { source: 'screening_transcript', confidence: 0.9, daysAgo: 300 });
      const fresh = obs('family.children', { v: [{ birth_year_band: '2020-2024' }] }, { source: 'screening_transcript', confidence: 0.6, daysAgo: 1 });
      const out = resolveCurrentFacts([old, fresh]);
      expect(out['family.children'].value.v).toEqual([{ birth_year_band: '2020-2024' }]);
    });
  });

  test('string collections union with baseline-wins dedupe (pets)', () => {
    const baseline = obs('household.pets', { v: ['dog'], complete: true }, { source: 'form', daysAgo: 10 });
    const partial = obs('household.pets', { v: ['dog', 'cat'] }, { source: 'screening_transcript', confidence: 0.8, daysAgo: 1 });
    const out = resolveCurrentFacts([baseline, partial]);
    expect(out['household.pets'].value.v).toEqual(['cat', 'dog']);
    expect(out['household.pets'].basis).toEqual([baseline.id, partial.id]);
  });

  test('resolution is order-independent (property)', () => {
    const rows = [
      obs('family.marital_status', { v: 'married' }, { source: 'form', daysAgo: 100 }),
      obs('family.marital_status', { v: 'single' }, { source: 'quiz', confidence: 0.9, daysAgo: 60 }),
      obs('family.children', { v: [{ birth_year_band: '2015-2019' }], complete: true }, { source: 'form', daysAgo: 30 }),
      obs('family.children', { v: [{ birth_year_band: '2020-2024' }] }, { source: 'screening_transcript', confidence: 0.7, daysAgo: 2 }),
      obs('assets.car_owner', { v: false }, { source: 'manual', daysAgo: 5 }),
      obs('assets.car_owner', { v: true }, { source: 'form', daysAgo: 3 }),
    ];
    const base = resolveCurrentFacts(rows);
    for (let i = 0; i < 6; i += 1) {
      const shuffled = [...rows].sort(() => (((i * 7919) % 13) / 13) - 0.5);
      expect(resolveCurrentFacts(shuffled)).toEqual(base);
    }
    // manual outranks form even when older
    expect(base['assets.car_owner'].value).toEqual({ v: false });
  });
});
