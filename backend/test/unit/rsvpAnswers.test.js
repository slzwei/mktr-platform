/**
 * RSVP submission validation (docs/plans/rsvp-pages.md §5.4) — the dynamic Joi
 * built from an event's own field defs, the closesAt contract, and the
 * attribution whitelist. Pure util, no database.
 */
import {
  buildSubmissionSchema, buildAnswersSchema, sanitizeAnswers, parseClosesAt, pickSourceMetadata,
  RSVP_BODY_MAX_BYTES, SOURCE_UTM_KEYS,
} from '../../src/utils/rsvpAnswers.js';
import { LIMITS } from '../../src/utils/rsvpLayout.js';

const FIELDS = [
  { key: 'name', type: 'text', required: true, locked: true },
  { key: 'email', type: 'email', required: true, locked: true },
  { key: 'phone', type: 'phone', required: false },
  { key: 'f_diet', type: 'select', required: true, options: ['Veg', 'Halal'] },
  { key: 'f_days', type: 'multiselect', required: false, options: ['Sat', 'Sun'] },
  { key: 'f_ok', type: 'checkbox', required: true },
  { key: 'f_note', type: 'textarea', required: false },
  { key: 'f_pax', type: 'number', required: false },
  { key: 'f_when', type: 'date', required: false },
];

const GOOD = {
  answers: { name: 'Alice', email: 'alice@example.com', phone: '9123 4567', f_diet: 'Veg', f_days: ['Sat'], f_ok: true, f_note: 'hi', f_pax: 2, f_when: '2026-10-04' },
  consent: true,
};

const check = (body, fields = FIELDS) => buildSubmissionSchema(fields).validate(body, { abortEarly: false });
const fails = (body, re) => {
  const { error } = check(body);
  expect(error).toBeDefined();
  if (re) expect(error.message).toMatch(re);
};
const withAnswers = (patch) => ({ ...GOOD, answers: { ...GOOD.answers, ...patch } });

describe('buildSubmissionSchema', () => {
  test('a complete submission validates', () => {
    const { error, value } = check(GOOD);
    expect(error).toBeUndefined();
    expect(value.answers.f_days).toEqual(['Sat']);
  });

  test('exactly the event\'s keys: unknown answer keys and unknown top-level keys are rejected', () => {
    fails(withAnswers({ f_ghost: 'x' }), /f_ghost/);
    fails({ ...GOOD, consentVersion: 'client-says-so' }, /consentVersion/);
    fails({ ...GOOD, consentCopyHash: 'abc' }, /consentCopyHash/);
  });

  test('the consent tick is required and must be boolean true', () => {
    fails({ answers: GOOD.answers }, /consent/);
    fails({ ...GOOD, consent: false }, /consent/);
    fails({ ...GOOD, consent: 'true' }, /consent/);
  });

  test('required fields cannot be empty; optional ones may be', () => {
    fails(withAnswers({ name: '' }), /name/);
    fails(withAnswers({ f_diet: undefined }), /f_diet/);
    expect(check(withAnswers({ phone: '', f_note: '', f_pax: null, f_when: '' })).error).toBeUndefined();
    expect(check(withAnswers({ f_days: [] })).error).toBeUndefined();
  });

  test('select / multiselect are option membership only, unique and capped', () => {
    fails(withAnswers({ f_diet: 'Beef' }), /f_diet/);
    fails(withAnswers({ f_days: ['Sat', 'Sat'] }), /f_days/);
    fails(withAnswers({ f_days: ['Mon'] }), /f_days/);
    fails(withAnswers({ f_days: 'Sat' }), /f_days/);
    const many = [{ key: 'name', type: 'text', required: true }, { key: 'email', type: 'email', required: true },
      { key: 'f_m', type: 'multiselect', required: true, options: Array.from({ length: 20 }, (_, i) => `o${i}`) }];
    const { error } = check({ answers: { name: 'a', email: 'a@b.co', f_m: Array.from({ length: LIMITS.multiselectMax + 1 }, (_, i) => `o${i}`) }, consent: true }, many);
    expect(error).toBeDefined();
  });

  test('dates are strict calendar days', () => {
    fails(withAnswers({ f_when: '2026-02-31' }), /f_when/);
    fails(withAnswers({ f_when: '31/12/2026' }), /f_when/);
    fails(withAnswers({ f_when: '2026-10-04T10:00' }), /f_when/);
    expect(check(withAnswers({ f_when: '2026-02-28' })).error).toBeUndefined();
  });

  test('numbers are finite and bounded; checkboxes are strict booleans', () => {
    fails(withAnswers({ f_pax: LIMITS.numberAbs + 1 }), /f_pax/);
    fails(withAnswers({ f_pax: 'two' }), /f_pax/);
    fails(withAnswers({ f_pax: Infinity }), /f_pax/);
    fails(withAnswers({ f_ok: 'true' }), /f_ok/);
    fails(withAnswers({ f_ok: false }), /f_ok/);
  });

  test('strings are capped per type; emails and phones are shaped', () => {
    fails(withAnswers({ name: 'x'.repeat(LIMITS.answerShort + 1) }), /name/);
    fails(withAnswers({ f_note: 'x'.repeat(LIMITS.answerLong + 1) }), /f_note/);
    expect(check(withAnswers({ f_note: 'x'.repeat(LIMITS.answerLong) })).error).toBeUndefined();
    fails(withAnswers({ email: 'not-an-email' }), /email/);
    fails(withAnswers({ phone: 'call me' }), /phone/);
    expect(check(withAnswers({ phone: '+65 9123-4567' })).error).toBeUndefined();
  });

  test('nested objects are never answers', () => {
    fails(withAnswers({ f_note: { $gt: '' } }), /f_note/);
    fails(withAnswers({ name: ['Alice'] }), /name/);
  });

  test('honeypot and whitelisted attribution are accepted; junk attribution is not', () => {
    expect(check({ ...GOOD, website: '' }).error).toBeUndefined();
    expect(check({ ...GOOD, website: 'http://spam.example' }).error).toBeUndefined();
    expect(check({ ...GOOD, source: { utm_source: 'ig', referrer: 'https://redeem.sg/x' } }).error).toBeUndefined();
    fails({ ...GOOD, source: { fbclid: 'x' } }, /fbclid/);
    fails({ ...GOOD, source: { utm_source: 'x'.repeat(101) } }, /utm_source/);
  });

  test('buildAnswersSchema on no fields accepts only an empty object', () => {
    expect(buildAnswersSchema([]).validate({}).error).toBeUndefined();
    expect(buildAnswersSchema([]).validate({ name: 'x' }).error).toBeDefined();
  });

  test('the public body ceiling is small', () => {
    expect(RSVP_BODY_MAX_BYTES).toBe(32 * 1024);
    expect(SOURCE_UTM_KEYS).toEqual(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']);
  });
});

describe('sanitizeAnswers', () => {
  test('strips control/bidi characters from free text, leaves option values alone, drops unknown keys', () => {
    const out = sanitizeAnswers(FIELDS, { name: 'Ali ce\u202E', f_diet: 'Veg', f_days: ['Sat', 7], f_ok: true, f_pax: 2, f_ghost: 'x' });
    expect(out).toEqual({ name: 'Ali ce', f_diet: 'Veg', f_days: ['Sat'], f_ok: true, f_pax: 2 });
  });
});

describe('parseClosesAt', () => {
  test('null/empty clears; junk is undefined; wall time anchors to SGT; offsets are honoured', () => {
    expect(parseClosesAt(null)).toBeNull();
    expect(parseClosesAt('')).toBeNull();
    expect(parseClosesAt(undefined)).toBeNull();
    expect(parseClosesAt('tomorrow')).toBeUndefined();
    expect(parseClosesAt('2026-10-04')).toBeUndefined();
    expect(parseClosesAt(42)).toBeUndefined();
    expect(parseClosesAt('2026-10-04T14:00').toISOString()).toBe('2026-10-04T06:00:00.000Z');
    expect(parseClosesAt('2026-10-04T14:00:30').toISOString()).toBe('2026-10-04T06:00:30.000Z');
    expect(parseClosesAt('2026-10-04T14:00:00Z').toISOString()).toBe('2026-10-04T14:00:00.000Z');
    expect(parseClosesAt('2026-10-04T14:00:00+02:00').toISOString()).toBe('2026-10-04T12:00:00.000Z');
    expect(parseClosesAt('2026-02-31T10:00')).toBeUndefined();
  });
});

describe('pickSourceMetadata', () => {
  test('keeps whitelisted UTM keys and referrer origin+path only', () => {
    const out = pickSourceMetadata(
      { utm_source: ' ig ', utm_medium: 'story', fbclid: 'secret', referrer: 'https://redeem.sg/offers/x?token=abc#frag' },
      'https://ignored.example/hdr'
    );
    expect(out).toEqual({ utm_source: 'ig', utm_medium: 'story', referrer: 'https://redeem.sg/offers/x' });
  });

  test('falls back to the header referrer, rejects non-http schemes, tolerates nothing', () => {
    expect(pickSourceMetadata(undefined, 'https://t.co/abc?x=1')).toEqual({ referrer: 'https://t.co/abc' });
    expect(pickSourceMetadata({ referrer: 'javascript:alert(1)' }, undefined)).toEqual({});
    expect(pickSourceMetadata(null, null)).toEqual({});
  });
});
