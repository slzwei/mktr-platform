import { describe, expect, test } from 'vitest';
import { flattenFieldOrder } from '../MarketplaceFlow';
import { isTrackableLeadCapture } from '@/lib/pixelSuppression';

describe('flattenFieldOrder — both production fieldOrder shapes', () => {
  test('legacy flat string[] passes through', () => {
    expect(flattenFieldOrder(['name', 'phone', 'email'])).toEqual(['name', 'phone', 'email']);
  });

  test('designer row objects {id, columns[]} flatten in order (multi-column rows included)', () => {
    expect(
      flattenFieldOrder([
        { id: 'r1', columns: ['name'] },
        { id: 'r2', columns: ['phone', 'email'] },
        { id: 'r3', columns: ['dob'] },
      ])
    ).toEqual(['name', 'phone', 'email', 'dob']);
  });

  test('missing/empty config falls back to the full production field set', () => {
    const fallback = ['name', 'phone', 'email', 'dob', 'postal_code', 'education_level', 'monthly_income'];
    expect(flattenFieldOrder(undefined)).toEqual(fallback);
    expect(flattenFieldOrder([])).toEqual(fallback);
  });

  test('junk entries are ignored', () => {
    expect(flattenFieldOrder([{ id: 'x' }, 42, { columns: ['email', 7] }])).toEqual(['email']);
  });
});

describe('pixel suppression — marketplace routes', () => {
  test('offer detail and flow are trackable; browse and reward pass stay suppressed', () => {
    expect(isTrackableLeadCapture({ pathname: '/offers/visual-arts-discovery' })).toBe(true);
    expect(isTrackableLeadCapture({ pathname: '/flow/visual-arts-discovery' })).toBe(true);
    expect(isTrackableLeadCapture({ pathname: '/LeadCapture' })).toBe(true);
    expect(isTrackableLeadCapture({ pathname: '/explore' })).toBe(false);
    expect(isTrackableLeadCapture({ pathname: '/' })).toBe(false);
    expect(isTrackableLeadCapture({ pathname: '/r/some-token' })).toBe(false);
    expect(isTrackableLeadCapture({ pathname: '/offers/' })).toBe(false);
    expect(isTrackableLeadCapture({ pathname: '/offers/x/edit' })).toBe(false);
  });

  test('preview + test-data suppressions still apply on marketplace routes', () => {
    expect(isTrackableLeadCapture({ pathname: '/offers/some-offer', search: '?preview=true' })).toBe(false);
    expect(isTrackableLeadCapture({ pathname: '/flow/some-offer', campaign: { is_test_data: true } })).toBe(false);
  });
});
