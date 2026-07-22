import { describe, it, expect } from 'vitest';
import { ageLabelOf } from '../content';

/**
 * "Who it's for" vs the range the funnel actually enforces. `age_range` is
 * hand-entered marketplace content with no default anywhere; the gate is the
 * campaigns.min_age/max_age columns. They were unlinked.
 */
describe('ageLabelOf — the label must match the gate', () => {
  it('falls back to the ENFORCED range when no age_range was ever typed', () => {
    // The standard case: defaults 18-65, age_range never filled. This used to
    // render "Everyone" and then reject a 70-year-old at the DOB field.
    expect(ageLabelOf({}, { min_age: 18, max_age: 65 })).toBe('Ages 18–65');
  });

  it('an explicit age_range still wins — an operator who typed one meant it', () => {
    expect(ageLabelOf({ age_range: { min: 25, max: 40 } }, { min_age: 18, max_age: 65 })).toBe('Ages 25–40');
  });

  it('school levels still win over both', () => {
    expect(ageLabelOf({ school_levels: ['P1', 'P6'] }, { min_age: 18, max_age: 65 })).toBe('P1–P6');
  });

  it('an open-ended enforced range reads as a floor, and 21+ gets the adult label', () => {
    expect(ageLabelOf({}, { min_age: 18, max_age: null })).toBe('Ages 18+');
    expect(ageLabelOf({}, { min_age: 21, max_age: null })).toBe('Adults (21+)');
  });

  it('no campaign and no age_range is still null (callers render "Everyone")', () => {
    expect(ageLabelOf({})).toBe(null);
    expect(ageLabelOf({}, {})).toBe(null);
  });
});
