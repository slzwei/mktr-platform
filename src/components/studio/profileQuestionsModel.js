import {
  CUSTOM_QUESTION_ID_RE,
  LIMITS,
  MAX_CUSTOM_OPTIONS,
  MAX_CUSTOM_QUESTIONS,
  sanitizeQuestionText,
} from '@/lib/designConfigV2';
import { PROFILE_QUESTION_IDS } from '@/lib/profileQuestionLibrary';

/**
 * The ONE mutation door for the profileQuestions subtree
 * (studio-custom-questions §4, Codex R1 #2 / R2 #4).
 *
 * Every FormPanel mutation used to rebuild the subtree by hand and each site
 * was lossy in its own way (the master toggle dropped requiredIds/showZh; the
 * library tick and brief-suggestion rebuilds would have deleted custom state).
 * All writes now decompose → transform → reconstruct through here.
 *
 * `transformPQ` is the PURE core: it also serves the guard's
 * "Save & continue" path, which must derive the post-commit doc SYNCHRONOUSLY
 * and hand the same object to setDoc and save (§4 snapshot rule) — a mut()-only
 * API cannot do that.
 *
 * Read-side reconciliation (R2 new #4): customOrder = questionIds ∩ defs,
 * deduped, with defs never referenced appended at the end — a hand-edited doc
 * must not lose data on its first touch. Reconstruction emits defs ONLY for
 * ordered ids, requiredIds filtered to membership, library picks in canonical
 * library order first, custom after. Idempotent on reconciled state.
 */
export function transformPQ(doc, fn) {
  const cur = doc?.profileQuestions && typeof doc.profileQuestions === 'object'
    ? doc.profileQuestions
    : {};
  const defsIn = (Array.isArray(cur.custom) ? cur.custom : [])
    .filter((q) => q && typeof q === 'object' && typeof q.id === 'string');
  const defsById = new Map(defsIn.map((q) => [q.id, q]));
  const idsIn = Array.isArray(cur.questionIds) ? cur.questionIds : [];
  const customOrder = [];
  for (const id of idsIn) {
    if (defsById.has(id) && !customOrder.includes(id)) customOrder.push(id);
  }
  for (const q of defsIn) {
    if (!customOrder.includes(q.id)) customOrder.push(q.id);
  }
  const state = {
    enabled: cur.enabled === true,
    libraryPicks: idsIn.filter((id) => PROFILE_QUESTION_IDS.includes(id)),
    defsById,
    customOrder,
    requiredIds: Array.isArray(cur.requiredIds) ? [...cur.requiredIds] : [],
    showZh: cur.showZh !== false,
  };
  const next = fn(state) || state;
  const libraryIds = PROFILE_QUESTION_IDS.filter((id) => next.libraryPicks.includes(id));
  const orderedCustom = next.customOrder.filter(
    (id, i) => next.defsById.has(id) && next.customOrder.indexOf(id) === i
  );
  const questionIds = [...libraryIds, ...orderedCustom];
  return {
    enabled: next.enabled === true,
    questionIds,
    requiredIds: next.requiredIds.filter(
      (id, i) => questionIds.includes(id) && next.requiredIds.indexOf(id) === i
    ),
    showZh: next.showZh !== false,
    ...(orderedCustom.length
      ? { custom: orderedCustom.map((id) => next.defsById.get(id)) }
      : {}),
  };
}

/** The mut()-flavored wrapper every FormPanel mutation site uses. */
export function mutatePQ(mut, fn) {
  mut((d) => {
    d.profileQuestions = transformPQ(d, fn);
  });
}

// ─────────────────────────── draft lifecycle (§4) ───────────────────────────

/** A NEW question lives as an editor-local draft (owned by the Studio PAGE,
 * not the panel — the rail unmounts inactive panels) until minimally
 * complete; only the commit writes the doc. */
export function emptyCustomQuestionDraft() {
  return {
    type: 'single',
    prompt: '',
    promptZh: '',
    options: [
      { id: 'o1', label: '' },
      { id: 'o2', label: '' },
    ],
  };
}

/** Completeness uses the SERVER'S OWN sanitizer (Codex R2 closure #4) — a
 * value sanitizeQuestionText empties (whitespace, control chars) can never
 * commit, then vanish in the clamp. */
export function draftComplete(draft) {
  if (!draft || typeof draft !== 'object') return false;
  if (!sanitizeQuestionText(draft.prompt, LIMITS.cqPrompt)) return false;
  if (draft.type === 'text') return true;
  const labeled = (Array.isArray(draft.options) ? draft.options : [])
    .filter((o) => o && sanitizeQuestionText(o.label, LIMITS.cqOption));
  return labeled.length >= 2;
}

/** Sanitized def from a complete draft — the commit writes THESE values, so
 * panel-authored content is clamp-stable by construction. */
export function draftToDef(draft, id) {
  const promptZh = sanitizeQuestionText(draft.promptZh, LIMITS.cqPrompt);
  const options = draft.type === 'text'
    ? []
    : (Array.isArray(draft.options) ? draft.options : [])
      .filter((o) => o && sanitizeQuestionText(o.label, LIMITS.cqOption))
      .slice(0, MAX_CUSTOM_OPTIONS)
      .map((o) => {
        const labelZh = sanitizeQuestionText(o.labelZh, LIMITS.cqOption);
        return {
          id: o.id,
          label: sanitizeQuestionText(o.label, LIMITS.cqOption),
          ...(labelZh ? { labelZh } : {}),
        };
      });
  return {
    id,
    type: draft.type === 'multi' || draft.type === 'text' ? draft.type : 'single',
    prompt: sanitizeQuestionText(draft.prompt, LIMITS.cqPrompt),
    ...(promptZh ? { promptZh } : {}),
    options,
  };
}

/** Collision-checked random id matching CUSTOM_QUESTION_ID_RE (R1 #8). */
export function genCustomQuestionId(existingIds) {
  const taken = new Set(existingIds || []);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const id = `c_${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
    if (CUSTOM_QUESTION_ID_RE.test(id) && !taken.has(id)) return id;
  }
  // Deterministic fallback — counter past the collision set.
  let n = taken.size + 1;
  while (taken.has(`c_q${n}`)) n += 1;
  return `c_q${n}`;
}

/** First unused oN option id within one question (R1 #8). */
export function nextOptionId(options) {
  const taken = new Set((options || []).map((o) => o?.id));
  let n = 1;
  while (taken.has(`o${n}`)) n += 1;
  return `o${n}`;
}

/** The state-transform the draft commit applies (used by BOTH the panel's
 * commit button and the guard's Save-and-continue path): writes the def AND
 * appends its id atomically; re-checks the cap as the belt (R3 new #1). */
export function commitDraftTransform(state, draft, id) {
  if (state.customOrder.length >= MAX_CUSTOM_QUESTIONS) return state;
  if (!draftComplete(draft)) return state;
  state.defsById.set(id, draftToDef(draft, id));
  state.customOrder.push(id);
  state.enabled = true;
  return state;
}
