import { describe, it, expect } from 'vitest';
import { JUMP_STATES, JUMP_GROUP_ORDER, buildJumpGroups, jumpStateById, quizStructureSignature } from '../studioJumpStates';
import { upgradeDesignConfig } from '@/lib/designConfigV2';

const QUIZ = {
  enabled: true,
  steps: [{ id: 's1', questions: [{ id: 'q1', prompt: 'P', options: [{ id: 'a', label: 'A', scores: { p1: 1 } }] }] }],
  resultProfiles: [{ id: 'p1', title: 'One' }],
  scoring: { method: 'profile-sum' },
};

const docWith = (v1 = {}, extras = {}) => ({ ...upgradeDesignConfig(v1), ...extras });

describe('studioJumpStates — the 22-state catalog', () => {
  it('carries exactly the mock catalog: 21 states across the 6 ordered groups', () => {
    expect(JUMP_STATES).toHaveLength(21);
    expect([...new Set(JUMP_STATES.map((s) => s.group))]).toEqual(JUMP_GROUP_ORDER);
  });

  it('availability truth table matches the doc gates', () => {
    const bare = docWith({});
    const gated = docWith({ sgPrOnly: true, excludeAdvisors: true, dncCheckAtSubmit: true, quiz: QUIZ });
    const drawDoc = docWith({}, { luckyDraw: { enabled: true, closesAt: '2099-01-01' } });

    const reason = (id, doc) => jumpStateById(id).available(doc, { id: 'c1' });

    // Bare doc: quiz/gates/draw states disabled with reasons; the rest available.
    expect(reason('quiz-intro', bare)).toBe('Quiz is disabled');
    expect(reason('quiz-question', bare)).toMatch(/disabled or has no questions/);
    expect(reason('quiz-reveal', bare)).toMatch(/persona quiz with result profiles/);
    expect(reason('gate-sgpr', bare)).toBe('SG/PR gate is off');
    expect(reason('gate-advisor-no', bare)).toBe('Advisor exclusion is off');
    expect(reason('dnc-notice', bare)).toBe('DNC check is off');
    expect(reason('draw-closed', bare)).toBe('No lucky draw on this campaign');
    for (const id of ['default', 'referred', 'otp-open', 'otp-verified', 'otp-ratelimit', 'tnc-dialog', 'submitting', 'success', 'duplicate', 'inactive', 'error']) {
      expect(reason(id, bare)).toBe(null);
    }

    // Fully-gated doc: everything opens up.
    for (const state of JUMP_STATES.filter((s) => s.id !== 'draw-closed')) {
      expect(state.available(gated, { id: 'c1' })).toBe(null);
    }
    expect(reason('draw-closed', drawDoc)).toBe(null);
  });

  it('a qualification-mode quiz never offers the reveal', () => {
    const doc = docWith({ quiz: { ...QUIZ, mode: 'qualification' } });
    expect(jumpStateById('quiz-reveal').available(doc, {})).toMatch(/persona quiz/);
    expect(jumpStateById('quiz-intro').available(doc, {})).toBe(null);
  });

  it('buildJumpGroups surfaces per-item disabled reasons for the dropdown', () => {
    const groups = buildJumpGroups(docWith({}), { id: 'c1' });
    const quizGroup = groups.find((g) => g.name === 'Quiz');
    expect(quizGroup.items.every((i) => i.disabled && i.reason)).toBe(true);
    const entry = groups.find((g) => g.name === 'Entry');
    expect(entry.items.every((i) => !i.disabled)).toBe(true);
  });
});

describe('quizStructureSignature — structural remount trigger (F11)', () => {
  it('is stable across copy edits but changes on structural edits', () => {
    const base = docWith({ quiz: QUIZ });
    const sig = quizStructureSignature(base);

    const copyEdited = structuredClone(base);
    copyEdited.quiz.intro = { headline: 'New copy' };
    copyEdited.quiz.resultProfiles[0].title = 'Renamed Title';
    expect(quizStructureSignature(copyEdited)).toBe(sig);

    const questionRemoved = structuredClone(base);
    questionRemoved.quiz.steps = [];
    expect(quizStructureSignature(questionRemoved)).not.toBe(sig);

    const profileRemoved = structuredClone(base);
    profileRemoved.quiz.resultProfiles = [];
    expect(quizStructureSignature(profileRemoved)).not.toBe(sig);

    const disabled = structuredClone(base);
    disabled.quiz.enabled = false;
    expect(quizStructureSignature(disabled)).not.toBe(sig);
  });
});
