import {
  validateFact, birthYearToBand, clampSourceEventAt, isCollectionKey,
  FACT_KEYS, SOURCE_RANK, TAXONOMY_VERSION, EVENT_SKEW_MS,
} from '../../src/utils/factTaxonomy.js';

/**
 * Fact taxonomy v1 (consumer-profile-enrichment plan §4) — the allowlist +
 * per-key value schemas every fact writer validates against. The matrix
 * below is the drift alarm: a key added to FACT_KEYS without shape coverage
 * fails the round-trip test.
 */
describe('factTaxonomy', () => {
  test('exports a stable version and ranked sources', () => {
    expect(TAXONOMY_VERSION).toBe('v1');
    expect(SOURCE_RANK.manual).toBeGreaterThan(SOURCE_RANK.form);
    expect(SOURCE_RANK.form).toBeGreaterThan(SOURCE_RANK.quiz);
    expect(SOURCE_RANK.quiz).toBeGreaterThan(SOURCE_RANK.screening_transcript);
    expect(SOURCE_RANK.screening_transcript).toBeGreaterThan(SOURCE_RANK.retell_analysis);
  });

  const VALID = {
    'identity.gender': { v: 'female' },
    'identity.birth_year_band': { v: '1985-1989' },
    'identity.ethnicity': { v: 'chinese' },
    'identity.preferred_language': { v: 'zh' },
    'family.marital_status': { v: 'divorced' },
    'family.children': { v: [{ birth_year_band: '2015-2019', gender: 'male' }], complete: true },
    'family.parents_alive': { v: true },
    'household.pets': { v: ['dog'], complete: false },
    'assets.car_owner': { v: false },
    'assets.property': { v: 'hdb' },
    'career.job_title': { v: 'Software Engineer' },
    'career.industry': { v: 'Technology' },
    'career.employment': { v: 'self_employed' },
    'finance.income_band': { v: '6-10k' },
    'finance.annual_income_band': { v: '80-120k' },
    'finance.retirement_age_band': { v: '60-64' },
    'finance.existing_coverage': { v: ['life', 'health'] },
    'life_event.recent': { v: 'divorce', when: '2026-Q1' },
    'interests.tags': { v: ['cars', 'travel'] },
    'residency.status': { v: 'citizen' },
  };

  test('every taxonomy key has a passing example (round-trip)', () => {
    for (const key of Object.keys(FACT_KEYS)) {
      expect(VALID[key]).toBeDefined();
      expect(validateFact(key, VALID[key])).toEqual({ ok: true });
    }
    // and the matrix carries no orphans
    for (const key of Object.keys(VALID)) expect(FACT_KEYS[key]).toBeDefined();
  });

  test('unknown keys are rejected — never free-form', () => {
    expect(validateFact('identity.shoe_size', { v: 42 }).ok).toBe(false);
    expect(validateFact('', { v: 1 }).ok).toBe(false);
  });

  test.each([
    ['identity.gender', { v: 'other' }],
    ['identity.gender', { v: 'male', extra: 1 }],
    ['identity.birth_year_band', { v: '1985-1990' }], // 6-year span
    ['identity.birth_year_band', { v: '1986-1990' }], // not multiple of 5
    ['identity.birth_year_band', { v: '85-89' }],
    ['family.children', { v: [{ birth_year_band: 'bad' }] }],
    ['family.children', { v: [{ nickname: 'Ah Boy' }] }],
    ['family.children', { v: {}, complete: true }],
    ['household.pets', { v: ['dragon'] }],
    ['household.pets', { v: ['dog', 'dog'] }],
    ['assets.car_owner', { v: 'yes' }],
    ['career.job_title', { v: '' }],
    ['career.job_title', { v: 'x'.repeat(81) }],
    ['finance.annual_income_band', { v: '90k' }],
    ['finance.retirement_age_band', { v: '62' }],
    ['life_event.recent', { v: 'won_lottery' }],
    ['life_event.recent', { v: 'divorce', when: 'last year' }],
    ['interests.tags', { v: ['cars', 'crypto-moonshots'] }],
    ['residency.status', { v: 'tourist' }],
  ])('rejects bad shape %s %j', (key, value) => {
    expect(validateFact(key, value).ok).toBe(false);
  });

  test('negatives and explicit emptiness are first-class', () => {
    expect(validateFact('assets.car_owner', { v: false })).toEqual({ ok: true });
    expect(validateFact('family.parents_alive', { v: false })).toEqual({ ok: true });
    expect(validateFact('family.children', { v: [], complete: true })).toEqual({ ok: true });
    expect(validateFact('household.pets', { v: [], complete: true })).toEqual({ ok: true });
  });

  test('collection keys are flagged for the resolver', () => {
    expect(isCollectionKey('family.children')).toBe(true);
    expect(isCollectionKey('household.pets')).toBe(true);
    expect(isCollectionKey('finance.existing_coverage')).toBe(true);
    expect(isCollectionKey('interests.tags')).toBe(true);
    expect(isCollectionKey('identity.gender')).toBe(false);
  });

  test('birthYearToBand: canonical 5-year bands, never ages', () => {
    expect(birthYearToBand(1988)).toBe('1985-1989');
    expect(birthYearToBand(1990)).toBe('1990-1994');
    expect(birthYearToBand('2004')).toBe('2000-2004');
    expect(birthYearToBand(1900)).toBeNull();
    expect(birthYearToBand(2040)).toBeNull();
    expect(birthYearToBand('soon')).toBeNull();
  });

  test('clampSourceEventAt: future timestamps beyond skew are clamped (R3 #8)', () => {
    const now = Date.UTC(2026, 6, 26);
    const past = new Date(now - 1000);
    expect(clampSourceEventAt(past, now).getTime()).toBe(past.getTime());
    const nearFuture = new Date(now + EVENT_SKEW_MS - 1000);
    expect(clampSourceEventAt(nearFuture, now).getTime()).toBe(nearFuture.getTime());
    const farFuture = new Date(now + 30 * 86400000);
    expect(clampSourceEventAt(farFuture, now).getTime()).toBe(now + EVENT_SKEW_MS);
    expect(clampSourceEventAt('garbage', now).getTime()).toBe(now);
  });
});
