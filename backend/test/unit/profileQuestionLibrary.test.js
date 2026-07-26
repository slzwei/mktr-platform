import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  PROFILE_QUESTION_LIBRARY, PROFILE_QUESTION_IDS, MAX_PROFILE_QUESTIONS,
  getProfileQuestion, resolveAnswer,
} from '../../src/utils/profileQuestionLibrary.js';
import { validateFact, FACT_KEYS } from '../../src/utils/factTaxonomy.js';
import { clampDesignConfigV2 } from '../../src/utils/designConfigV2Clamp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Profile question library (studio-profile-questions §2) — twin byte
 * parity, server-side answer resolution, and the clamp's subtree
 * sanitizer (§3).
 */
describe('profileQuestionLibrary', () => {
  test('TWIN PARITY: backend and frontend copies are byte-identical', () => {
    const backend = readFileSync(path.join(__dirname, '../../src/utils/profileQuestionLibrary.js'), 'utf8');
    const frontend = readFileSync(path.join(__dirname, '../../../src/lib/profileQuestionLibrary.js'), 'utf8');
    expect(backend).toBe(frontend);
  });

  test('every question maps to a real taxonomy key; ids unique; cap honest', () => {
    expect(PROFILE_QUESTION_IDS).toHaveLength(new Set(PROFILE_QUESTION_IDS).size);
    expect(PROFILE_QUESTION_LIBRARY.length).toBeLessThanOrEqual(MAX_PROFILE_QUESTIONS);
    for (const q of PROFILE_QUESTION_LIBRARY) {
      expect(FACT_KEYS[q.factKey]).toBeDefined();
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.options).toHaveLength(new Set(q.options.map((o) => o.id)).size);
    }
  });

  test('every resolvable answer round-trips validateFact', () => {
    for (const q of PROFILE_QUESTION_LIBRARY) {
      for (const opt of q.options) {
        const value = resolveAnswer(q.id, q.multi ? [opt.id] : opt.id);
        expect(value).not.toBeNull();
        expect(validateFact(q.factKey, value)).toEqual({ ok: true });
      }
    }
  });

  test('single-select shapes: wrong shape, unknown option, unknown question → null', () => {
    expect(resolveAnswer('language', 'en')).toEqual({ v: 'en' });
    expect(resolveAnswer('language', ['en'])).toBeNull();
    expect(resolveAnswer('language', 'fr')).toBeNull();
    expect(resolveAnswer('star_sign', 'leo')).toBeNull();
    expect(resolveAnswer('children', 'three_plus')).toEqual({ v: '3_plus' });
  });

  test('pets multi: server composes the complete canonical collection', () => {
    expect(resolveAnswer('pets', ['cat', 'dog'])).toEqual({ v: ['cat', 'dog'], complete: true });
    expect(resolveAnswer('pets', ['dog', 'cat'])).toEqual({ v: ['cat', 'dog'], complete: true }); // canonical order
    expect(resolveAnswer('pets', ['none'])).toEqual({ v: [], complete: true });
  });

  test('pets multi: none is EXCLUSIVE; dupes and strings rejected', () => {
    expect(resolveAnswer('pets', ['none', 'dog'])).toBeNull();
    expect(resolveAnswer('pets', ['dog', 'dog'])).toBeNull();
    expect(resolveAnswer('pets', 'dog')).toBeNull();
    expect(resolveAnswer('pets', [])).toBeNull();
    expect(resolveAnswer('pets', ['dragon'])).toBeNull();
  });

  test('getProfileQuestion lookup', () => {
    expect(getProfileQuestion('pets')?.multi).toBe(true);
    expect(getProfileQuestion('nope')).toBeNull();
  });
});

describe('clampDesignConfigV2 — profileQuestions subtree (§3)', () => {
  const base = { version: 2, template: { id: 'express' }, theme: {}, content: {}, form: {} };
  const clamp = (pq) => clampDesignConfigV2({ ...base, profileQuestions: pq }, undefined, 'admin').profileQuestions;

  test('unknown ids dropped, order preserved, deduped, capped', () => {
    expect(clamp({ enabled: true, questionIds: ['pets', 'bogus', 'language', 'pets'] }))
      .toEqual({ enabled: true, questionIds: ['pets', 'language'] });
  });

  test('enabled with zero valid ids clamps to disabled', () => {
    expect(clamp({ enabled: true, questionIds: ['bogus'] }))
      .toEqual({ enabled: false, questionIds: [] });
    expect(clamp({ enabled: true })).toEqual({ enabled: false, questionIds: [] });
  });

  test('garbage shapes sanitize to disabled; absent stays absent (upgrade preservation)', () => {
    expect(clamp('yes please')).toEqual({ enabled: false, questionIds: [] });
    expect(clamp([1, 2])).toEqual({ enabled: false, questionIds: [] });
    const out = clampDesignConfigV2(base, undefined, 'admin');
    expect(out.profileQuestions).toBeUndefined();
  });

  test('raw unknown-passthrough can never overwrite the sanitized value', () => {
    const out = clampDesignConfigV2(
      { ...base, profileQuestions: { enabled: true, questionIds: ['language'], smuggled: 'x' } },
      undefined,
      'admin'
    );
    expect(out.profileQuestions).toEqual({ enabled: true, questionIds: ['language'] });
  });
});
