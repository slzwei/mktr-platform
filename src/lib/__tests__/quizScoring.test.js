import { describe, it, expect } from 'vitest';
import { scoreQuiz } from '../quizScoring.js';
import { quizDef, goldenCases, tiebreakCase } from '../../../test-fixtures/protectionPersonalityQuiz.mjs';

describe('quizScoring.scoreQuiz — Protection Personality (client)', () => {
  it.each(goldenCases.map((c) => [c.name, c]))('golden case: %s', (_name, c) => {
    const r = scoreQuiz(quizDef, c.answers);
    expect(r).not.toBeNull();
    expect(r.profileId).toBe(c.expect.profileId);
    expect(r.readiness).toBe(c.expect.readiness);
    expect(r.leadScore.points).toBe(c.expect.leadPoints);
    expect(r.leadScore.band).toBe(c.expect.band);
  });

  it('resolves ties by tiebreak (prepared-first vs gap-first)', () => {
    expect(scoreQuiz(quizDef, tiebreakCase.answers).profileId).toBe(tiebreakCase.preparedFirst);
    const gapDef = { ...quizDef, scoring: { ...quizDef.scoring, tiebreak: 'gap-first' } };
    expect(scoreQuiz(gapDef, tiebreakCase.answers).profileId).toBe(tiebreakCase.gapFirst);
  });

  it('returns null for empty / invalid input', () => {
    expect(scoreQuiz(quizDef, [])).toBeNull();
    expect(scoreQuiz(null, [{ qid: 'q1_weekend', value: 'cosy' }])).toBeNull();
  });
});
