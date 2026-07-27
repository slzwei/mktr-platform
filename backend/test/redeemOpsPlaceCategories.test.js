import { jest } from '@jest/globals';
import {
  canonicalPlaceCategory,
  resolvePlaceCategoryWords,
  suggestPlaceCategories,
  unknownCategoriesMessage,
} from '../src/services/redeemOps/discovery/placeCategories.js';
import { GOOGLE_PLACE_CATEGORIES } from '../src/services/redeemOps/discovery/googlePlaceCategories.js';


/**
 * The Maps actor validates `categoryFilterWords` against a closed, all-lowercase
 * enum and 400s the whole run on one bad value — so these tests are the contract
 * that everything reaching that field is a real, correctly-spelled category.
 */
describe('the bundled allowlist mirrors the actor enum', () => {
  test('every value is a non-empty lowercase string, deduped and sorted', () => {
    expect(GOOGLE_PLACE_CATEGORIES.length).toBeGreaterThan(3000);
    expect(new Set(GOOGLE_PLACE_CATEGORIES).size).toBe(GOOGLE_PLACE_CATEGORIES.length);
    expect([...GOOGLE_PLACE_CATEGORIES].sort()).toEqual([...GOOGLE_PLACE_CATEGORIES]);
    for (const value of GOOGLE_PLACE_CATEGORIES) {
      expect(typeof value).toBe('string');
      expect(value).toBe(value.toLowerCase().trim());
      expect(value.length).toBeGreaterThan(0);
    }
  });

  test('every value canonicalises to itself (the enum is a fixed point)', () => {
    for (const value of GOOGLE_PLACE_CATEGORIES) {
      expect(canonicalPlaceCategory(value)).toBe(value);
    }
  });
});

describe('canonicalPlaceCategory', () => {
  test('prose casing — the exact 400 from prod on 2026-07-27', () => {
    // "Gymnastics center" et al are real categories; only the case was wrong,
    // and the actor rejected the run before crawling a single place.
    expect(canonicalPlaceCategory('Gymnastics center')).toBe('gymnastics center');
    expect(canonicalPlaceCategory('Sports school')).toBe('sports school');
    expect(canonicalPlaceCategory('Training centre')).toBe('training centre');
    expect(canonicalPlaceCategory("Children's club")).toBe("children's club");
  });

  test('British spelling folds onto the American category when only that exists', () => {
    expect(GOOGLE_PLACE_CATEGORIES).not.toContain('gymnastics centre');
    expect(canonicalPlaceCategory('Gymnastics centre')).toBe('gymnastics center');
    // …and stays put when Google itself spells it the British way.
    expect(canonicalPlaceCategory('training centre')).toBe('training centre');
  });

  test('curly apostrophes, plurals, "&"/"and" and stray punctuation all land', () => {
    expect(canonicalPlaceCategory('Children’s club')).toBe("children's club");
    expect(canonicalPlaceCategory('childrens club')).toBe("children's club");
    expect(canonicalPlaceCategory('Nail salons')).toBe('nail salon');
    expect(canonicalPlaceCategory('bed and breakfast')).toBe('bed & breakfast');
    expect(canonicalPlaceCategory('  "Coffee shop".  ')).toBe('coffee shop');
    expect(canonicalPlaceCategory('BAKERIES')).toBe('bakery');
  });

  test('a word Google has no category for is null, never a guess', () => {
    for (const invented of ['tuition centre', 'kids gym', 'robotics academy', 'enrichment centre']) {
      expect(canonicalPlaceCategory(invented)).toBeNull();
    }
    expect(canonicalPlaceCategory('')).toBeNull();
    expect(canonicalPlaceCategory(null)).toBeNull();
    expect(canonicalPlaceCategory(undefined)).toBeNull();
    expect(canonicalPlaceCategory(42)).toBeNull();
  });

  test('a plural fold never shadows a category that is itself plural', () => {
    // 'sports' and 'cars' are real enum values — depluralising them would send
    // 'sport'/'car', which the actor does not accept.
    expect(canonicalPlaceCategory('sports')).toBe('sports');
    expect(canonicalPlaceCategory('Cars')).toBe('cars');
  });
});

describe('resolvePlaceCategoryWords', () => {
  test('splits a list into what the actor takes and what it does not', () => {
    const { kept, dropped } = resolvePlaceCategoryWords([
      'Gymnastics center', 'kids gym', 'Sports school', '', null,
    ]);
    expect(kept).toEqual(['gymnastics center', 'sports school']);
    expect(dropped).toEqual(['kids gym']); // the operator's own spelling, to echo back
  });

  test('dedupes on the canonical value and preserves order', () => {
    const { kept } = resolvePlaceCategoryWords(['Cafe', 'cafe', ' CAFE ', 'Bakery']);
    expect(kept).toEqual(['cafe', 'bakery']);
  });

  test('non-array input is an empty result, not a throw', () => {
    expect(resolvePlaceCategoryWords(undefined)).toEqual({ kept: [], dropped: [] });
  });
});

describe('operator-facing help', () => {
  test('suggestions point at real categories', () => {
    const suggestions = suggestPlaceCategories('kids gym');
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) expect(GOOGLE_PLACE_CATEGORIES).toContain(s);
    expect(suggestPlaceCategories('gymnastics centre')).toContain('gymnastics center');
  });

  test('the message names every rejected word and offers real ones', () => {
    const msg = unknownCategoriesMessage(['kids gym']);
    expect(msg).toContain('"kids gym"');
    expect(msg).toMatch(/category:/);
    expect(msg).toMatch(/Closest real ones: "/);
    expect(unknownCategoriesMessage(['kids gym', 'tuition centre'])).toMatch(/categories:/);
  });
});
