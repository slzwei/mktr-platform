/**
 * Funnel-state jumper catalog (Studio PR 3) — the mock's 21 states / 6 groups,
 * with availability evaluated against the PRODUCTION v2 document (+ campaign
 * facts). `available(doc, campaign)` returns null (available) or the
 * disabled-reason string shown in the jumper dropdown.
 *
 * Quiz availability mirrors the production QuizGate rule exactly
 * (enabled + non-empty steps); the reveal additionally needs a persona-mode
 * quiz with result profiles (qualification quizzes never reveal).
 */

const quizGateEnabled = (doc) =>
  !!(doc?.quiz && doc.quiz.enabled && Array.isArray(doc.quiz.steps) && doc.quiz.steps.length > 0);

const quizQuestionCount = (doc) =>
  (doc?.quiz?.steps || []).flatMap((s) => s.questions || []).length;

export const JUMP_STATES = [
  { id: 'default', group: 'Entry', label: 'Default', available: () => null },
  { id: 'referred', group: 'Entry', label: 'Referred visitor', available: () => null },

  { id: 'quiz-intro', group: 'Quiz', label: 'Quiz intro', available: (d) => (quizGateEnabled(d) ? null : 'Quiz is disabled') },
  {
    id: 'quiz-question',
    group: 'Quiz',
    label: 'Quiz question',
    available: (d) => (quizGateEnabled(d) && quizQuestionCount(d) > 0 ? null : 'Quiz is disabled or has no questions'),
  },
  {
    id: 'quiz-reveal',
    group: 'Quiz',
    label: 'Result reveal',
    available: (d) =>
      quizGateEnabled(d) && d.quiz?.mode !== 'qualification' && (d.quiz?.resultProfiles || []).length > 0
        ? null
        : 'Needs a persona quiz with result profiles',
  },

  { id: 'gate-sgpr', group: 'Gates', label: 'SG/PR asked', available: (d) => (d?.form?.gates?.sgPr ? null : 'SG/PR gate is off') },
  { id: 'gate-sgpr-no', group: 'Gates', label: 'SG/PR ineligible', available: (d) => (d?.form?.gates?.sgPr ? null : 'SG/PR gate is off') },
  {
    id: 'gate-advisor',
    group: 'Gates',
    label: 'Advisor asked',
    available: (d) => (d?.form?.gates?.advisorExclusion ? null : 'Advisor exclusion is off'),
  },
  {
    id: 'gate-advisor-no',
    group: 'Gates',
    label: 'Advisor blocked',
    available: (d) => (d?.form?.gates?.advisorExclusion ? null : 'Advisor exclusion is off'),
  },

  { id: 'otp-open', group: 'Verify', label: 'OTP panel open', available: () => null },
  { id: 'otp-verified', group: 'Verify', label: 'OTP verified', available: () => null },
  { id: 'otp-ratelimit', group: 'Verify', label: 'OTP send rate-limited', available: () => null },
  { id: 'dnc-notice', group: 'Verify', label: 'DNC consent notice', available: (d) => (d?.form?.gates?.dncCheck ? null : 'DNC check is off') },
  { id: 'dnc-consented', group: 'Verify', label: 'DNC consented', available: (d) => (d?.form?.gates?.dncCheck ? null : 'DNC check is off') },

  { id: 'tnc-dialog', group: 'Legal', label: 'T&C dialog', available: () => null },

  { id: 'submitting', group: 'Outcome', label: 'Submitting', available: () => null },
  { id: 'success', group: 'Outcome', label: 'Success + share sheet', available: () => null },
  { id: 'duplicate', group: 'Outcome', label: 'Duplicate (409)', available: () => null },
  {
    id: 'draw-closed',
    group: 'Outcome',
    label: 'Draw closed',
    available: (d) => (d?.luckyDraw?.enabled === true ? null : 'No lucky draw on this campaign'),
  },
  { id: 'inactive', group: 'Outcome', label: 'Campaign inactive (410)', available: () => null },
  { id: 'error', group: 'Outcome', label: 'Error state', available: () => null },
];

export const JUMP_GROUP_ORDER = ['Entry', 'Quiz', 'Gates', 'Verify', 'Legal', 'Outcome'];

export function jumpStateById(id) {
  return JUMP_STATES.find((s) => s.id === id) || null;
}

/** Grouped view for the jumper dropdown, with per-item disabled reasons. */
export function buildJumpGroups(doc, campaign) {
  return JUMP_GROUP_ORDER.map((group) => ({
    name: group,
    items: JUMP_STATES.filter((s) => s.group === group).map((s) => {
      const reason = s.available(doc, campaign);
      return { id: s.id, label: s.label, disabled: !!reason, reason: reason || '' };
    }),
  }));
}

/** Structural quiz signature — when it changes while a Quiz jump is active,
 * the Studio bumps the funnel resetKey (Codex F11). */
export function quizStructureSignature(doc) {
  const quiz = doc?.quiz;
  if (!quiz) return 'none';
  return JSON.stringify({
    enabled: quiz.enabled === true,
    mode: quiz.mode || 'persona',
    steps: (quiz.steps || []).map((s) => [s.id, (s.questions || []).map((q) => q.id)]),
    profiles: (quiz.resultProfiles || []).map((p) => p.id),
  });
}
