import { scoreQuiz } from '../services/quizScoringService.js';
import { quizDef, goldenCases, tiebreakCase } from '../../../test-fixtures/protectionPersonalityQuiz.mjs';

describe('quizScoringService.scoreQuiz — Protection Personality (server)', () => {
  it.each(goldenCases.map((c) => [c.name, c]))('golden case: %s', (_name, c) => {
    const r = scoreQuiz(quizDef, c.answers);
    expect(r).not.toBeNull();
    expect(r.profileId).toBe(c.expect.profileId);
    expect(r.readiness).toBe(c.expect.readiness);
    expect(r.leadScore.points).toBe(c.expect.leadPoints);
    expect(r.leadScore.band).toBe(c.expect.band);
  });

  it('resolves ties by tiebreak (prepared-first vs gap-first)', () => {
    const prepared = scoreQuiz(quizDef, tiebreakCase.answers);
    expect(prepared.profileId).toBe(tiebreakCase.preparedFirst);
    expect(prepared.readiness).toBe(tiebreakCase.readiness);
    expect(prepared.leadScore.points).toBe(tiebreakCase.leadPoints);
    expect(prepared.leadScore.band).toBe(tiebreakCase.band);

    const gapDef = { ...quizDef, scoring: { ...quizDef.scoring, tiebreak: 'gap-first' } };
    const gap = scoreQuiz(gapDef, tiebreakCase.answers);
    expect(gap.profileId).toBe(tiebreakCase.gapFirst);
  });

  it('carries the winning profile title + agentAngle', () => {
    const r = scoreQuiz(quizDef, goldenCases.find((c) => c.name === 'all_strategist').answers);
    expect(r.title).toBe('The Strategist');
    expect(r.agentAngle).toBe('savings / retirement top-up');
  });

  it('returns null for empty / invalid input', () => {
    expect(scoreQuiz(quizDef, [])).toBeNull();
    expect(scoreQuiz(null, [{ qid: 'q1_weekend', value: 'cosy' }])).toBeNull();
    expect(scoreQuiz(quizDef, null)).toBeNull();
  });

  it('ignores unknown qids and unknown option values (defensive)', () => {
    const r = scoreQuiz(quizDef, [
      { qid: 'does-not-exist', value: 'x' },
      { qid: 'q1_weekend', value: 'not-an-option' },
      { qid: 'q5_protected', value: 'exposed' }, // only this counts
    ]);
    expect(r.profileId).toBe('the-free-spirit');
  });

  it('throws on an unimplemented scoring method', () => {
    const bad = { ...quizDef, scoring: { ...quizDef.scoring, method: 'numeric-gap' } };
    expect(() => scoreQuiz(bad, goldenCases[0].answers)).toThrow(/not implemented/);
  });
});
