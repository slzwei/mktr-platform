import {
  normalizeMarketplaceContent, applyMarketplacePolicy, MARKETPLACE_CAMPAIGN_TYPES,
  CONSUMER_CATEGORY_DEFS, CONSUMER_CATEGORIES, consumerCategoryLabel,
} from '../src/utils/marketplaceContent.js';

describe('normalizeMarketplaceContent', () => {
  test('non-objects normalize to empty', () => {
    for (const v of [undefined, null, 'x', 42, []]) {
      expect(normalizeMarketplaceContent(v)).toEqual({});
    }
  });

  test('enums clamp: unknown values are dropped', () => {
    const out = normalizeMarketplaceContent({
      category: 'not_a_category',
      offer_type: 'freebie',
      mode: 'teleport',
      qr_entry: 'somewhere',
    });
    expect(out).toEqual({});
  });

  test('valid enums pass through', () => {
    const out = normalizeMarketplaceContent({
      category: 'wellness', offer_type: 'trial', mode: 'hybrid', qr_entry: 'detail',
    });
    expect(out).toEqual({ category: 'wellness', offer_type: 'trial', mode: 'hybrid', qr_entry: 'detail' });
  });

  test('age_range requires valid min<=max ints', () => {
    expect(normalizeMarketplaceContent({ age_range: { min: 9, max: 12 } }).age_range).toEqual({ min: 9, max: 12 });
    expect(normalizeMarketplaceContent({ age_range: { min: 12, max: 9 } }).age_range).toBeUndefined();
    expect(normalizeMarketplaceContent({ age_range: { min: 'x', max: 12 } }).age_range).toBeUndefined();
  });

  test('availability filters unknown days and malformed slots', () => {
    const out = normalizeMarketplaceContent({
      availability: { days: ['Sat', 'Caturday', 'Sun'], slots: ['10:00', 'noonish', '14:30'] },
    });
    expect(out.availability).toEqual({ days: ['Sat', 'Sun'], slots: ['10:00', '14:30'] });
  });

  test('activation coerces required and clamps copy lengths', () => {
    const out = normalizeMarketplaceContent({
      activation: { required: 'yes', type: 'financial_consult', duration_mins: 20, summary: 'S', detail: 'D', extra: 'dropme' },
    });
    expect(out.activation).toEqual({ required: false, type: 'financial_consult', duration_mins: 20, summary: 'S', detail: 'D' });
  });

  test('sponsor null is preserved; junk sponsor keys are stripped', () => {
    expect(normalizeMarketplaceContent({ sponsor: null }).sponsor).toBeNull();
    const out = normalizeMarketplaceContent({ sponsor: { kind: 'financial_consultant', disclosure: 'x', internalId: 'no' } });
    expect(out.sponsor).toEqual({ kind: 'financial_consultant', disclosure: 'x' });
  });

  test('content_blocks faq pairs require both q and a, capped at 6', () => {
    const faq = Array.from({ length: 9 }, (_, i) => ({ q: `q${i}`, a: `a${i}` }));
    faq.push({ q: 'orphan' });
    const out = normalizeMarketplaceContent({ content_blocks: { data_use: 'du', faq } });
    expect(out.content_blocks.faq).toHaveLength(6);
    expect(out.content_blocks.data_use).toBe('du');
  });

  test('unknown top-level keys never survive', () => {
    const out = normalizeMarketplaceContent({ hax: true, name: 'Title' });
    expect(out).toEqual({ name: 'Title' });
  });
});

describe('applyMarketplacePolicy', () => {
  test('admin sets and clears the listing', () => {
    expect(applyMarketplacePolicy({ incoming: true, stored: undefined, role: 'admin' })).toBe(true);
    expect(applyMarketplacePolicy({ incoming: false, stored: true, role: 'admin' })).toBe(false);
    expect(applyMarketplacePolicy({ incoming: undefined, stored: true, role: 'admin' })).toBe(true);
  });

  test('non-admins can never flip the listing', () => {
    expect(applyMarketplacePolicy({ incoming: true, stored: undefined, role: 'agent' })).toBeUndefined();
    expect(applyMarketplacePolicy({ incoming: false, stored: true, role: 'agent' })).toBe(true);
    expect(applyMarketplacePolicy({ incoming: true, stored: false, role: 'driver' })).toBe(false);
  });

  test('quiz and guided_review are not marketplace types', () => {
    expect(MARKETPLACE_CAMPAIGN_TYPES).not.toContain('quiz');
    expect(MARKETPLACE_CAMPAIGN_TYPES).not.toContain('guided_review');
    expect(MARKETPLACE_CAMPAIGN_TYPES).toContain('lead_generation');
  });
});

describe('CONSUMER_CATEGORY_DEFS (tracker "taxonomy" — the ONE category source)', () => {
  test('ids are unique and CONSUMER_CATEGORIES derives 1:1', () => {
    const ids = CONSUMER_CATEGORY_DEFS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CONSUMER_CATEGORIES).toEqual(ids);
  });

  test('every def carries a label and a known group', () => {
    for (const def of CONSUMER_CATEGORY_DEFS) {
      expect(typeof def.label).toBe('string');
      expect(def.label.length).toBeGreaterThan(0);
      expect(['education', 'lifestyle']).toContain(def.group);
    }
    expect(consumerCategoryLabel('dining')).toBe('Dining');
    expect(consumerCategoryLabel('unknown_thing')).toBe('unknown_thing');
  });
});

describe('sponsor.name survives the clamp (the named third-party consent key)', () => {
  it('keeps name alongside kind and disclosure', () => {
    const out = normalizeMarketplaceContent({
      sponsor: { name: '  Prudential Singapore ', kind: 'insurer', disclosure: 'Shared with a licensed rep.' },
    });
    expect(out.sponsor).toEqual({
      name: 'Prudential Singapore',
      kind: 'insurer',
      disclosure: 'Shared with a licensed rep.',
    });
  });

  it('a name-only sponsor is enough to survive — it is what gates the clause', () => {
    expect(normalizeMarketplaceContent({ sponsor: { name: 'Acme' } }).sponsor).toEqual({ name: 'Acme' });
  });

  it('is idempotent — the old clamp erased the name on every re-save', () => {
    const once = normalizeMarketplaceContent({ sponsor: { name: 'Acme', kind: 'insurer' } });
    const twice = normalizeMarketplaceContent(once);
    expect(twice.sponsor).toEqual({ name: 'Acme', kind: 'insurer' });
  });

  it('explicit null still clears the sponsor, and a blank name is not kept', () => {
    expect(normalizeMarketplaceContent({ sponsor: null }).sponsor).toBe(null);
    expect(normalizeMarketplaceContent({ sponsor: { name: '   ' } }).sponsor).toBeUndefined();
  });
});
