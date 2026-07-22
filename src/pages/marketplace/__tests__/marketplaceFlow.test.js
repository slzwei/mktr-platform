import { describe, expect, test } from 'vitest';
import { flattenFieldOrder, isFieldVisible, isFieldRequired, dobToIso } from '../MarketplaceFlow';
import { offerUnavailability, winnersDrawnSentence } from '../content';
import { isTrackableLeadCapture } from '@/lib/pixelSuppression';

describe('winnersDrawnSentence — verb-agreed draw copy', () => {
  test('pluralizes by count and never prints "1 winners"', () => {
    expect(winnersDrawnSentence(1)).toBe('1 winner is drawn within seven days.');
    expect(winnersDrawnSentence(4)).toBe('4 winners are drawn within seven days.');
  });

  test('countless fallback capitalizes for sentence start, lowercases mid-sentence', () => {
    expect(winnersDrawnSentence(undefined)).toBe('Winners are drawn within seven days.');
    expect(winnersDrawnSentence(0)).toBe('Winners are drawn within seven days.');
    expect(winnersDrawnSentence(null, { capitalize: false })).toBe('winners are drawn within seven days.');
    expect(winnersDrawnSentence(4, { capitalize: false })).toBe('4 winners are drawn within seven days.');
  });
});

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

describe('field visibility/required — live-form parity (CampaignSignupForm submit validation)', () => {
  test('name/phone/email are always visible and required', () => {
    for (const f of ['name', 'phone', 'email']) {
      expect(isFieldVisible(f, { [f]: false })).toBe(true);
      expect(isFieldRequired(f, {})).toBe(true);
    }
  });

  test('dob/postal render unless hidden but are optional unless required===true', () => {
    for (const f of ['dob', 'postal_code']) {
      expect(isFieldVisible(f, {})).toBe(true);
      expect(isFieldVisible(f, { [f]: false })).toBe(false);
      expect(isFieldRequired(f, {})).toBe(false);
      expect(isFieldRequired(f, { [f]: 'optional' })).toBe(false);
      expect(isFieldRequired(f, { [f]: true })).toBe(true);
    }
  });

  test('education/income are opt-IN visible (an empty config never shows them)', () => {
    for (const f of ['education_level', 'monthly_income']) {
      expect(isFieldVisible(f, {})).toBe(false);
      expect(isFieldVisible(f, { [f]: true })).toBe(true);
      expect(isFieldRequired(f, {})).toBe(false);
    }
  });

  test('marketplace extras (child/prefs) are opt-in on both axes', () => {
    expect(isFieldVisible('child_name', {})).toBe(false);
    expect(isFieldVisible('child_name', { child_name: true })).toBe(true);
    expect(isFieldRequired('child_name', { child_name: true })).toBe(true);
  });
});

describe('dobToIso — API contract is YYYY-MM-DD', () => {
  test('converts the display mask; passes empties/partials through as empty', () => {
    expect(dobToIso('14/03/1988')).toBe('1988-03-14');
    expect(dobToIso('')).toBe('');
    expect(dobToIso('14/03')).toBe('');
  });
});

describe('offerUnavailability — the flow must refuse what the pipeline cannot service', () => {
  const base = (over = {}) => ({
    design_config: {},
    ops: { capacity: { total: 40, remaining: 10 } },
    ...over,
  });

  test('serviceable offer → null', () => {
    expect(offerUnavailability(base())).toBeNull();
  });

  test('null ops / sold out / zero-allocation are unavailable', () => {
    expect(offerUnavailability(base({ ops: null }))).toBe('unserviceable');
    expect(offerUnavailability(base({ ops: { capacity: { total: 10, remaining: 0 } } }))).toBe('sold_out');
    expect(offerUnavailability(base({ ops: { capacity: { total: 0, remaining: 0 } } }))).toBe('sold_out');
  });

  test('draws past their SGT cutoff are closed even with capacity left', () => {
    const past = { design_config: { luckyDraw: { enabled: true, closesAt: '2026-07-01' } }, ops: { capacity: { total: 100, remaining: 50 } } };
    expect(offerUnavailability(past, new Date('2026-07-14T00:00:00Z'))).toBe('draw_closed');
    expect(offerUnavailability(past, new Date('2026-07-01T10:00:00Z'))).toBeNull();
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
