import { describe, it, expect } from 'vitest';
import {
  parseSgPlate,
  isValidSgPlate,
  formatSgPhone,
  isValidSgMobile,
  LETTERS_NO_IO,
  SERIES_SECOND_LETTERS,
  ALLOWED_PLATE_PREFIXES,
} from '../validation';

describe('parseSgPlate', () => {
  it('uppercases and strips non-alphanumeric chars', () => {
    expect(parseSgPlate('sba 1234a')).toBe('SBA1234A');
  });

  it('handles plate with dashes', () => {
    expect(parseSgPlate('SBA-1234-A')).toBe('SBA1234A');
  });

  it('handles already-clean input', () => {
    expect(parseSgPlate('SBA1234A')).toBe('SBA1234A');
  });

  it('returns empty string for null', () => {
    expect(parseSgPlate(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(parseSgPlate(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(parseSgPlate('')).toBe('');
  });

  it('strips special characters like dots and slashes', () => {
    expect(parseSgPlate('S.B.A/1234/A')).toBe('SBA1234A');
  });
});

describe('isValidSgPlate', () => {
  it('accepts valid S-series plate SBA1234A', () => {
    expect(isValidSgPlate('SBA1234A')).toBe(true);
  });

  it('accepts valid S-series plate with 1 digit', () => {
    expect(isValidSgPlate('SBA1A')).toBe(true);
  });

  it('accepts valid S-series plate with 2 digits', () => {
    expect(isValidSgPlate('SBA12A')).toBe(true);
  });

  it('accepts valid S-series plate with 3 digits', () => {
    expect(isValidSgPlate('SBA123A')).toBe(true);
  });

  it('accepts valid E-series plate EA1234B', () => {
    expect(isValidSgPlate('EA1234B')).toBe(true);
  });

  it('accepts lowercase input', () => {
    expect(isValidSgPlate('sba1234a')).toBe(true);
  });

  it('rejects plate with no digits', () => {
    expect(isValidSgPlate('SBAA')).toBe(false);
  });

  it('rejects plate with 5 digits', () => {
    expect(isValidSgPlate('SBA12345A')).toBe(false);
  });

  it('rejects plate with no trailing letter', () => {
    expect(isValidSgPlate('SBA1234')).toBe(false);
  });

  it('rejects invalid prefix starting with X', () => {
    expect(isValidSgPlate('XA1234A')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidSgPlate('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidSgPlate(null)).toBe(false);
  });

  it('rejects S-series with invalid second letter (SA)', () => {
    // SA is not in SERIES_SECOND_LETTERS
    expect(isValidSgPlate('SAA1234A')).toBe(false);
  });
});

describe('formatSgPhone', () => {
  it('formats bare 8-digit mobile number starting with 8', () => {
    expect(formatSgPhone('81234567')).toBe('+6581234567');
  });

  it('formats bare 8-digit mobile number starting with 9', () => {
    expect(formatSgPhone('91234567')).toBe('+6591234567');
  });

  it('formats number starting with 6 (landline)', () => {
    expect(formatSgPhone('61234567')).toBe('+6561234567');
  });

  it('formats number starting with 3', () => {
    expect(formatSgPhone('31234567')).toBe('+6531234567');
  });

  it('returns null when input includes +65 prefix (10 digits after stripping)', () => {
    // formatSgPhone strips all non-digits, so +6581234567 becomes 6581234567 (10 digits)
    // which does not match the 8-digit pattern — returns null
    expect(formatSgPhone('+6581234567')).toBeNull();
  });

  it('returns null when input includes 65 prefix without plus (10 digits)', () => {
    expect(formatSgPhone('6581234567')).toBeNull();
  });

  it('strips spaces from input', () => {
    expect(formatSgPhone('8123 4567')).toBe('+6581234567');
  });

  it('returns null for invalid prefix (starts with 1)', () => {
    expect(formatSgPhone('11234567')).toBeNull();
  });

  it('returns null for too-short number', () => {
    expect(formatSgPhone('8123')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(formatSgPhone('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(formatSgPhone(null)).toBeNull();
  });
});

describe('isValidSgMobile', () => {
  it('accepts valid mobile starting with 8', () => {
    expect(isValidSgMobile('81234567')).toBe(true);
  });

  it('accepts valid mobile starting with 9', () => {
    expect(isValidSgMobile('91234567')).toBe(true);
  });

  it('accepts number starting with 6', () => {
    expect(isValidSgMobile('61234567')).toBe(true);
  });

  it('accepts number starting with 3', () => {
    expect(isValidSgMobile('31234567')).toBe(true);
  });

  it('rejects number starting with 1', () => {
    expect(isValidSgMobile('11234567')).toBe(false);
  });

  it('rejects number with wrong length', () => {
    expect(isValidSgMobile('812345')).toBe(false);
  });

  it('rejects number with country code included', () => {
    expect(isValidSgMobile('+6581234567')).toBe(false);
  });
});

describe('constants', () => {
  it('LETTERS_NO_IO excludes I and O', () => {
    expect(LETTERS_NO_IO).not.toContain('I');
    expect(LETTERS_NO_IO).not.toContain('O');
    expect(LETTERS_NO_IO).toHaveLength(24);
  });

  it('SERIES_SECOND_LETTERS contains expected letters', () => {
    expect(SERIES_SECOND_LETTERS).toContain('B');
    expect(SERIES_SECOND_LETTERS).toContain('N');
    expect(SERIES_SECOND_LETTERS).not.toContain('A');
  });

  it('ALLOWED_PLATE_PREFIXES includes E-series and S-series', () => {
    expect(ALLOWED_PLATE_PREFIXES.has('EA')).toBe(true);
    expect(ALLOWED_PLATE_PREFIXES.has('EZ')).toBe(true);
    expect(ALLOWED_PLATE_PREFIXES.has('SBA')).toBe(true);
    expect(ALLOWED_PLATE_PREFIXES.has('SNA')).toBe(true);
  });
});
