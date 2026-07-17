import { describe, it, expect } from 'vitest';
import {
  flattenQuestions,
  updateQuestion,
  removeQuestion,
  addQuestion,
  updateOption,
  addOption,
  removeOption,
  isSimpleScores,
  setOptionProfile,
  addProfile,
  updateProfile,
  removeProfile,
  renameProfileId,
  profileReferenceCounts,
} from '../studioQuizView';
import { STARTER_QUIZ } from '@/components/campaigns/editor/QuizPanel';
import { scoreQuiz } from '@/lib/quizScoring';

/** Multi-question step + unknown keys — the shapes the classic editor destroys. */
const MULTI_STEP_QUIZ = {
  enabled: true,
  quizId: 'multi',
  version: 3,
  customFutureKey: { keep: 'me' },
  intro: { headline: 'H' },
  steps: [
    {
      id: 's1',
      stepNote: 'unknown-step-key',
      questions: [
        { id: 'q1', prompt: 'One', weight: 1, options: [{ id: 'a', label: 'A', scores: { p1: 1 } }, { id: 'b', label: 'B', scores: { p2: 1 } }] },
        { id: 'q2', prompt: 'Two', weight: 2, futureQKey: true, options: [{ id: 'c', label: 'C', scores: { p1: 2, p2: 1 } }] },
      ],
    },
    { id: 's2', questions: [{ id: 'q3', prompt: 'Three', weight: 3, options: [{ id: 'd', label: 'D', scores: { p2: 1 }, tag: 'hot' }] }] },
  ],
  resultProfiles: [
    { id: 'p1', title: 'One', customProfileKey: 1 },
    { id: 'p2', title: 'Two' },
  ],
  scoring: {
    method: 'profile-sum',
    tiebreak: 'prepared-first',
    profileOrder: ['p1', 'p2'],
    readiness: { enabled: true, label: 'R', rankFactor: { p1: 1, p2: 0.5 } },
    leadScore: { enabled: true, tagPoints: { hot: 3 }, bands: [{ gte: 2, label: 'Hot', badge: '🔥' }, { label: 'Cool', badge: '❄️' }] },
  },
  reveal: { rarityEnabled: true },
};

const answersFor = (quiz) =>
  flattenQuestions(quiz).map(({ question }) => ({ qid: question.id, value: question.options[0].id }));

describe('studioQuizView — structure preservation (the classic editor destroys these)', () => {
  it('flattenQuestions yields stable {stepIndex, questionIndex} locators across steps', () => {
    const rows = flattenQuestions(MULTI_STEP_QUIZ);
    expect(rows.map((r) => [r.stepIndex, r.questionIndex, r.question.id])).toEqual([
      [0, 0, 'q1'],
      [0, 1, 'q2'],
      [1, 0, 'q3'],
    ]);
  });

  it('updateQuestion patches ONE question and preserves siblings + unknown keys', () => {
    const next = updateQuestion(MULTI_STEP_QUIZ, 0, 1, { prompt: 'Two edited' });
    expect(next.steps[0].questions[1].prompt).toBe('Two edited');
    expect(next.steps[0].questions[1].futureQKey).toBe(true); // unknown question key
    expect(next.steps[0].questions[0]).toEqual(MULTI_STEP_QUIZ.steps[0].questions[0]); // sibling intact
    expect(next.steps[0].stepNote).toBe('unknown-step-key');
    expect(next.customFutureKey).toEqual({ keep: 'me' });
    expect(MULTI_STEP_QUIZ.steps[0].questions[1].prompt).toBe('Two'); // immutability
  });

  it('removeQuestion keeps the multi-question step intact and drops emptied steps', () => {
    const next = removeQuestion(MULTI_STEP_QUIZ, 0, 0);
    expect(next.steps[0].questions.map((q) => q.id)).toEqual(['q2']);
    const emptied = removeQuestion(next, 1, 0); // q3 was the only question of s2
    expect(emptied.steps.map((s) => s.id)).toEqual(['s1']);
  });

  it('addQuestion appends to the LAST step with two blank options', () => {
    const next = addQuestion(MULTI_STEP_QUIZ);
    const last = next.steps[next.steps.length - 1];
    expect(last.questions).toHaveLength(2);
    expect(last.questions[1].options).toHaveLength(2);
    expect(last.questions[1].type).toBe('single');
  });

  it('option helpers: update/add/remove leave the rest untouched', () => {
    let q = updateOption(MULTI_STEP_QUIZ, 0, 0, 1, { label: 'B!' });
    expect(q.steps[0].questions[0].options[1].label).toBe('B!');
    q = addOption(q, 0, 0);
    expect(q.steps[0].questions[0].options).toHaveLength(3);
    q = removeOption(q, 0, 0, 2);
    expect(q.steps[0].questions[0].options).toHaveLength(2);
    expect(q.steps[1]).toEqual(MULTI_STEP_QUIZ.steps[1]);
  });

  it('isSimpleScores: single 1-weight maps are simple; multi-key or weighted maps are advanced (never collapsed)', () => {
    expect(isSimpleScores({ scores: { p1: 1 } })).toBe(true);
    expect(isSimpleScores({ scores: {} })).toBe(true);
    expect(isSimpleScores({ scores: { p1: 2 } })).toBe(false);
    expect(isSimpleScores({ scores: { p1: 1, p2: 1 } })).toBe(false);
    const next = setOptionProfile(MULTI_STEP_QUIZ, 0, 0, 0, 'p2');
    expect(next.steps[0].questions[0].options[0].scores).toEqual({ p2: 1 });
    // The advanced map on q2/c is untouched by other edits
    expect(next.steps[0].questions[1].options[0].scores).toEqual({ p1: 2, p2: 1 });
  });
});

describe('studioQuizView — profile referential integrity (Codex F7)', () => {
  it('profileReferenceCounts reports every reference site', () => {
    expect(profileReferenceCounts(MULTI_STEP_QUIZ, 'p1')).toEqual({ optionScores: 2, rankFactor: 1, profileOrder: 1 });
    expect(profileReferenceCounts(MULTI_STEP_QUIZ, 'p2')).toEqual({ optionScores: 3, rankFactor: 1, profileOrder: 1 });
  });

  it('removeProfile atomically strips profileOrder + rankFactor + every option score — and scoreQuiz still works', () => {
    const next = removeProfile(MULTI_STEP_QUIZ, 'p1');
    expect(next.resultProfiles.map((p) => p.id)).toEqual(['p2']);
    expect(next.scoring.profileOrder).toEqual(['p2']);
    expect(next.scoring.readiness.rankFactor).toEqual({ p2: 0.5 });
    for (const { question } of flattenQuestions(next)) {
      for (const opt of question.options) {
        expect(opt.scores).not.toHaveProperty('p1');
      }
    }
    // No dangling references: the scorer runs clean and lands on the surviving profile.
    const result = scoreQuiz(next, answersFor(next));
    expect(result.profileId).toBe('p2');
    // tagPoints are tag-keyed — untouched by profile removal.
    expect(next.scoring.leadScore.tagPoints).toEqual({ hot: 3 });
  });

  it('renameProfileId rewrites resultProfiles + profileOrder + rankFactor + every option score', () => {
    const next = renameProfileId(MULTI_STEP_QUIZ, 'p1', 'rock');
    expect(next.resultProfiles.map((p) => p.id)).toEqual(['rock', 'p2']);
    expect(next.scoring.profileOrder).toEqual(['rock', 'p2']);
    expect(next.scoring.readiness.rankFactor).toEqual({ rock: 1, p2: 0.5 });
    expect(next.steps[0].questions[0].options[0].scores).toEqual({ rock: 1 });
    expect(next.steps[0].questions[1].options[0].scores).toEqual({ rock: 2, p2: 1 });
    const result = scoreQuiz(next, answersFor(next));
    expect(['rock', 'p2']).toContain(result.profileId);
  });

  it('addProfile registers the new id in profileOrder', () => {
    const next = addProfile(MULTI_STEP_QUIZ);
    const newId = next.resultProfiles[2].id;
    expect(next.scoring.profileOrder).toContain(newId);
  });

  it('updateProfile preserves unknown profile keys', () => {
    const next = updateProfile(MULTI_STEP_QUIZ, 'p1', { title: 'Renamed' });
    expect(next.resultProfiles[0].customProfileKey).toBe(1);
  });
});

describe('studioQuizView — real starter round-trip', () => {
  it('editing the STARTER_QUIZ through the mapper keeps it scoreable and structurally intact', () => {
    let quiz = structuredClone(STARTER_QUIZ);
    quiz = updateQuestion(quiz, 0, 0, { prompt: 'Edited prompt' });
    quiz = updateProfile(quiz, 'the-rock', { title: 'The Boulder' });
    quiz = removeProfile(quiz, 'the-free-spirit');
    expect(quiz.steps).toHaveLength(STARTER_QUIZ.steps.length);
    const result = scoreQuiz(quiz, answersFor(quiz));
    expect(result.profileId).toBe('the-rock'); // first options map to the-rock in the starter
    expect(quiz.scoring.readiness.rankFactor).not.toHaveProperty('the-free-spirit');
  });
});
