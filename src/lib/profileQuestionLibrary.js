/**
 * Profile question library v1 — the FIXED set of enrichment questions a
 * campaign may slide into its signup funnel
 * (docs/plans/studio-profile-questions.md §2).
 *
 * TWIN FILE: src/lib/profileQuestionLibrary.js ↔
 * backend/src/utils/profileQuestionLibrary.js must stay BYTE-IDENTICAL
 * (parity test enforces). Dependency-free by design. The frontend renders
 * from prompts/options and NEVER calls resolveAnswer; the backend calls
 * resolveAnswer to compose the complete taxonomy value server-side —
 * per-option value fragments are not composable for multi-selects
 * (Codex PR0 R1 #6 / R2 #4).
 *
 * Copy rule (one, deterministic): English prompt with the Chinese inline
 * where provided — there is no campaign-locale mechanism and none is
 * assumed (Codex PR0 R1 #9).
 *
 * Admins pick questions; they never author them. Free-text answers would
 * need LLM parsing and would poison the deterministic ledger.
 */

export const PROFILE_QUESTION_LIBRARY = [
  {
    id: 'language',
    factKey: 'identity.preferred_language',
    multi: false,
    prompt: 'Which language do you prefer?',
    promptZh: '您偏好哪种语言？',
    options: [
      { id: 'en', label: 'English' },
      { id: 'zh', label: '中文' },
    ],
  },
  {
    id: 'annual_income',
    factKey: 'finance.annual_income_band',
    multi: false,
    prompt: 'What is your annual income range?',
    promptZh: '您的年收入范围？',
    options: [
      { id: 'lt40', label: 'Below $40k' },
      { id: '40to80', label: '$40k – $80k' },
      { id: '80to120', label: '$80k – $120k' },
      { id: '120to200', label: '$120k – $200k' },
      { id: 'gt200', label: 'Above $200k' },
    ],
  },
  {
    id: 'children',
    factKey: 'family.children_count_band',
    multi: false,
    prompt: 'Do you have children?',
    promptZh: '您有孩子吗？',
    options: [
      { id: 'none', label: 'None' },
      { id: 'one', label: '1' },
      { id: 'two', label: '2' },
      { id: 'three_plus', label: '3 or more' },
    ],
  },
  {
    id: 'pets',
    factKey: 'household.pets',
    multi: true,
    prompt: 'Do you have pets? Select all that apply.',
    promptZh: '您养宠物吗？可多选。',
    options: [
      { id: 'dog', label: 'Dog' },
      { id: 'cat', label: 'Cat' },
      { id: 'other', label: 'Other' },
      { id: 'none', label: 'No pets' },
    ],
  },
  {
    id: 'retirement_age',
    factKey: 'finance.retirement_age_band',
    multi: false,
    prompt: 'At what age do you plan to retire?',
    promptZh: '您计划几岁退休？',
    options: [
      { id: 'lt55', label: 'Before 55' },
      { id: '55to59', label: '55 – 59' },
      { id: '60to64', label: '60 – 64' },
      { id: '65to69', label: '65 – 69' },
      { id: '70plus', label: '70 or later' },
    ],
  },
];

export const PROFILE_QUESTION_IDS = PROFILE_QUESTION_LIBRARY.map((q) => q.id);
export const MAX_PROFILE_QUESTIONS = 5;

const byId = new Map(PROFILE_QUESTION_LIBRARY.map((q) => [q.id, q]));
export const getProfileQuestion = (id) => byId.get(id) || null;

// Single-select answer → taxonomy value.
const SINGLE_VALUES = {
  language: { en: { v: 'en' }, zh: { v: 'zh' } },
  annual_income: {
    lt40: { v: '<40k' }, '40to80': { v: '40-80k' }, '80to120': { v: '80-120k' },
    '120to200': { v: '120-200k' }, gt200: { v: '>200k' },
  },
  children: {
    none: { v: '0' }, one: { v: '1' }, two: { v: '2' }, three_plus: { v: '3_plus' },
  },
  retirement_age: {
    lt55: { v: '<55' }, '55to59': { v: '55-59' }, '60to64': { v: '60-64' },
    '65to69': { v: '65-69' }, '70plus': { v: '70+' },
  },
};

const PET_VALUES = { dog: 'dog', cat: 'cat', other: 'other' };

/**
 * Compose the COMPLETE taxonomy value for a question from the selected
 * option id(s). Returns null for anything invalid — unknown ids, wrong
 * single/multi shape, duplicates, or `none`-exclusivity violations
 * (none + dog is a contradiction, not a preference). The server re-checks
 * the output with validateFact regardless (belt + braces).
 */
export function resolveAnswer(questionId, selectedIds) {
  const q = byId.get(questionId);
  if (!q) return null;

  if (!q.multi) {
    if (typeof selectedIds !== 'string') return null;
    return SINGLE_VALUES[questionId]?.[selectedIds] || null;
  }

  // multi (pets)
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) return null;
  if (new Set(selectedIds).size !== selectedIds.length) return null;
  if (!selectedIds.every((s) => q.options.some((o) => o.id === s))) return null;
  if (selectedIds.includes('none')) {
    if (selectedIds.length !== 1) return null; // exclusive
    return { v: [], complete: true };
  }
  const values = [...new Set(selectedIds.map((s) => PET_VALUES[s]).filter(Boolean))].sort();
  if (values.length !== selectedIds.length) return null;
  return { v: values, complete: true };
}
