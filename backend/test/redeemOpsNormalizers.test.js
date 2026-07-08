/** Pure unit tests — no DB. docs/redeem-ops/ERD.md §5 normalization contract. */
import {
  normalizeBusinessName, normalizeDomain, normalizeHandle, normalizeUen,
  postalDistrictOf, deriveMatchingKeys,
} from '../src/services/redeemOps/normalizers.js';

describe('normalizeBusinessName', () => {
  test('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeBusinessName('  Nail   Bliss!  ')).toBe('nail bliss');
    expect(normalizeBusinessName('Café & Co.')).toBe('café co');
  });
  test('strips a single trailing legal suffix, never mid-name tokens', () => {
    expect(normalizeBusinessName('Nail Bliss Pte Ltd')).toBe('nail bliss');
    expect(normalizeBusinessName('Nail Bliss Pte. Ltd.')).toBe('nail bliss');
    expect(normalizeBusinessName('Nail Bliss Private Limited')).toBe('nail bliss');
    expect(normalizeBusinessName('Limited Edition Nails')).toBe('limited edition nails');
    expect(normalizeBusinessName('PL Grooming LLP')).toBe('pl grooming');
  });
  test('null-safe', () => {
    expect(normalizeBusinessName('')).toBeNull();
    expect(normalizeBusinessName(null)).toBeNull();
  });
});

describe('normalizeDomain', () => {
  test('strips scheme, www, path', () => {
    expect(normalizeDomain('https://www.nailbliss.sg/booking?x=1')).toBe('nailbliss.sg');
    expect(normalizeDomain('nailbliss.sg')).toBe('nailbliss.sg');
    expect(normalizeDomain('WWW.NailBliss.SG')).toBe('nailbliss.sg');
  });
  test('garbage → null', () => {
    expect(normalizeDomain('   ')).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });
});

describe('normalizeHandle', () => {
  test('accepts @handle, handle, and profile URLs', () => {
    expect(normalizeHandle('@NailBliss.sg')).toBe('nailbliss.sg');
    expect(normalizeHandle('nailbliss.sg')).toBe('nailbliss.sg');
    expect(normalizeHandle('https://instagram.com/NailBliss.sg')).toBe('nailbliss.sg');
    expect(normalizeHandle('instagram.com/nailbliss.sg/')).toBe('nailbliss.sg');
  });
  test('post/reel URLs do not become handles', () => {
    expect(normalizeHandle('https://instagram.com/p/Cxyz123')).toBeNull();
  });
});

describe('normalizeUen / postalDistrictOf', () => {
  test('uen uppercased alnum', () => {
    expect(normalizeUen(' 202507548m ')).toBe('202507548M');
    expect(normalizeUen(null)).toBeNull();
  });
  test('postal district = first 2 digits of a valid 6-digit code', () => {
    expect(postalDistrictOf('520123')).toBe('52');
    expect(postalDistrictOf('1234')).toBeNull();
  });
});

describe('deriveMatchingKeys', () => {
  test('derives all keys from display fields, preferring tradingName', () => {
    const keys = deriveMatchingKeys({
      tradingName: 'Nail Bliss Pte Ltd',
      legalName: 'NB Holdings Pte Ltd',
      uen: '202507548m',
      website: 'https://www.nailbliss.sg/x',
      instagramHandle: '@nailbliss.sg',
      tiktokHandle: null,
      facebookUrl: 'https://facebook.com/NailBlissSG',
    });
    expect(keys).toEqual({
      normalizedName: 'nail bliss',
      uen: '202507548M',
      websiteDomain: 'nailbliss.sg',
      instagramHandle: 'nailbliss.sg',
      tiktokHandle: null,
      facebookHandle: 'nailblisssg',
    });
  });
});
