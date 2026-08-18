import { describe, it, expect } from 'vitest';
import {
  commitDraftTransform,
  draftComplete,
  draftToDef,
  emptyCustomQuestionDraft,
  genCustomQuestionId,
  mutatePQ,
  nextOptionId,
  transformPQ,
} from '../profileQuestionsModel';
import { CUSTOM_QUESTION_ID_RE, MAX_CUSTOM_QUESTIONS } from '@/lib/designConfigV2';

/**
 * The one mutation door + draft lifecycle (studio-custom-questions §4).
 * Pure-function coverage; the panel wiring rides FormQuizPanels tests.
 */

const DEF_A = { id: 'c_aaa111', type: 'single', prompt: 'A?', options: [{ id: 'o1', label: 'x' }, { id: 'o2', label: 'y' }] };
const DEF_B = { id: 'c_bbb222', type: 'text', prompt: 'B?', options: [] };

const docWith = (pq) => ({ version: 2, profileQuestions: pq });

// A mut() stand-in that applies the draft mutation to a plain object and
// returns it (structuredClone semantics are useStudioDoc's job).
function apply(doc, fn) {
  let out;
  mutatePQ((mutFn) => {
    const d = JSON.parse(JSON.stringify(doc));
    mutFn(d);
    out = d;
  }, fn);
  return out.profileQuestions;
}

describe('transformPQ — decompose/reconstruct invariants', () => {
  it('is idempotent on reconciled state and preserves every component (the old master-toggle loss)', () => {
    const pq = {
      enabled: true,
      questionIds: ['language', 'c_aaa111'],
      requiredIds: ['c_aaa111'],
      showZh: false,
      custom: [DEF_A],
    };
    const out = transformPQ(docWith(pq), (s) => s);
    expect(out).toEqual(pq);
    // toggling enabled off keeps requiredIds/showZh/custom intact
    const off = transformPQ(docWith(pq), (s) => { s.enabled = false; return s; });
    expect(off).toEqual({ ...pq, enabled: false });
  });

  it('reconciles a hand-edited doc on first touch: defs missing from questionIds are appended, ghosts dropped, dupes deduped', () => {
    const messy = {
      enabled: true,
      questionIds: ['c_ghost9', 'c_aaa111', 'c_aaa111', 'language'],
      requiredIds: ['c_ghost9', 'language'],
      custom: [DEF_A, DEF_B], // B not referenced — must not be lost on touch
    };
    const out = transformPQ(docWith(messy), (s) => s);
    expect(out.questionIds).toEqual(['language', 'c_aaa111', 'c_bbb222']);
    expect(out.requiredIds).toEqual(['language']);
    expect(out.custom).toEqual([DEF_A, DEF_B]);
  });

  it('emits library picks in canonical order first, custom after, and omits custom when empty', () => {
    const out = transformPQ(docWith({ enabled: true, questionIds: ['pets', 'language'], requiredIds: [] }), (s) => s);
    expect(out.questionIds).toEqual(['language', 'pets']); // canonical library order
    expect('custom' in out).toBe(false);
  });

  it('back-to-back mutations compose (reorder after delete)', () => {
    const pq = { enabled: true, questionIds: ['c_aaa111', 'c_bbb222'], requiredIds: [], custom: [DEF_A, DEF_B] };
    const afterDelete = apply(docWith(pq), (s) => {
      s.defsById.delete('c_aaa111');
      s.customOrder = s.customOrder.filter((id) => id !== 'c_aaa111');
      s.requiredIds = s.requiredIds.filter((id) => id !== 'c_aaa111');
      return s;
    });
    expect(afterDelete.questionIds).toEqual(['c_bbb222']);
    expect(afterDelete.custom).toEqual([DEF_B]);
  });
});

describe('draft lifecycle', () => {
  it('a fresh draft is incomplete; completeness needs a sanitized prompt AND (select) 2 labelled options', () => {
    const draft = emptyCustomQuestionDraft();
    expect(draftComplete(draft)).toBe(false);
    expect(draftComplete({ ...draft, prompt: '  \u202E ' })).toBe(false); // control-only can never commit
    expect(draftComplete({ ...draft, prompt: 'Q?' })).toBe(false); // options unlabelled
    expect(draftComplete({ ...draft, prompt: 'Q?', options: [{ id: 'o1', label: 'a' }, { id: 'o2', label: ' ' }] })).toBe(false);
    expect(draftComplete({ ...draft, prompt: 'Q?', options: [{ id: 'o1', label: 'a' }, { id: 'o2', label: 'b' }] })).toBe(true);
    expect(draftComplete({ ...draft, type: 'text', prompt: 'Q?' })).toBe(true);
  });

  it('draftToDef writes SANITIZED values and drops unlabelled option rows', () => {
    const def = draftToDef({
      type: 'single',
      prompt: '  Which?  ',
      promptZh: ' ',
      options: [{ id: 'o1', label: ' A ' }, { id: 'o2', label: '' }, { id: 'o3', label: 'B' }],
    }, 'c_zzz999');
    expect(def).toEqual({
      id: 'c_zzz999',
      type: 'single',
      prompt: 'Which?',
      options: [{ id: 'o1', label: 'A' }, { id: 'o3', label: 'B' }],
    });
  });

  it('commitDraftTransform writes def + id atomically, flips enabled, and re-checks the cap as the belt', () => {
    const state = transformPQNoop({ enabled: false, questionIds: [], requiredIds: [] });
    const committed = commitDraftTransform(state, { type: 'text', prompt: 'Note?', promptZh: '', options: [] }, 'c_new001');
    expect(committed.customOrder).toEqual(['c_new001']);
    expect(committed.enabled).toBe(true);

    // At the cap, a sixth question can never enter the doc.
    const full = transformPQNoop({
      enabled: true,
      questionIds: ['c_q1', 'c_q2', 'c_q3', 'c_q4', 'c_q5'],
      requiredIds: [],
      custom: [1, 2, 3, 4, 5].map((n) => ({ id: `c_q${n}`, type: 'text', prompt: `Q${n}`, options: [] })),
    });
    expect(full.customOrder).toHaveLength(MAX_CUSTOM_QUESTIONS);
    const blocked = commitDraftTransform(full, { type: 'text', prompt: 'Sixth', promptZh: '', options: [] }, 'c_new006');
    expect(blocked.customOrder).toHaveLength(MAX_CUSTOM_QUESTIONS);
    expect(blocked.defsById.has('c_new006')).toBe(false);
  });
});

describe('id generation', () => {
  it('genCustomQuestionId matches the shared pattern and avoids collisions', () => {
    const existing = ['c_aaa111'];
    const seen = new Set(existing);
    for (let i = 0; i < 200; i += 1) {
      const id = genCustomQuestionId([...seen]);
      expect(CUSTOM_QUESTION_ID_RE.test(id)).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it('nextOptionId allocates the first unused oN', () => {
    expect(nextOptionId([])).toBe('o1');
    expect(nextOptionId([{ id: 'o1' }, { id: 'o3' }])).toBe('o2');
  });
});

// Decompose helper for tests that need a raw state object.
function transformPQNoop(pq) {
  let captured;
  transformPQ(docWith(pq), (s) => {
    captured = s;
    return s;
  });
  return captured;
}
