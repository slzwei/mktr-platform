/**
 * rsvpLayout twin LOCK-STEP — imports BOTH the backend source of truth and the
 * frontend mirror; fails the build if they diverge (the designConfigV2 lockstep
 * pattern: constants structurally, functions behaviourally over a fixture corpus).
 */
import { describe, it, expect } from 'vitest';

import * as mirror from '../rsvpLayout.js';
import * as backend from '../../../backend/src/utils/rsvpLayout.js';

const CONSTANT_EXPORTS = [
  'RSVP_LAYOUT_VERSION', 'BLOCK_TYPES', 'FIELD_TYPES', 'OPTION_FIELD_TYPES',
  'LOCKED_FIELD_KEYS', 'BUILTIN_FIELD_TYPES', 'CUSTOM_FIELD_KEY_RE', 'BLOCK_ID_RE',
  'RSVP_SLUG_RE', 'RESERVED_ROOT_SLUGS', 'LIMITS', 'DEFAULT_PRESET_ID',
  'DEFAULT_SUBMIT_LABEL', 'DEFAULT_CONFIRMATION_HEADLINE',
];

const FUNCTION_EXPORTS = [
  'sanitizeText', 'sanitizeMultiline', 'defaultLayout', 'clampLayout', 'publicLayout', 'layoutProblems',
  'isValidRsvpSlug', 'slugProblem',
];

/** Raw documents spanning garbage, partial, over-cap, hostile and unicode input. */
const CORPUS = {
  nothing: undefined,
  junk: 'not a doc',
  empty: {},
  sparse: { theme: { preset: 'kopi', accent: '#123456' }, blocks: [{ type: 'text', body: 'Hello' }] },
  overCap: {
    blocks: [...Array.from({ length: 20 }, (_, i) => ({ id: `b_x${i}`, type: 'text', body: `t${i}` })), { id: 'b_form', type: 'form', headline: 'Go' }],
    fields: [{ key: 'name' }, ...Array.from({ length: 30 }, (_, i) => ({ key: `f_q${String(i).padStart(4, '0')}`, type: 'select', options: ['a', 'b', 'a'] }))],
  },
  hostile: {
    internal: { activationId: 'x' },
    blocks: [{ id: 'BAD', type: 'hero', headline: 'Hi\u202E', mediaUrl: 'javascript:1' }, { id: 'b_same', type: 'image', url: 'https://ok.example/a.png' }, { id: 'b_same', type: 'form' }],
    fields: [{ key: 'email', type: 'checkbox', required: false }, { key: 'foo' }, { key: 'f_ok01', type: 'multiselect', options: [1, 'x', 'x', ' y '] }, { key: 'phone', type: 'text' }],
    confirmation: { headline: '', body: 'b'.repeat(2000), emailEnabled: false },
  },
  paragraphs: { blocks: [{ id: 'b_txt1', type: 'text', body: 'One.\r\n\r\nTwo.\n\u0007Three.' }, { type: 'form' }], confirmation: { body: 'A\n\nB' } },
  unicode: { blocks: [{ id: 'b_h', type: 'hero', headline: '欢迎 — RSVP 🎉', subheadline: 'كل شيء' }, { type: 'form' }], fields: [{ key: 'f_zh01', type: 'text', label: '姓名' }] },
};

const FROZEN = backend.clampLayout({
  fields: [{ key: 'name' }, { key: 'email' }, { key: 'f_diet', type: 'select', options: ['Veg', 'Halal'] }, { key: 'f_note', type: 'textarea' }],
}).fields;

const FROZEN_EDITS = {
  retype: { fields: [{ key: 'name' }, { key: 'email' }, { key: 'f_diet', type: 'checkbox', options: ['X'] }] },
  drop: { fields: [{ key: 'name' }, { key: 'email' }] },
  add: { fields: [{ key: 'name' }, { key: 'email' }, { key: 'f_note', label: 'Renamed', required: true }, { key: 'f_new1', type: 'date' }] },
  atCap: { fields: [{ key: 'name' }, { key: 'email' }, ...Array.from({ length: 18 }, (_, i) => ({ key: `f_c${String(i).padStart(4, '0')}`, type: 'text' }))] },
};

describe('rsvpLayout twins — constant drift', () => {
  it('exports the same surface', () => {
    for (const name of [...CONSTANT_EXPORTS, ...FUNCTION_EXPORTS]) {
      expect(mirror[name], `mirror missing ${name}`).toBeDefined();
      expect(backend[name], `backend missing ${name}`).toBeDefined();
    }
  });

  it.each(CONSTANT_EXPORTS)('constant %s is structurally identical', (name) => {
    expect(mirror[name]).toEqual(backend[name]);
  });
});

describe('rsvpLayout twins — behavioural parity', () => {
  it('defaultLayout agrees and is a clamp fixed point', () => {
    const b = backend.defaultLayout();
    expect(mirror.defaultLayout()).toEqual(b);
    expect(mirror.clampLayout(b)).toEqual(b);
    expect(backend.clampLayout(b)).toEqual(b);
  });

  for (const [name, doc] of Object.entries(CORPUS)) {
    it(`clamp / public / problems agree for fixture "${name}"`, () => {
      const b = backend.clampLayout(doc);
      expect(mirror.clampLayout(doc)).toEqual(b);
      expect(mirror.publicLayout(b)).toEqual(backend.publicLayout(b));
      expect(mirror.layoutProblems(b)).toEqual(backend.layoutProblems(b));
      // Idempotence holds on both sides.
      expect(mirror.clampLayout(b)).toEqual(b);
    });
  }

  for (const [name, raw] of Object.entries(FROZEN_EDITS)) {
    it(`frozen-field clamp agrees for edit "${name}"`, () => {
      expect(mirror.clampLayout(raw, { frozen: FROZEN })).toEqual(backend.clampLayout(raw, { frozen: FROZEN }));
    });
  }

  it('slug helpers agree', () => {
    for (const s of ['launch-2026', 'api', 'Bad', 'ab', 'a'.repeat(41), '', null, undefined, 'x.y']) {
      expect(mirror.slugProblem(s)).toBe(backend.slugProblem(s));
      expect(mirror.isValidRsvpSlug(s)).toBe(backend.isValidRsvpSlug(s));
    }
  });

  it('sanitizeMultiline agrees and keeps newlines', () => {
    const s = 'One.\r\n\r\nTwo.\u0007\u202E';
    expect(mirror.sanitizeMultiline(s, 100)).toBe(backend.sanitizeMultiline(s, 100));
    expect(backend.sanitizeMultiline(s, 100)).toBe('One.\n\nTwo.');
  });

  it('sanitizeText agrees on hostile input', () => {
    const s = '  A b\u202Ec\u2066d  ';
    expect(mirror.sanitizeText(s, 3)).toBe(backend.sanitizeText(s, 3));
  });
});
